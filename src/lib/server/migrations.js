import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import baselines from '../../../release-baselines.json' with { type: 'json' };

export const databaseFormat = 'saturday.database';

export const migrations = [
	{
		version: 1,
		name: 'create_initial_schema',
		sql:
			`
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

  created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'assistant')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  location TEXT,
  work_arrangement TEXT CHECK (work_arrangement IN ('remote', 'hybrid', 'on-site')),
  employment_type TEXT CHECK (employment_type IN ('full-time', 'part-time', 'contract', 'internship', 'temporary')),
  compensation TEXT,
  source TEXT,
  application_deadline TEXT,
  is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1)),
  score REAL,
  score_comment TEXT
);

CREATE INDEX jobs_current_stage ON jobs(current_stage_id, id);
CREATE INDEX jobs_application_deadline ON jobs(application_deadline)
  WHERE application_deadline IS NOT NULL;

CREATE TABLE job_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT
    CHECK (id BETWEEN 1 AND 9007199254740991),
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  stage_id INTEGER REFERENCES workflow_stages(id) ON DELETE RESTRICT,
  event_date TEXT NOT NULL,
  note TEXT,
  created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'assistant')),
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
 created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'assistant')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE job_networks (
 job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
 network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE RESTRICT,
 notes TEXT,
 created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'assistant')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY (job_id, network_id)
);
CREATE INDEX job_networks_by_person ON job_networks(network_id, job_id);
CREATE TABLE network_updates (
 id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991),
 network_id INTEGER NOT NULL REFERENCES networks(id) ON DELETE RESTRICT,
 interaction_date TEXT NOT NULL,
 note TEXT NOT NULL CHECK (length(trim(note)) > 0),
 created_via TEXT NOT NULL CHECK (created_via IN ('manual', 'assistant')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX network_updates_timeline
 ON network_updates(network_id, interaction_date DESC, id DESC);

CREATE TABLE reminders (
 id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (id BETWEEN 1 AND 9007199254740991),
 job_id INTEGER REFERENCES jobs(id) ON DELETE RESTRICT,
 network_id INTEGER REFERENCES networks(id) ON DELETE RESTRICT,
 note TEXT,
 scheduled_at TEXT NOT NULL,
 is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
 dismissed_at TEXT,
 created_via TEXT NOT NULL CHECK (created_via IN ('manual','assistant')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK ((job_id IS NOT NULL) != (network_id IS NOT NULL)),
 CHECK ((is_active=1 AND dismissed_at IS NULL) OR (is_active=0 AND dismissed_at IS NOT NULL))
);
CREATE INDEX reminders_job ON reminders(job_id,is_active,scheduled_at,id);
CREATE INDEX reminders_person ON reminders(network_id,is_active,scheduled_at,id);
CREATE INDEX reminders_active ON reminders(is_active,scheduled_at,id);
` +
			['job', 'network']
				.map((kind) => {
					const owner = kind === 'job' ? 'jobs' : 'networks';
					return `
CREATE TABLE ${kind}_tags (
 id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id BETWEEN 1 AND 9007199254740991),
 name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 50 AND name NOT GLOB '*[^a-z0-9_]*' AND substr(name,1,1)!='_' AND substr(name,-1,1)!='_' AND instr(name,'__')=0),
 color TEXT NOT NULL DEFAULT '#64748b' CHECK(length(color)=7 AND substr(color,1,1)='#' AND substr(color,2) NOT GLOB '*[^a-f0-9]*'),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE ${kind}_tag_assignments (
 ${kind}_id INTEGER NOT NULL REFERENCES ${owner}(id) ON DELETE RESTRICT,
 tag_id INTEGER NOT NULL REFERENCES ${kind}_tags(id) ON DELETE RESTRICT,
 PRIMARY KEY(${kind}_id,tag_id)
);
CREATE INDEX ${kind}_tags_reverse ON ${kind}_tag_assignments(tag_id,${kind}_id);
`;
				})
				.join('') +
			`
CREATE TABLE navigation_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 recents_enabled INTEGER NOT NULL DEFAULT 1 CHECK(recents_enabled IN (0,1)),
 recent_limit INTEGER NOT NULL DEFAULT 10 CHECK(recent_limit IN (5,10,20))
);
INSERT INTO navigation_settings(id) VALUES(1);
CREATE TABLE recent_job_views (
 job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
 viewed_at INTEGER NOT NULL CHECK(viewed_at>0)
);
CREATE INDEX recent_jobs_order ON recent_job_views(viewed_at DESC,job_id DESC);
CREATE TABLE recent_network_views (
 network_id INTEGER PRIMARY KEY REFERENCES networks(id) ON DELETE CASCADE,
 viewed_at INTEGER NOT NULL CHECK(viewed_at>0)
);
CREATE INDEX recent_networks_order ON recent_network_views(viewed_at DESC,network_id DESC);
`
	}
];

export const schemaVersion = migrations.at(-1)?.version ?? 0;

export function migrationChecksums() {
	return migrations.map(({ version, name, sql }) => ({
		version,
		name,
		sha256: createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex')
	}));
}

// Validate definitions before opening any database, including during setup/builds.
if (baselines.format !== 'saturday.release-baselines' || baselines.version !== 1)
	throw new Error('Unsupported release baseline lock.');
const names = new Set();
for (const [index, migration] of migrations.entries()) {
	if (
		migration.version !== index + 1 ||
		typeof migration.name !== 'string' ||
		!migration.name.trim() ||
		names.has(migration.name) ||
		typeof migration.sql !== 'string' ||
		!migration.sql.trim()
	)
		throw new Error('Migrations must have unique names and consecutive versions starting at 1.');
	names.add(migration.name);
}
const checksums = migrationChecksums();
for (const release of baselines.releases)
	for (const frozen of release.migrations) {
		const current = checksums[frozen.version - 1];
		if (current?.name !== frozen.name || current?.sha256 !== frozen.sha256)
			throw new Error(
				`Released migration ${frozen.version} is immutable. Restore it and append a new numbered migration.`
			);
	}
const migrationTable = `CREATE TABLE IF NOT EXISTS schema_migrations (
 version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
);`;
const unsupported = () => {
	throw new Error(
		'Unsupported database schema. Use a compatible version of Saturday. Existing data has not been changed.'
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

export function databaseSchemaChecksum(version = schemaVersion) {
	return createHash('sha256').update(expectedSignature(version)).digest('hex');
}
// The ledger and complete initial table/index definitions are locked as well as SQL.
for (const release of baselines.releases)
	if (
		databaseSchemaChecksum(release.storage.database.currentVersion) !==
		release.database_schema_sha256
	)
		throw new Error('Released database schema is immutable. Append a numbered migration instead.');
