import { withServerActivity } from './server-lifecycle.js';
import { getInstallation, assertInstallationStorage } from './installation.js';
import { migrations, applyMigrations, assertMigrationHistory } from './migrations.js';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { assertManifestCompatibility } from './compatibility.js';
import { ServiceError } from './validation.js';
import { dirname, resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function getProjectRoot() {
	return getInstallation().code_root;
}
export function getDatabasePath() {
	return getInstallation().database;
}
let recoveringFiles = false;
export function withDatabaseRecovery(operation) {
	recoveringFiles = true;
	try {
		return operation();
	} finally {
		recoveringFiles = false;
	}
}
export function assertDatabaseAvailable() {
	if (!recoveringFiles && existsSync(join(getInstallation().files_state, 'pair-session.json')))
		throw Object.assign(
			new Error(
				'An interrupted coordinated restore requires offline recovery: npm run files -- recover-pair'
			),
			{ code: 'RECOVERY_REQUIRED' }
		);
}

export function openDatabase({ migrate = true } = {}) {
	assertDatabaseAvailable();
	assertInstallationStorage();
	const path = getDatabasePath();
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
	try {
		if (migrate) {
			assertFileStorageCompatible();
			applyMigrations(db);
		} else assertMigrationHistory(db);
		return db;
	} catch (error) {
		db.close();
		if (String(error.message).includes('Unsupported database schema'))
			throw new ServiceError(
				error.message + ' Restart all Saturday processes with the matching build.',
				'unsupported_schema'
			);
		throw error;
	}
}

export function migrateDatabase() {
	const db = openDatabase({ migrate: false });
	try {
		assertFileStorageCompatible();
		applyMigrations(db);
		return { path: getDatabasePath(), version: migrations.at(-1)?.version ?? 0 };
	} finally {
		db.close();
	}
}

export function withDatabase(callback) {
	const db = openDatabase();
	try {
		return callback(db);
	} finally {
		db.close();
	}
}

// Inspect an existing database without initializing or migrating it. File backups
// can still operate when the database is absent; a new file store binds explicitly.
export function databaseIdentity() {
	if (!existsSync(getDatabasePath())) return null;
	const db = new DatabaseSync(getDatabasePath(), { readOnly: true, allowExtension: false });
	try {
		assertMigrationHistory(db);
		const identity = db.prepare('SELECT format, dataset_id FROM app_metadata WHERE id=1').get();
		if (!identity) throw new Error('Unsupported database schema. Restart with a compatible build.');
		return identity;
	} finally {
		db.close();
	}
}

export function assertFileStorageCompatible() {
	const path = resolve(getInstallation().files, 'manifest.json');
	try {
		assertManifestCompatibility(JSON.parse(readFileSync(path, 'utf8')));
	} catch (error) {
		if (error.code !== 'ENOENT')
			throw new ServiceError(
				error.code === 'FORMAT'
					? error.message
					: 'File store could not be validated. Stop Saturday and use offline recovery.',
				'FORMAT'
			);
	}
}

// Independent snapshots may be taken at different times. Reserve IDs still
// represented by same-dataset folders before creating records or publishing a DB restore.
export function reserveJobFileIds(db) {
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(join(getInstallation().files, 'manifest.json'), 'utf8'));
	} catch (e) {
		if (e.code === 'ENOENT') return;
		throw e;
	}
	assertManifestCompatibility(manifest);
	if (
		manifest.dataset_id !==
		db.prepare('SELECT dataset_id FROM app_metadata WHERE id=1').get().dataset_id
	)
		return;
	let maximum = 0;
	for (const entry of manifest.documents) {
		if (!entry.key.startsWith('jobs/')) continue;
		const segment = entry.key.split('/')[1];
		if (!/^[1-9]\d*$/.test(segment) || !Number.isSafeInteger(Number(segment)))
			throw new Error('Unsupported job folder ID. Use offline file recovery.');
		maximum = Math.max(maximum, Number(segment));
	}
	const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='jobs'").get();
	if (sequence)
		db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq, ?) WHERE name='jobs'").run(maximum);
	else if (maximum)
		db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run('jobs', maximum);
}

export function inTransaction(db, callback, { checkFiles = true } = {}) {
	return withServerActivity(() => {
		db.exec('BEGIN IMMEDIATE');
		try {
			assertMigrationHistory(db);
			if (checkFiles) assertFileStorageCompatible();
			const result = callback();
			db.exec('COMMIT');
			return result;
		} catch (error) {
			try {
				db.exec('ROLLBACK');
			} catch {}
			throw error;
		}
	});
}
