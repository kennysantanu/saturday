import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const databaseFormat = 'saturday.database.workflow';

export const migrations = [
	{
		version: 1,
		name: 'create_workflow_baseline',
		sql: `
CREATE TABLE app_metadata (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 format TEXT NOT NULL CHECK (format = '${databaseFormat}'),
 dataset_id TEXT NOT NULL
);

CREATE TABLE workflow_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT
    CHECK (id BETWEEN 1 AND 9007199254740991),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  is_closed INTEGER NOT NULL DEFAULT 0 CHECK (is_closed IN (0, 1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX workflow_stages_order
  ON workflow_stages(is_archived, is_closed, sort_order, id);

INSERT INTO workflow_stages(name, sort_order, is_closed, created_at, updated_at) VALUES
  ('New', 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('Applied', 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('Screening', 2, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('Interview', 3, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('Offer', 4, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('Accepted', 5, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('Rejected', 6, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('Dismissed', 7, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT
    CHECK (id BETWEEN 1 AND 9007199254740991),
  job_title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  posting_url TEXT,
  job_description TEXT,
  notes TEXT,

  current_stage_id INTEGER NOT NULL REFERENCES workflow_stages(id) ON DELETE RESTRICT,

  created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'mcp')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  location TEXT,
  work_arrangement TEXT CHECK (work_arrangement IN ('remote', 'hybrid', 'on-site')),
  employment_type TEXT CHECK (employment_type IN ('full-time', 'part-time', 'contract', 'internship', 'temporary')),
  compensation TEXT,
  source TEXT,
  application_deadline TEXT,
  follow_up_date TEXT,
  follow_up_comment TEXT CHECK (follow_up_comment IS NULL OR follow_up_date IS NOT NULL),
  is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
  score REAL,
  score_comment TEXT
);

CREATE INDEX jobs_current_stage ON jobs(current_stage_id, id);
CREATE INDEX jobs_follow_up ON jobs(follow_up_date)
  WHERE follow_up_date IS NOT NULL;
CREATE INDEX jobs_application_deadline ON jobs(application_deadline)
  WHERE application_deadline IS NOT NULL;

CREATE TABLE job_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT
    CHECK (id BETWEEN 1 AND 9007199254740991),
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  stage_id INTEGER REFERENCES workflow_stages(id) ON DELETE RESTRICT,
  event_date TEXT NOT NULL,
  note TEXT,
  created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'mcp')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (stage_id IS NOT NULL OR length(trim(COALESCE(note, ''))) > 0)
);

CREATE INDEX job_updates_timeline
  ON job_updates(job_id, event_date DESC, id DESC);
CREATE INDEX job_updates_by_stage
  ON job_updates(stage_id, job_id) WHERE stage_id IS NOT NULL;

CREATE TABLE networks (
 id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991),
 name TEXT NOT NULL CHECK (length(trim(name)) > 0),
 role TEXT, organization TEXT, phone TEXT, email TEXT, link TEXT, notes TEXT,
 follow_up_date TEXT,
 follow_up_comment TEXT CHECK (follow_up_comment IS NULL OR follow_up_date IS NOT NULL),
 created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'mcp')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE job_networks (
 job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
 network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE RESTRICT,
 notes TEXT,
 created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'mcp')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY (job_id, network_id)
);
CREATE INDEX job_networks_by_person ON job_networks(network_id, job_id);
CREATE TABLE network_updates (
 id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991),
 network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE RESTRICT,
 interaction_date TEXT NOT NULL,
 note TEXT NOT NULL CHECK (length(trim(note)) > 0),
 created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'mcp')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX network_updates_timeline
 ON network_updates(network_id, interaction_date DESC, id DESC);
`
	}
];

export const schemaVersion = migrations.at(-1)?.version ?? 0;
const migrationTable = `CREATE TABLE IF NOT EXISTS schema_migrations (
 version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
);`;
const unsupported = () => {
	throw new Error(
		'Unsupported database schema. This development build requires the workflow baseline. Use a compatible build or explicitly reset development data; startup never resets it.'
	);
};
const signature = (db) =>
	JSON.stringify(
		db
			.prepare(
				"SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
			)
			.all()
			.map((row) => ({ ...row, sql: row.sql?.replace(/\s+/g, '').replace(/IFNOTEXISTS/gi, '') }))
	);
const expectedSignatures = new Map();
function expectedSignature(version) {
	if (!expectedSignatures.has(version)) {
		const db = new DatabaseSync(':memory:');
		try {
			db.exec(migrationTable);
			for (const migration of migrations) if (migration.version <= version) db.exec(migration.sql);
			expectedSignatures.set(version, signature(db));
		} finally {
			db.close();
		}
	}
	return expectedSignatures.get(version);
}

export function assertMigrationHistory(db) {
	const tables = db.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
	if (!tables.length) return;
	if (!tables.some((row) => row.name === 'schema_migrations')) unsupported();
	let rows;
	try {
		rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
	} catch {
		unsupported();
	}
	if (
		rows.length < 1 ||
		rows.length > migrations.length ||
		rows.some((row, i) => row.version !== migrations[i].version || row.name !== migrations[i].name)
	)
		unsupported();
	if (signature(db) !== expectedSignature(rows.length)) unsupported();
	const metadata = db.prepare('SELECT * FROM app_metadata').all();
	if (
		metadata.length !== 1 ||
		metadata[0].id !== 1 ||
		metadata[0].format !== databaseFormat ||
		typeof metadata[0].dataset_id !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			metadata[0].dataset_id
		)
	)
		unsupported();
}

export function applyMigrations(db, targetVersion = schemaVersion) {
	if (!Number.isInteger(targetVersion) || targetVersion < 1 || targetVersion > schemaVersion)
		unsupported();
	db.exec('BEGIN IMMEDIATE');
	try {
		assertMigrationHistory(db);
		db.exec(migrationTable);
		const applied = new Set(
			db
				.prepare('SELECT version FROM schema_migrations')
				.all()
				.map((row) => row.version)
		);
		if ([...applied].some((version) => version > targetVersion)) unsupported();
		for (const migration of migrations) {
			if (applied.has(migration.version) || migration.version > targetVersion) continue;
			db.exec(migration.sql);
			if (migration.version === 1)
				db.prepare('INSERT INTO app_metadata (id, format, dataset_id) VALUES (1, ?, ?)').run(
					databaseFormat,
					randomUUID()
				);
			db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
				migration.version,
				migration.name,
				new Date().toISOString()
			);
		}
		db.exec('COMMIT');
	} catch (error) {
		try {
			db.exec('ROLLBACK');
		} catch {}
		throw error;
	}
}
