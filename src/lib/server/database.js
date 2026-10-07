import { migrations, applyMigrations, assertMigrationHistory } from './migrations.js';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export function getProjectRoot() {
	if (process.env.SATURDAY_PROJECT_ROOT) return resolve(process.env.SATURDAY_PROJECT_ROOT);
	const entry = process.argv[1] ? resolve(process.argv[1]) : '';
	if (entry.endsWith(`${sep}build${sep}mcp${sep}index.js`)) return resolve(dirname(entry), '../..');
	if (entry.endsWith(`${sep}build${sep}index.js`)) return resolve(dirname(entry), '..');
	return fileURLToPath(new URL('../../../', import.meta.url));
}

const projectRoot = getProjectRoot();

export function getDatabasePath() {
	const configuredPath = process.env.SATURDAY_DB_PATH;
	if (!configuredPath) return resolve(projectRoot, 'data', 'saturday.db');
	return isAbsolute(configuredPath) ? configuredPath : resolve(projectRoot, configuredPath);
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
	const filesRoot = resolve(getProjectRoot(), process.env.SATURDAY_FILES_PATH || 'data/files');
	if (!recoveringFiles && existsSync(`${filesRoot}.state/pair-session.json`))
		throw Object.assign(
			new Error(
				'An interrupted coordinated restore requires offline recovery: npm run files -- recover-pair'
			),
			{ code: 'RECOVERY_REQUIRED' }
		);
}

export function openDatabase({ migrate = true } = {}) {
	assertDatabaseAvailable();
	const path = getDatabasePath();
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
	try {
		if (migrate) applyMigrations(db);
		else assertMigrationHistory(db);
		return db;
	} catch (error) {
		db.close();
		throw error;
	}
}

export function migrateDatabase() {
	const db = openDatabase({ migrate: false });
	try {
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

export function inTransaction(db, callback) {
	db.exec('BEGIN IMMEDIATE');
	try {
		const result = callback();
		db.exec('COMMIT');
		return result;
	} catch (error) {
		try {
			db.exec('ROLLBACK');
		} catch {}
		throw error;
	}
}
