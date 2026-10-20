import { stageId, closeJob, reopenJob } from './workflow-fixture.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, schemaVersion } from '../src/lib/server/migrations.js';
import { jobFields, jobColumns, jobForMcp } from '../src/lib/job-fields.js';
import { jobMcpInputShape, followUpMcpSchema } from '../src/lib/server/validation.js';
import { z } from 'zod';
import { migrateDatabase, withDatabase, openDatabase } from '../src/lib/server/database.js';
import {
	createJob,
	editJob,
	getJob,
	setJobScore,
	setJobFollowUp,
	setJobStarred,
	getDashboardStats,
	addJobUpdate,
	correctJobUpdate
} from '../src/lib/server/services.js';
import {
	createBackup,
	importBackup,
	getBackupFile,
	prepareRestore,
	restoreBackup
} from '../src/lib/server/backups.js';
const previous = process.env.SATURDAY_DB_PATH;
const previousFiles = process.env.SATURDAY_FILES_PATH;
let scratch;
beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'saturday-job-details-'));
	process.env.SATURDAY_DB_PATH = join(scratch, 'career.sqlite');
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	migrateDatabase();
});
afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	if (previous === undefined) delete process.env.SATURDAY_DB_PATH;
	else process.env.SATURDAY_DB_PATH = previous;
	if (previousFiles === undefined) delete process.env.SATURDAY_FILES_PATH;
	else process.env.SATURDAY_FILES_PATH = previousFiles;
});
const details = {
	job_title: 'Engineer',
	company_name: 'Example',
	location: 'San Francisco',
	work_arrangement: 'hybrid',
	employment_type: 'full-time',
	compensation: '$120k–$150k/year + equity',
	source: 'Referral',
	application_deadline: '2026-11-01',
	follow_up_date: '2026-10-01',
	follow_up_comment: 'Ask about next steps',
	is_starred: true
};
test('UUID development baseline is rejected unchanged even when its version is 1', () => {
	const legacy = join(scratch, 'legacy.sqlite');
	const db = new DatabaseSync(legacy);
	db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
 INSERT INTO schema_migrations VALUES (1, 'create_jobs_and_job_updates', '2026-10-01');
 CREATE TABLE jobs (id TEXT PRIMARY KEY, job_title TEXT);
 INSERT INTO jobs VALUES ('old-id', 'Keep this');`);
	db.close();
	const before = readFileSync(legacy);
	process.env.SATURDAY_DB_PATH = legacy;
	assert.throws(() => migrateDatabase(), /Unsupported database schema/);
	assert.deepEqual(readFileSync(legacy), before);
});
test('numeric baseline allocates records, retains dataset identity and never reuses deleted update IDs', () => {
	const job = createJob(details);
	assert.equal(job.id, 1);
	assert.equal(createJob(details).id, 2);
	const first = addJobUpdate({ job_id: job.id, event_date: '2026-01-02', note: 'First' });
	correctJobUpdate(first.id, { job_id: job.id, remove: true });
	const next = addJobUpdate({ job_id: '1', event_date: '2026-01-01', note: 'Second' });
	assert.equal(first.id, 3);
	assert.equal(next.id, 4);
	const state = () =>
		withDatabase((db) => ({
			metadata: db.prepare('SELECT * FROM app_metadata').get(),
			counters: db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()
		}));
	const before = state();
	assert.equal(before.metadata.format, 'saturday.database.workflow');
	assert.match(before.metadata.dataset_id, /^[a-f0-9-]{36}$/);
	migrateDatabase();
	assert.deepEqual(state(), before);
	assert.equal(getJob('1').id, 1);
	assert.equal(
		withDatabase((db) => db.prepare('PRAGMA table_info(job_updates)').all()).some(
			(column) => column.name === 'recorded_order'
		),
		false
	);
});
test('IDs reject permissive coercion and unrecognized schemas before writes', () => {
	createJob(details);
	for (const id of [
		0,
		-1,
		1.5,
		NaN,
		Infinity,
		Number.MAX_SAFE_INTEGER + 1,
		'',
		'01',
		' 1',
		'1 ',
		'+1',
		'1e0',
		'1.0',
		'1x',
		'9007199254740992',
		'uuid',
		true,
		null,
		1n
	]) {
		assert.throws(
			() => getJob(id),
			(error) => error.name === 'ValidationError'
		);
		assert.throws(
			() => editJob(id, { notes: 'Invalid' }),
			(error) => error.name === 'ValidationError'
		);
		assert.throws(
			() => addJobUpdate({ job_id: id, event_date: '2026-01-01', note: 'Invalid' }),
			(error) => error.name === 'ValidationError'
		);
		assert.throws(
			() => correctJobUpdate(id, { remove: true }),
			(error) => error.name === 'ValidationError'
		);
	}
	assert.equal(getJob(1).notes, null);
	const path = join(scratch, 'unrecognized.sqlite');
	const db = new DatabaseSync(path);
	db.exec('CREATE TABLE unrelated (id TEXT)');
	db.close();
	const bytes = readFileSync(path);
	process.env.SATURDAY_DB_PATH = path;
	assert.throws(() => openDatabase(), /Unsupported database schema/);
	assert.deepEqual(readFileSync(path), bytes);
});
test('manual edits preserve assessment, omitted fields and history, and can clear optional values', () => {
	const job = createJob({ ...details, score: 100, score_comment: 'Forged' });
	assert.equal(job.score, null);
	setJobScore(job.id, { score: 8.5, score_comment: 'Strong fit' });
	editJob(job.id, { job_title: 'Senior Engineer', score: 0, score_comment: 'Forged again' });
	const saved = getJob(job.id);
	assert.equal(saved.location, details.location);
	assert.equal(saved.followUpComment, details.follow_up_comment);
	assert.equal(saved.score, 8.5);
	assert.equal(saved.scoreComment, 'Strong fit');
	assert.equal(saved.isStarred, true);
	assert.equal(saved.status.label, 'New');
	assert.equal(saved.updates.length, 1);
	editJob(job.id, { location: '', employment_type: null, follow_up_date: null });
	const cleared = getJob(job.id);
	assert.equal(cleared.location, null);
	assert.equal(cleared.employmentType, null);
	assert.equal(cleared.followUpDate, null);
	assert.equal(cleared.followUpComment, null);
	assert.equal(cleared.score, 8.5);
	setJobStarred(job.id, false);
	assert.equal(getJob(job.id).isStarred, false);
	setJobScore(job.id, { score: null });
	assert.equal(getJob(job.id).scoreComment, null);
});
test('dates, enums, booleans and assessment are validated before writing', () => {
	const job = createJob(details);
	for (const input of [
		{ follow_up_date: '2026-02-30' },
		{ application_deadline: 'tomorrow' },
		{ work_arrangement: 'anywhere' },
		{ employment_type: 'freelance' },
		{ is_starred: 'yes' },
		{ follow_up_comment: 'x'.repeat(10001) }
	]) {
		assert.throws(
			() => editJob(job.id, input),
			(error) => error.name === 'ValidationError'
		);
	}
	assert.throws(() =>
		createJob({ job_title: 'Other', company_name: 'Other', follow_up_comment: 'Needs date' })
	);
	for (const score of [NaN, Infinity, '9']) assert.throws(() => setJobScore(job.id, { score }));
	assert.equal(getJob(job.id).followUpDate, details.follow_up_date);
	assert.equal(getJob(job.id).score, null);
});
test('follow-ups sort earliest, retain inactive data, reschedule or clear without history', () => {
	const early = createJob(details);
	const later = createJob({ ...details, follow_up_date: '2026-12-01' });
	const stats = getDashboardStats({ today: '2026-10-05' });
	assert.deepEqual(
		stats.followUps.map((item) => item.jobId),
		[early.id, later.id]
	);
	assert.equal(stats.deadlines.length, 2);
	setJobFollowUp(early.id, '2026-10-05', 'Today');
	assert.equal(getJob(early.id).updates.length, 1);
	closeJob(early.id, '2026-10-05');
	assert.equal(getJob(early.id).followUpDate, '2026-10-05');
	assert.deepEqual(
		getDashboardStats().followUps.map((item) => item.jobId),
		[later.id]
	);
	reopenJob(early.id, '2026-10-05');
	assert.equal(getDashboardStats().followUps.length, 2);
	setJobFollowUp(early.id, null);
	assert.equal(getJob(early.id).followUpComment, null);
	assert.equal(getDashboardStats().followUps.length, 1);
	assert.equal(getDashboardStats({ today: '2026-12-01' }).deadlines.length, 0);
});
test('new backup roundtrip includes all details and assessment; detail changes invalidate preview', () => {
	const job = createJob(details, 'mcp');
	setJobScore(job.id, { score: 0, score_comment: 'Needs experience' });
	const before = getJob(job.id);
	const backup = createBackup();
	assert.equal(backup.schema_version, schemaVersion);
	const stale = prepareRestore(backup.backup_id);
	setJobScore(job.id, { score: 8.25, score_comment: 'Updated fit' });
	assert.throws(
		() => restoreBackup(stale.restore_id, true),
		(error) => error.code === 'restore_stale'
	);
	const preview = prepareRestore(backup.backup_id);
	restoreBackup(preview.restore_id, true);
	assert.deepEqual(getJob(job.id), before);
});
test('UUID backups are rejected without modifying their source or live records', () => {
	const legacy = join(scratch, 'legacy.sqlite');
	const db = new DatabaseSync(legacy);
	db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
 INSERT INTO schema_migrations VALUES (1, 'create_jobs_and_job_updates', '2026-10-01');
 CREATE TABLE jobs (id TEXT PRIMARY KEY); INSERT INTO jobs VALUES ('legacy');`);
	db.close();
	const bytes = readFileSync(legacy);
	const job = createJob(details);
	assert.throws(
		() => importBackup(legacy),
		(error) => error.code === 'unsupported_schema'
	);
	assert.deepEqual(readFileSync(legacy), bytes);
	assert.equal(getJob(job.id).id, job.id);
});

test('complete field registry matches actual SQLite columns at each supported schema version', () => {
	for (let version = 1; version <= schemaVersion; version++) {
		const db = new DatabaseSync(':memory:');
		try {
			applyMigrations(db, version);
			const actual = db
				.prepare('PRAGMA table_info(jobs)')
				.all()
				.map((column) => column.name);
			assert.deepEqual(jobColumns(version), actual);
		} finally {
			db.close();
		}
	}
});
test('original and added fields share validation, mappings, and access rules', () => {
	const job = createJob({
		...details,
		posting_url: 'https://example.com/job',
		job_description: 'Original description',
		notes: 'My notes',
		id: 'forged',
		is_active: false,
		created_via: 'mcp'
	});
	assert.notEqual(job.id, 'forged');
	assert.equal(job.isActive, true);
	assert.equal(job.createdVia, 'manual');
	const mcp = jobForMcp(job);
	assert.equal(mcp.title, 'Engineer');
	assert.equal(mcp.posting_url, 'https://example.com/job');
	assert.equal(mcp.job_description, 'Original description');
	assert.equal(mcp.location, 'San Francisco');
	assert.equal(mcp.created_at, job.createdAt);
	assert.equal(jobForMcp(job, { list: true }).job_description, undefined);
	for (const input of [
		{ job_title: '' },
		{ company_name: 'x'.repeat(201) },
		{ posting_url: 'javascript:alert(1)' },
		{ job_description: 'x'.repeat(50001) }
	])
		assert.throws(() => editJob(job.id, input));
	const wire = z.object(jobMcpInputShape({ partial: true }));
	assert.deepEqual(wire.parse({ source: 'Referral' }), { source: 'Referral' });
	assert.equal(wire.parse({ work_arrangement: null }).work_arrangement, null);
	assert.equal(wire.parse({ work_arrangement: '' }).work_arrangement, '');
	assert.equal(wire.parse({ score: 10, is_active: false }).score, undefined);
	assert.equal(wire.parse({ score: 10, is_active: false }).is_active, undefined);
	assert.equal(followUpMcpSchema.safeParse({}).success, false);
	assert.equal(followUpMcpSchema.safeParse({ follow_up_date: null }).success, true);
	assert.equal(new Set(jobFields.map((field) => field.key)).size, jobFields.length);
	closeJob(job.id, '2026-10-05');
	const entry = getJob(job.id).updates.find((row) => row.stageId === stageId('Dismissed'));
	assert.equal(entry.stageId, stageId('Dismissed'));
	assert.equal('score' in entry, false);
	assert.equal('location' in entry, false);
});
