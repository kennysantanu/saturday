import { getInstallation } from './installation.js';
import { z } from 'zod';
import {
	networkInputSchema,
	networkIdSchema,
	recordIdSchema,
	networkLinkShape,
	networkUpdateShape,
	parseSchema
} from './validation.js';
import { assertDatabaseAvailable, assertFileStorageCompatible } from './database.js';
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	renameSync,
	unlinkSync,
	readdirSync,
	lstatSync,
	realpathSync,
	existsSync,
	openSync,
	closeSync,
	fsyncSync,
	copyFileSync,
	constants,
	rmSync
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { getDatabasePath, getProjectRoot, inTransaction, reserveJobFileIds } from './database.js';
import { applyMigrations, assertMigrationHistory } from './migrations.js';
import { parseJobInput, parseAssessment, validDate, ordinaryEventTypes } from './validation.js';
import { jobColumns, jobFields } from '../job-fields.js';
import { storageCompatibility, buildInfo } from './compatibility.js';

export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const columns = {
	job_updates: [
		'id',
		'job_id',
		'event_type',
		'event_date',
		'note',
		'created_via',
		'created_at',
		'updated_at'
	]
};
export class BackupError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = 'BackupError';
	}
}
function fail(code, message) {
	throw new BackupError(code, message);
}
export function publicBackupError(error) {
	if (error instanceof BackupError) return { code: error.code, message: error.message };
	if (
		['VALIDATION', 'BUSY', 'CONFIRMATION', 'NOT_FOUND', 'INTEGRITY', 'DATASET_MISMATCH'].includes(
			error?.code
		)
	)
		return { code: error.code, message: error.message };
	if (error?.code === 'FORMAT') return { code: 'unsupported_file_format', message: error.message };
	if (String(error?.message).includes('locked') || String(error?.message).includes('busy'))
		return { code: 'database_busy', message: 'Saturday is busy. Try again shortly.' };
	return {
		code: 'io_error',
		message: 'The backup operation failed. Check storage space and file permissions.'
	};
}
function safe(operation) {
	try {
		assertDatabaseAvailable();
		return operation();
	} catch (error) {
		const result = publicBackupError(error);
		throw new BackupError(result.code, result.message);
	}
}
function root() {
	const p = getDatabasePath();
	return existsSync(p) ? realpathSync(p) : resolve(p);
}
function paths() {
	const p = root();
	return {
		database: p,
		backups: getInstallation().database_backups,
		legacyBackups: `${p}.backups`,
		restore: getInstallation().database_restore
	};
}
export function getBackupPaths() {
	return paths();
}
function privateDir(path) {
	if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()))
		fail('io_error', 'Backup storage must be a regular directory.');
	mkdirSync(path, { recursive: true, mode: 0o700 });
	return path;
}
function storage() {
	const p = paths();
	privateDir(p.backups);
	privateDir(p.restore);
	return p;
}
function id(value) {
	if (typeof value !== 'string' || !UUID.test(value))
		fail('not_found', 'Backup or restore ID not found.');
	return value;
}
function regular(path) {
	if (!existsSync(path)) fail('not_found', 'Backup file not found.');
	const s = lstatSync(path);
	if (s.isSymbolicLink() || !s.isFile())
		fail('invalid_backup', 'Select a regular SQLite backup file.');
	if (s.size > MAX_BACKUP_BYTES)
		fail('backup_too_large', 'Backups must be no larger than 100 MiB.');
	if (!s.size) fail('invalid_backup', 'The backup is empty.');
	return s;
}
function syncFile(path) {
	const fd = openSync(path, 'r');
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}
function syncDirectory(path) {
	let fd;
	try {
		fd = openSync(path, 'r');
		fsyncSync(fd);
	} catch (error) {
		if (
			process.platform !== 'win32' ||
			!['EPERM', 'EACCES', 'EISDIR', 'EINVAL'].includes(error.code)
		)
			throw error;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
function atomicJSON(path, data) {
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temp, JSON.stringify(data), { mode: 0o600, flag: 'wx' });
		syncFile(temp);
		renameSync(temp, path);
		syncDirectory(dirname(path));
	} finally {
		if (existsSync(temp)) unlinkSync(temp);
	}
}
function json(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}
function digest(path) {
	regular(path);
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}
function connect(path, readOnly = true) {
	const db = new DatabaseSync(path, { readOnly, allowExtension: false });
	db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;');
	return db;
}
function databaseVersion(db) {
	return Number(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version);
}
function columnsFor() {
	return {
		app_metadata: ['id', 'format', 'dataset_id'],
		jobs: jobColumns(),
		...columns,
		networks: [
			'id',
			'name',
			'role',
			'organization',
			'phone',
			'email',
			'link',
			'notes',
			'follow_up_date',
			'follow_up_comment',
			'created_via',
			'created_at',
			'updated_at'
		],
		job_networks: ['job_id', 'network_id', 'notes', 'created_via', 'created_at', 'updated_at'],
		network_updates: [
			'id',
			'network_id',
			'interaction_date',
			'note',
			'created_via',
			'created_at',
			'updated_at'
		]
	};
}
const allocatedTables = ['jobs', 'job_updates', 'networks', 'network_updates'];
function allocatorState(db) {
	const rows = db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all();
	const seen = new Set();
	for (const row of rows) {
		if (
			!allocatedTables.includes(row.name) ||
			seen.has(row.name) ||
			!Number.isSafeInteger(row.seq) ||
			row.seq < 0
		)
			fail('invalid_backup', 'Invalid record ID allocation state.');
		seen.add(row.name);
	}
	return Object.fromEntries(
		allocatedTables.map((table) => {
			const seq = rows.find((row) => row.name === table)?.seq ?? 0;
			const maximum = db.prepare(`SELECT MAX(id) AS maximum FROM ${table}`).get().maximum ?? 0;
			if (seq < maximum)
				fail('invalid_backup', 'Record ID allocation state is behind stored records.');
			return [table, seq];
		})
	);
}
function dataset(db) {
	return {
		...Object.fromEntries(
			Object.entries(columnsFor()).map(([table, fields]) => [
				table,
				db
					.prepare(
						`SELECT ${fields.join(',')} FROM ${table} ORDER BY ${table === 'job_networks' ? 'job_id, network_id' : 'id'}`
					)
					.all()
			])
		),
		$sequence: allocatorState(db)
	};
}
function dataHash(db) {
	return createHash('sha256')
		.update(
			JSON.stringify(
				Object.fromEntries(Object.entries(dataset(db)).filter(([key]) => key !== '$sequence'))
			)
		)
		.digest('hex');
}
function fingerprint(db) {
	return createHash('sha256')
		.update(dataHash(db))
		.update(JSON.stringify(allocatorState(db)))
		.update(JSON.stringify(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()))
		.digest('hex');
}
function summary(db) {
	return {
		schema_version: databaseVersion(db),
		database_format: db.prepare('SELECT format FROM app_metadata WHERE id=1').get().format,
		dataset_id: db.prepare('SELECT dataset_id FROM app_metadata WHERE id=1').get().dataset_id,
		job_count: Number(db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n),
		update_count: Number(db.prepare('SELECT COUNT(*) AS n FROM job_updates').get().n),
		...Object.fromEntries(
			Object.entries({
				network_count: 'networks',
				network_link_count: 'job_networks',
				network_update_count: 'network_updates'
			}).map(([key, table]) => [
				key,
				Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)
			])
		)
	};
}
function validateSchema(db) {
	try {
		if (
			!db
				.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='schema_migrations'")
				.get()
		)
			fail('invalid_backup', 'The file is not a Saturday database.');
		assertMigrationHistory(db);
		const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
		if (
			versions.length < storageCompatibility.database.minimumVersion ||
			versions.length > storageCompatibility.database.currentVersion
		)
			fail(
				'unsupported_schema',
				'This backup schema is not supported by this version of Saturday.'
			);
	} catch (error) {
		if (error instanceof BackupError) throw error;
		if (String(error.message).includes('Unsupported database schema'))
			fail('unsupported_schema', 'This database schema is not supported. Update Saturday.');
		fail('invalid_backup', 'The file is not a valid Saturday backup.');
	}
}
function validate(db) {
	try {
		validateSchema(db);
		if (
			db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
			db.prepare('PRAGMA foreign_key_check').all().length
		)
			fail('invalid_backup', 'The backup failed database integrity or relationship checks.');
		const data = dataset(db);
		const active = new Map();
		for (const job of data.jobs) {
			parseSchema(recordIdSchema, job.id);
			parseJobInput({
				...job,
				...Object.fromEntries(
					jobFields
						.filter((field) => field.type === 'boolean')
						.map((field) => [field.name, Boolean(job[field.name])])
				)
			});
			for (const field of jobFields.filter((field) => field.type === 'boolean')) {
				if (![0, 1].includes(job[field.name])) throw new Error('boolean');
			}
			parseAssessment(job);
			active.set(job.id, true);
		}
		for (const update of data.job_updates) {
			if (
				!recordIdSchema.safeParse(update.id).success ||
				!active.has(update.job_id) ||
				!validDate(update.event_date)
			)
				throw new Error('update');
			if (
				update.event_type !== null &&
				![...ordinaryEventTypes, 'dismissed', 'reopened'].includes(update.event_type)
			)
				throw new Error('event');
			if (update.note !== null && (typeof update.note !== 'string' || update.note.length > 10000))
				throw new Error('note');
			if (update.event_type === null && !update.note?.trim()) throw new Error('note');
			if (['accepted', 'rejected', 'dismissed'].includes(update.event_type))
				active.set(update.job_id, false);
			if (update.event_type === 'reopened') active.set(update.job_id, true);
		}
		for (const row of data.networks ?? []) {
			parseSchema(networkIdSchema, row.id);
			parseSchema(networkInputSchema, row);
		}
		for (const row of data.job_networks ?? []) parseSchema(z.object(networkLinkShape), row);
		for (const row of data.network_updates ?? []) {
			parseSchema(networkIdSchema, row.id);
			// Historical records remain recoverable if the host calendar moved backwards.
			parseSchema(
				z.object({ ...networkUpdateShape, interaction_date: z.string().refine(validDate) }),
				row
			);
		}
		for (const row of Object.entries(data)
			.filter(([table]) => !['app_metadata', '$sequence'].includes(table))
			.flatMap(([, rows]) => rows)) {
			if (
				!['manual', 'mcp'].includes(row.created_via) ||
				!['created_at', 'updated_at'].every(
					(key) => typeof row[key] === 'string' && Number.isFinite(Date.parse(row[key]))
				)
			)
				throw new Error('metadata');
		}
		if (data.jobs.some((job) => Boolean(job.is_active) !== active.get(job.id)))
			throw new Error('state');
		return summary(db);
	} catch (error) {
		if (error instanceof BackupError) throw error;
		if (String(error.message).includes('Unsupported database schema'))
			fail('unsupported_schema', 'This database schema is not supported. Update Saturday.');
		fail('invalid_backup', 'The file is not a valid Saturday backup.');
	}
}
function inspectPath(path) {
	regular(path);
	let db;
	try {
		db = connect(path);
		return validate(db);
	} catch (error) {
		if (error instanceof BackupError) throw error;
		fail('invalid_backup', 'The file is not a readable SQLite backup.');
	} finally {
		db?.close();
	}
}
function backupPath(backupId) {
	const name = `${id(backupId)}.sqlite`;
	const p = storage();
	return existsSync(join(p.backups, name)) ? join(p.backups, name) : join(p.legacyBackups, name);
}
export function getBackupFile(backupId, { verify = true } = {}) {
	return safe(() => {
		const p = backupPath(backupId);
		const metadataPath = join(dirname(p), `${id(backupId)}.json`);
		if (!existsSync(metadataPath)) fail('not_found', 'Backup file not found.');
		const metadata = json(metadataPath);
		if (verify && digest(p) !== metadata.sha256)
			fail('invalid_backup', 'The backup file has changed.');
		return { path: p, metadata };
	});
}
function publish(temp, kind, now) {
	const p = storage();
	const counts = inspectPath(temp);
	const backupId = randomUUID();
	const metadata = {
		backup_id: backupId,
		filename: `saturday-${kind}-${new Date(now).toISOString().replace(/[:.]/g, '-')}.sqlite`,
		kind,
		created_at: new Date(now).toISOString(),
		app_version: '0.0.1',
		creator_build: buildInfo.id,
		...counts,
		bytes: regular(temp).size,
		sha256: digest(temp)
	};
	chmodSync(temp, 0o600);
	syncFile(temp);
	renameSync(temp, join(p.backups, `${backupId}.sqlite`));
	try {
		atomicJSON(join(p.backups, `${backupId}.json`), metadata);
	} catch (error) {
		unlinkSync(join(p.backups, `${backupId}.sqlite`));
		throw error;
	}
	return metadata;
}
function snapshot(kind, now = Date.now()) {
	const p = storage();
	const temp = join(p.backups, `${randomUUID()}.tmp`);
	let db;
	try {
		db = connect(p.database);
		validateSchema(db);
		db.prepare('VACUUM INTO ?').run(temp);
		db.close();
		db = null;
		return publish(temp, kind, now);
	} finally {
		db?.close();
		if (existsSync(temp)) unlinkSync(temp);
	}
}
export function createBackup() {
	return safe(() => snapshot('manual'));
}
export function importBackup(source) {
	return safe(() => {
		regular(source);
		const p = storage();
		const temp = join(p.backups, `${randomUUID()}.tmp`);
		try {
			copyFileSync(source, temp, constants.COPYFILE_EXCL);
			return publish(temp, 'imported', Date.now());
		} finally {
			if (existsSync(temp)) unlinkSync(temp);
		}
	});
}
export function importBackupBytes(bytes) {
	return safe(() => {
		if (bytes.length > MAX_BACKUP_BYTES)
			fail('backup_too_large', 'Backups must be no larger than 100 MiB.');
		const p = storage();
		const temp = join(p.backups, `${randomUUID()}.tmp`);
		try {
			writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
			return publish(temp, 'imported', Date.now());
		} finally {
			if (existsSync(temp)) unlinkSync(temp);
		}
	});
}
export function listBackups({ limit = 20, offset = 0 } = {}) {
	return safe(() => {
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > 50 ||
			!Number.isInteger(offset) ||
			offset < 0
		)
			fail('invalid_request', 'Invalid backup pagination.');
		const p = storage();
		const all = [p.backups, p.legacyBackups]
			.filter(existsSync)
			.flatMap((directory) =>
				readdirSync(directory)
					.filter((n) => UUID.test(n.replace(/\.json$/, '')) && n.endsWith('.json'))
					.flatMap((name) => {
						try {
							const m = json(join(directory, name));
							if (m.backup_id !== name.slice(0, -5)) return [];
							regular(join(directory, `${m.backup_id}.sqlite`));
							return [m];
						} catch {
							return [];
						}
					})
			)
			.sort(
				(a, b) => b.created_at.localeCompare(a.created_at) || b.backup_id.localeCompare(a.backup_id)
			);
		return {
			backups: all.slice(offset, offset + limit),
			next_offset: all.length > offset + limit ? offset + limit : null
		};
	});
}
export function inspectBackup(backupId) {
	return safe(() => inspectPath(getBackupFile(backupId).path));
}
function locked(operation, validateRecords = true) {
	if (!existsSync(paths().database))
		fail('not_found', 'Saturday database not found. Run setup first.');
	const db = connect(paths().database, false);
	try {
		return inTransaction(db, () => {
			if (validateRecords) validate(db);
			else validateSchema(db);
			return operation(db);
		});
	} finally {
		db.close();
	}
}
function insertData(db, data, preserveCounters = false) {
	const sameDataset =
		db.prepare('SELECT dataset_id FROM app_metadata WHERE id=1').get()?.dataset_id ===
		data.app_metadata[0].dataset_id;
	const previous = preserveCounters && sameDataset ? allocatorState(db) : {};
	db.exec('DELETE FROM app_metadata');
	for (const [table, fields] of Object.entries(columnsFor())) {
		const statement = db.prepare(
			`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`
		);
		for (const row of data[table]) statement.run(...fields.map((key) => row[key]));
	}
	db.exec('DELETE FROM sqlite_sequence');
	const sequence = db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)');
	for (const table of allocatedTables)
		sequence.run(table, Math.max(data.$sequence[table], previous[table] ?? 0));
}
function cleanup(now) {
	const p = storage();
	for (const name of readdirSync(p.restore).filter(
		(n) => n.endsWith('.json') && UUID.test(n.slice(0, -5))
	)) {
		const restoreId = name.slice(0, -5);
		if (existsSync(join(p.restore, `${restoreId}.claim`))) continue;
		try {
			if (Date.parse(json(join(p.restore, name)).expires_at) <= now) {
				rmSync(join(p.restore, `${restoreId}.sqlite`), { force: true });
				unlinkSync(join(p.restore, name));
			}
		} catch {
			/* An incomplete preparation is never usable. */
		}
	}
}
export function prepareRestore(backupId, { now = Date.now() } = {}) {
	return safe(() =>
		locked((db) => {
			cleanup(now);
			const p = storage();
			const source = getBackupFile(backupId);
			const restoreId = randomUUID();
			const stagePath = join(p.restore, `${restoreId}.sqlite`);
			let stage, incoming;
			try {
				incoming = connect(source.path);
				validate(incoming);
				stage = connect(stagePath, false);
				applyMigrations(stage, databaseVersion(incoming));
				inTransaction(stage, () => insertData(stage, dataset(incoming)), { checkFiles: false });
				const incomingSummary = validate(stage);
				const unmatchedJobFolders = fileFolderImpact(stage);
				stage.close();
				stage = null;
				chmodSync(stagePath, 0o600);
				syncFile(stagePath);
				const preview = {
					restore_id: restoreId,
					backup_id: backupId,
					expires_at: new Date(now + 600000).toISOString(),
					current: summary(db),
					file_dataset_id: fileDatasetId(),
					files_match_incoming: fileDatasetId() === incomingSummary.dataset_id,
					unmatched_job_folders: unmatchedJobFolders,
					incoming: incomingSummary,
					requires_confirmation: true,
					warning:
						'Restoring replaces all current jobs, people, relationships and history. A complete recovery backup will be created first.' +
						(fileDatasetId() && fileDatasetId() !== incomingSummary.dataset_id
							? ' Current job files belong to another dataset and will be blocked until matching files are restored. Matching folder numbers do not establish ownership.'
							: '')
				};
				atomicJSON(join(p.restore, `${restoreId}.json`), {
					...preview,
					target: root(),
					sha256: digest(stagePath),
					fingerprint: fingerprint(db)
				});
				return preview;
			} catch (error) {
				rmSync(stagePath, { force: true });
				throw error;
			} finally {
				incoming?.close();
				stage?.close();
			}
		})
	);
}
export function restoreBackup(restoreId, confirm, { now = Date.now(), beforeCommit } = {}) {
	return safe(() => {
		if (confirm !== true)
			fail(
				'confirmation_required',
				'Explicit confirmation is required after reviewing the restore preview.'
			);
		const p = storage();
		id(restoreId);
		const recordPath = join(p.restore, `${restoreId}.json`);
		if (!existsSync(recordPath)) fail('not_found', 'Prepare the restore first.');
		const claim = join(p.restore, `${restoreId}.claim`);
		try {
			mkdirSync(claim, { mode: 0o700 });
			syncDirectory(p.restore);
		} catch (error) {
			if (error.code === 'EEXIST')
				fail('restore_consumed', 'This restore has already been attempted. Prepare again.');
			throw error;
		}
		const record = json(recordPath);
		const stagePath = join(p.restore, `${restoreId}.sqlite`);
		try {
			if (Date.parse(record.expires_at) <= now)
				fail('restore_expired', 'This preview has expired. Prepare again.');
			if (record.target !== root() || digest(stagePath) !== record.sha256)
				fail('restore_stale', 'The restore source or target has changed. Prepare again.');
			const stage = connect(stagePath);
			let result;
			try {
				validate(stage);
				const incoming = dataset(stage);
				const expectedHash = dataHash(stage);
				result = locked((db) => {
					if (fileDatasetId() !== record.file_dataset_id)
						fail('restore_stale', 'File dataset changed after the preview. Prepare again.');
					if (fingerprint(db) !== record.fingerprint)
						fail('restore_stale', 'Current records changed after the preview. Prepare again.');
					const recovery = snapshot('recovery', now);
					db.exec(
						'DELETE FROM network_updates; DELETE FROM job_networks; DELETE FROM job_updates; DELETE FROM networks; DELETE FROM jobs;'
					);
					insertData(db, incoming, true);
					reserveJobFileIds(db);
					beforeCommit?.();
					validate(db);
					if (dataHash(db) !== expectedHash)
						fail('invalid_backup', 'Restored records did not match the backup.');
					return { restore_id: restoreId, ...summary(db), recovery_backup_id: recovery.backup_id };
				});
			} finally {
				stage.close();
			}
			// Commit already succeeded. Cleanup failure must not report a rolled-back restore.
			try {
				atomicJSON(recordPath, { ...record, status: 'completed', result });
				rmSync(stagePath, { force: true });
			} catch (error) {
				result.cleanup_warning =
					'Records were restored, but temporary-file cleanup failed. Do not retry this restore.';
			}
			return result;
		} catch (error) {
			try {
				atomicJSON(recordPath, {
					...record,
					status: 'failed_or_uncertain',
					error: publicBackupError(error)
				});
			} catch {}
			throw error;
		}
	});
}
// Publish pair membership only after both independently downloadable artifacts exist.
export function completeBackupPair(backupId, pair, kind, now) {
	const metadata = getBackupFile(backupId).metadata;
	atomicJSON(join(dirname(getBackupFile(backupId).path), `${id(backupId)}.json`), {
		...metadata,
		kind,
		created_at: new Date(now).toISOString(),
		status: 'complete',
		contents: 'all',
		backup_set_id: pair.backup_set_id,
		file_backup_id: pair.file_backup_id
	});
}
export function exportBackup(backupId, destination) {
	return safe(() => {
		const target = resolve(destination);
		const p = paths();
		if (
			target === p.database ||
			target.startsWith(`${p.database}-`) ||
			target === p.backups ||
			target.startsWith(`${p.backups}/`) ||
			target === p.restore ||
			target.startsWith(`${p.restore}/`)
		)
			fail('destination_exists', 'Choose a new destination outside Saturday database storage.');
		const file = getBackupFile(backupId);
		try {
			copyFileSync(file.path, target, constants.COPYFILE_EXCL);
			syncFile(target);
		} catch (error) {
			if (error.code === 'EEXIST')
				fail('destination_exists', 'The destination already exists. Choose a new filename.');
			throw error;
		}
		return target;
	});
}

// The database write gate remains held while the file half is published. Unlike
// inTransaction, this explicitly awaits the coordinated file work before COMMIT.
export async function restoreDatabaseWithFiles(restoreId, fileOperation) {
	const p = storage();
	id(restoreId);
	const recordPath = join(p.restore, `${restoreId}.json`);
	const record = json(recordPath);
	const stagePath = join(p.restore, `${restoreId}.sqlite`);
	if (
		Date.parse(record.expires_at) <= Date.now() ||
		record.target !== root() ||
		digest(stagePath) !== record.sha256
	)
		fail('restore_stale', 'Prepare the coordinated restore again.');
	const claim = join(p.restore, `${restoreId}.claim`);
	try {
		mkdirSync(claim, { mode: 0o700 });
	} catch {
		fail('restore_consumed', 'This restore has already been attempted.');
	}
	const stage = connect(stagePath);
	const db = connect(p.database, false);
	let committed = false;
	try {
		validate(stage);
		db.exec('BEGIN IMMEDIATE');
		validate(db);
		assertFileStorageCompatible();
		if (fingerprint(db) !== record.fingerprint)
			fail('restore_stale', 'Current records changed. Prepare again.');
		if (fileDatasetId() !== record.file_dataset_id)
			fail('restore_stale', 'File dataset changed. Prepare again.');
		const recovery = snapshot('recovery');
		const files = await fileOperation(recovery, summary(stage));
		db.exec(
			'DELETE FROM network_updates; DELETE FROM job_networks; DELETE FROM job_updates; DELETE FROM networks; DELETE FROM jobs;'
		);
		insertData(db, dataset(stage), true);
		reserveJobFileIds(db);
		validate(db);
		if (dataHash(db) !== dataHash(stage)) fail('invalid_backup', 'Database verification failed.');
		db.exec('COMMIT');
		committed = true;
		const result = {
			restore_id: restoreId,
			...summary(db),
			recovery_backup_id: recovery.backup_id
		};
		try {
			atomicJSON(recordPath, { ...record, status: 'completed', result });
			rmSync(stagePath, { force: true });
		} catch {}
		return { database: result, files };
	} finally {
		if (!committed) {
			try {
				db.exec('ROLLBACK');
			} catch {}
		}
		db.close();
		stage.close();
	}
}

function fileDatasetId() {
	assertFileStorageCompatible();
	try {
		return JSON.parse(readFileSync(join(getInstallation().files, 'manifest.json'), 'utf8'))
			.dataset_id;
	} catch (e) {
		if (e.code === 'ENOENT') return null;
		throw e;
	}
}
function fileFolderImpact(incoming) {
	try {
		const root = getInstallation().files;
		const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
		const ids = new Set(
			incoming
				.prepare('SELECT id FROM jobs')
				.all()
				.map((j) => String(j.id))
		);
		return [
			...new Set(
				m.documents.filter((d) => d.key.startsWith('jobs/')).map((d) => d.key.split('/')[1])
			)
		].filter(
			(id) =>
				m.dataset_id !==
					incoming.prepare('SELECT dataset_id FROM app_metadata WHERE id=1').get().dataset_id ||
				!ids.has(id)
		);
	} catch {
		return null;
	}
}

export function markIncompleteBackup(backupId, message) {
	const file = getBackupFile(backupId);
	atomicJSON(join(dirname(file.path), `${id(backupId)}.json`), {
		...file.metadata,
		contents: 'all',
		status: 'partial',
		error: message
	});
}
export const inspectBackupPath = (path) => safe(() => inspectPath(path));
export function assertBackupDeletionAllowed(backupId) {
	const pairSession = join(getInstallation().files_state, 'pair-session.json');
	if (existsSync(pairSession) && json(pairSession).recovery_database_id === backupId)
		fail('database_busy', 'This backup is required for interrupted restore recovery.');

	const file = getBackupFile(backupId, { verify: false }),
		p = storage();
	for (const name of readdirSync(p.restore).filter(
		(n) => UUID.test(n.slice(0, -5)) && n.endsWith('.json')
	)) {
		const preview = json(join(p.restore, name));
		if (
			preview.backup_id === backupId &&
			((!preview.status && existsSync(join(p.restore, `${preview.restore_id}.claim`))) ||
				(!preview.status && Date.parse(preview.expires_at) > Date.now()))
		)
			fail(
				'database_busy',
				'This backup has an active restore preview. Wait for it to expire before deleting.'
			);
		if (preview.recovery_backup_id === backupId && preview.status === 'failed_or_uncertain')
			fail('database_busy', 'This backup is required for interrupted restore recovery.');
	}
	return file;
}
export function deleteBackup(backupId, confirm) {
	if (confirm !== true) fail('confirmation_required', 'Confirm deletion of the selected backup.');
	return locked(() => {
		const file = assertBackupDeletionAllowed(backupId);
		unlinkSync(file.path);
		unlinkSync(join(dirname(file.path), `${id(backupId)}.json`));
		return { deleted: true };
	}, false);
}
