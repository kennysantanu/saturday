import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { openDatabase } from './database.js';
import { withServerActivity } from './server-lifecycle.js';
import { syncDirectory } from './installation.js';
import {
	parseRecordDeletion,
	assertDeletionDataset,
	recordIdSchema,
	ServiceError
} from './validation.js';
import {
	assertJobDeletionAvailable,
	hasPendingJobDeletion,
	jobDeletionPath,
	jobDeletionRecoveryMessage,
	withJobDeletionAccess
} from './job-deletion-state.js';
import { withFileLock, fs, atomicJson, filePaths, assertDataset, validKey } from './files/store.js';
import { inspectJobDeletionDocuments, removeJobDeletionDocuments } from './files/documents.js';

const intentSchema = z
	.object({
		format: z.literal('saturday.job-deletion'),
		version: z.literal(1),
		operation_id: z.uuid(),
		dataset_id: z.uuid(),
		job_id: recordIdSchema,
		documents: z.array(z.object({ id: z.uuid(), key: z.string() }))
	})
	.strict();

async function readIntent() {
	const stat = await fs.lstat(jobDeletionPath());
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
		throw new ServiceError(jobDeletionRecoveryMessage, 'RECOVERY_REQUIRED');
	let json;
	try {
		json = JSON.parse(await fs.readFile(jobDeletionPath(), 'utf8'));
	} catch {
		throw new ServiceError(jobDeletionRecoveryMessage, 'RECOVERY_REQUIRED');
	}
	const parsed = intentSchema.safeParse(json);
	if (!parsed.success) throw new ServiceError(jobDeletionRecoveryMessage, 'RECOVERY_REQUIRED');
	const record = parsed.data,
		ids = new Set(),
		keys = new Set();
	for (const d of record.documents) {
		validKey(d.key);
		if (!d.key.startsWith(`jobs/${record.job_id}/`) || ids.has(d.id) || keys.has(d.key))
			throw new ServiceError(jobDeletionRecoveryMessage, 'RECOVERY_REQUIRED');
		ids.add(d.id);
		keys.add(d.key);
	}
	return record;
}
async function clearIntent() {
	await fs.rm(jobDeletionPath());
	await syncDirectory(filePaths().state);
}

// Short waits yield the event loop while another operation owns SQLite's gate.
async function begin(db) {
	db.exec('PRAGMA busy_timeout=0');
	const deadline = Date.now() + 5000;
	for (;;) {
		try {
			db.exec('BEGIN IMMEDIATE');
			return;
		} catch (error) {
			if (!String(error.message).includes('locked') || Date.now() >= deadline) throw error;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
}

export async function deleteJob(input) {
	const values = parseRecordDeletion(input, 'job_id');
	assertJobDeletionAvailable();
	return withServerActivity(() =>
		withJobDeletionAccess(async () => {
			const db = openDatabase();
			let committed = false,
				intent;
			try {
				await begin(db);
				assertJobDeletionAvailable(true);
				assertDeletionDataset(db, values.dataset_id);
				if (!db.prepare('SELECT id FROM jobs WHERE id=?').get(values.job_id))
					throw new ServiceError('Job was not found.', 'not_found');
				return await withFileLock(async (m) => {
					assertDataset(m, { dataset_id: values.dataset_id });
					const documents = await inspectJobDeletionDocuments(m, values.job_id);
					intent = {
						format: 'saturday.job-deletion',
						version: 1,
						operation_id: randomUUID(),
						...values,
						documents
					};
					delete intent.confirm;
					await atomicJson(jobDeletionPath(), intent);
					db.prepare('DELETE FROM job_networks WHERE job_id=?').run(values.job_id);
					db.prepare('DELETE FROM job_updates WHERE job_id=?').run(values.job_id);
					db.prepare('DELETE FROM jobs WHERE id=?').run(values.job_id);
					db.exec('COMMIT');
					committed = true;
					await removeJobDeletionDocuments(m, values.job_id, documents);
					await clearIntent();
					return { job_id: values.job_id, deleted: true, documents_deleted: documents.length };
				});
			} catch (error) {
				if (!committed) {
					try {
						db.exec('ROLLBACK');
						if (
							intent &&
							hasPendingJobDeletion() &&
							(await readIntent()).operation_id === intent.operation_id
						)
							await clearIntent();
					} catch {
						/* Retain an uncertain intent; recovery inspects the committed database. */
					}
				}
				if (hasPendingJobDeletion())
					throw new ServiceError(jobDeletionRecoveryMessage, 'RECOVERY_REQUIRED');
				throw error;
			} finally {
				db.close();
			}
		})
	);
}

export async function recoverJobDeletion() {
	if (!hasPendingJobDeletion()) return { recovered: false };
	return withServerActivity(() =>
		withJobDeletionAccess(async () => {
			const db = openDatabase();
			try {
				await begin(db);
				// Another process may have finished while this one waited for the gate.
				if (!hasPendingJobDeletion()) return { recovered: false };
				const intent = await readIntent();
				try {
					assertDeletionDataset(db, intent.dataset_id);
				} catch {
					throw new ServiceError(jobDeletionRecoveryMessage, 'RECOVERY_REQUIRED');
				}
				return await withFileLock(async (m) => {
					if (!hasPendingJobDeletion()) return { recovered: false };
					const current = await readIntent();
					if (current.operation_id !== intent.operation_id)
						throw new ServiceError(jobDeletionRecoveryMessage, 'RECOVERY_REQUIRED');
					assertDataset(m, { dataset_id: intent.dataset_id });
					const exists = !!db.prepare('SELECT id FROM jobs WHERE id=?').get(intent.job_id);
					if (!exists) await removeJobDeletionDocuments(m, intent.job_id, intent.documents);
					await clearIntent();
					return { recovered: true, job_id: intent.job_id, deleted: !exists };
				});
			} finally {
				try {
					db.exec('ROLLBACK');
				} catch {}
				db.close();
			}
		})
	);
}
