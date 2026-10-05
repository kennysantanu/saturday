export const migrations = [
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
	},
	{
		version: 2,
		name: 'add_optional_job_details',
		sql: `
ALTER TABLE jobs ADD COLUMN location TEXT;
ALTER TABLE jobs ADD COLUMN work_arrangement TEXT CHECK (work_arrangement IN ('remote', 'hybrid', 'on-site'));
ALTER TABLE jobs ADD COLUMN employment_type TEXT CHECK (employment_type IN ('full-time', 'part-time', 'contract', 'internship', 'temporary'));
ALTER TABLE jobs ADD COLUMN compensation TEXT;
ALTER TABLE jobs ADD COLUMN source TEXT;
ALTER TABLE jobs ADD COLUMN application_deadline TEXT;
ALTER TABLE jobs ADD COLUMN follow_up_date TEXT;
ALTER TABLE jobs ADD COLUMN follow_up_comment TEXT CHECK (follow_up_comment IS NULL OR follow_up_date IS NOT NULL);
ALTER TABLE jobs ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0 CHECK (is_starred IN (0, 1));
ALTER TABLE jobs ADD COLUMN score REAL;
ALTER TABLE jobs ADD COLUMN score_comment TEXT;
CREATE INDEX jobs_follow_up ON jobs(follow_up_date) WHERE is_active = 1 AND follow_up_date IS NOT NULL;
CREATE INDEX jobs_application_deadline ON jobs(application_deadline) WHERE is_active = 1 AND application_deadline IS NOT NULL;
`
	}
];

export const schemaVersion = migrations.at(-1)?.version ?? 0;

export function assertMigrationHistory(db) {
	const exists = db
		.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='schema_migrations'")
		.get();
	if (!exists) return;
	const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
	for (let i = 0; i < rows.length; i++) {
		if (rows[i].version !== migrations[i]?.version || rows[i].name !== migrations[i]?.name) {
			throw new Error('Unsupported database schema. Update Saturday before using this database.');
		}
	}
}

export function applyMigrations(db, targetVersion = schemaVersion) {
	db.exec('BEGIN IMMEDIATE');
	try {
		assertMigrationHistory(db);
		db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
   version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
  );`);
		const applied = new Set(
			db
				.prepare('SELECT version FROM schema_migrations')
				.all()
				.map((row) => row.version)
		);
		for (const migration of migrations) {
			if (applied.has(migration.version) || migration.version > targetVersion) continue;
			db.exec(migration.sql);
			db.prepare('INSERT INTO schema_migrations (version,name,applied_at) VALUES (?,?,?)').run(
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
