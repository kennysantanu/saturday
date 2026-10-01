import { mkdirSync } from 'node:fs';
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

const migrations = [
	{
		version: 1,
		name: 'create_jobs_and_job_updates',
		sql: `
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  job_title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  posting_url TEXT,
  job_description TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'mcp')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE job_updates (
  recorded_order INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  event_type TEXT CHECK (event_type IN
    ('applied', 'prescreened', 'interview_1', 'interview_2',
      'offer', 'accepted', 'rejected', 'dismissed', 'reopened')),
  event_date TEXT NOT NULL,
  note TEXT,
  created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'mcp')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (event_type IS NOT NULL OR (note IS NOT NULL AND length(trim(note)) > 0))
);

CREATE INDEX job_updates_timeline
  ON job_updates(job_id, event_date DESC, recorded_order DESC);

CREATE INDEX job_updates_by_type
  ON job_updates(event_type, job_id);
`
	}
];

export function getDatabasePath() {
	const configuredPath = process.env.SATURDAY_DB_PATH;
	if (!configuredPath) return resolve(projectRoot, 'data', 'saturday.db');
	return isAbsolute(configuredPath) ? configuredPath : resolve(projectRoot, configuredPath);
}

function applyMigrations(db) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TEXT NOT NULL
		);
	`);
	const applied = new Set(
		db
			.prepare('SELECT version FROM schema_migrations')
			.all()
			.map((row) => Number(row.version))
	);
	for (const migration of migrations) {
		if (applied.has(migration.version)) continue;
		db.exec('BEGIN IMMEDIATE');
		try {
			db.exec(migration.sql);
			db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
				migration.version,
				migration.name,
				new Date().toISOString()
			);
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}
	}
}

export function openDatabase({ migrate = true } = {}) {
	const path = getDatabasePath();
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
	if (migrate) applyMigrations(db);
	return db;
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
		db.exec('ROLLBACK');
		throw error;
	}
}
