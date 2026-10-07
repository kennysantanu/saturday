import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { openDatabase, withDatabaseRecovery } from '../database.js';
import {
	createBackup,
	getBackupFile,
	prepareRestore,
	restoreBackup,
	restoreDatabaseWithFiles
} from '../backups.js';
import { withFileLock, filePaths, atomicJson, fs, reject } from './store.js';
import {
	captureFiles,
	publishCapture,
	getFileBackup,
	prepareFileRestore,
	applyFileRestore,
	extractArchive
} from './backups.js';
export async function createBackupPair() {
	const db = openDatabase();
	let capture;
	try {
		db.exec('BEGIN IMMEDIATE');
		const result = await withFileLock(async (m) => {
			const database = createBackup();
			capture = await captureFiles(m);
			return database;
		});
		db.exec('ROLLBACK');
		const id = randomUUID();
		const files = await publishCapture(capture, 'manual', {
			backup_set_id: id,
			database_backup_id: result.backup_id,
			database_sha256: result.sha256
		});
		const pair = {
			backup_set_id: id,
			database_backup_id: result.backup_id,
			file_backup_id: files.backup_id,
			database_sha256: result.sha256,
			files_sha256: files.sha256
		};
		await atomicJson(join(filePaths().backups, `${id}.pair.json`), pair);
		return pair;
	} catch (e) {
		try {
			db.exec('ROLLBACK');
		} catch {}
		if (capture) await fs.rm(capture, { recursive: true, force: true });
		throw e;
	} finally {
		db.close();
	}
}
export async function prepareBackupPairRestore({ file_backup_id }) {
	const { metadata } = await getFileBackup(file_backup_id);
	if (!metadata.backup_set_id || !metadata.database_backup_id)
		reject('VALIDATION', 'Choose the file artifact of a coordinated pair.');
	const pair = JSON.parse(
		await fs.readFile(join(filePaths().backups, `${metadata.backup_set_id}.pair.json`), 'utf8')
	);
	const database = getBackupFile(metadata.database_backup_id);
	if (
		pair.backup_set_id !== metadata.backup_set_id ||
		pair.file_backup_id !== file_backup_id ||
		pair.database_backup_id !== metadata.database_backup_id ||
		pair.files_sha256 !== metadata.sha256 ||
		pair.database_sha256 !== database.metadata.sha256 ||
		metadata.database_sha256 !== database.metadata.sha256
	)
		reject(
			'INTEGRITY',
			'Coordinated backup identities or hashes do not match. Restore the artifacts independently after review.'
		);
	const db = prepareRestore(metadata.database_backup_id);
	const files = await prepareFileRestore({ backup_id: file_backup_id, mode: 'replace' });
	const id = randomUUID();
	const result = {
		restore_id: id,
		backup_set_id: metadata.backup_set_id,
		database: db,
		files,
		expires_at: files.expires_at
	};
	await atomicJson(join(filePaths().state, `${id}.pair-restore.json`), result);
	return result;
}
export async function restoreBackupPair({ restore_id, confirm }) {
	if (confirm !== true)
		reject('CONFIRMATION', 'Review and authorize the coordinated restore first.');
	if (!/^[a-f0-9-]{36}$/.test(restore_id)) reject('VALIDATION', 'Invalid restore ID.');
	const path = join(filePaths().state, `${restore_id}.pair-restore.json`);
	const record = JSON.parse(await fs.readFile(path, 'utf8'));
	if (record.consumed || Date.parse(record.expires_at) <= Date.now())
		reject('EXPIRED', 'Prepare a new paired restore.');
	await atomicJson(path, { ...record, consumed: true });
	const sessionPath = join(filePaths().state, 'pair-session.json');
	let stage;
	try {
		const result = await restoreDatabaseWithFiles(record.database.restore_id, (recoveryDb) =>
			withFileLock(async (m) => {
				const fileRecordPath = join(filePaths().state, `${record.files.restore_id}.restore.json`);
				const fileRecord = JSON.parse(await fs.readFile(fileRecordPath, 'utf8'));
				if (fileRecord.consumed || Date.parse(fileRecord.expires_at) <= Date.now())
					reject('EXPIRED', 'Prepare both restore previews again.');
				await atomicJson(fileRecordPath, { ...fileRecord, consumed: true });
				stage = fileRecord.stage;
				const recoveryFiles = await publishCapture(await captureFiles(m), 'recovery');
				await atomicJson(sessionPath, {
					recovery_database_id: recoveryDb.backup_id,
					recovery_files_id: recoveryFiles.backup_id,
					restore_id
				});
				return applyFileRestore(m, fileRecord);
			})
		);
		await fs.rm(sessionPath);
		if (stage) await fs.rm(stage, { recursive: true, force: true });
		return result;
	} catch (e) {
		try {
			await fs.access(sessionPath);
		} catch {
			throw e;
		}

		try {
			await recoverBackupPair();
		} catch {
			reject(
				'RECOVERY_REQUIRED',
				'Coordinated restore and recovery were interrupted. Stop Saturday and run npm run files -- recover-pair --confirm.'
			);
		}
		reject(
			'RESTORE_FAILED',
			'Coordinated restore failed; both stores were returned to their recovery snapshots. Inspect the result before preparing another restore.'
		);
	}
}

export async function recoverBackupPair() {
	return withFileLock(
		async (m) => {
			const sessionPath = join(filePaths().state, 'pair-session.json');
			const session = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
			const { path } = await getFileBackup(session.recovery_files_id);
			const { stage, manifest } = await extractArchive(path);
			const dbPreview = withDatabaseRecovery(() => prepareRestore(session.recovery_database_id));
			await applyFileRestore(m, {
				restore_id: randomUUID(),
				catalog_token: m.token,
				manifest,
				stage,
				mode: 'replace'
			});
			withDatabaseRecovery(() => restoreBackup(dbPreview.restore_id, true));
			await fs.rm(sessionPath);
			await fs.rm(stage, { recursive: true, force: true });
			return { recovered: true };
		},
		{ allowSession: true }
	);
}
