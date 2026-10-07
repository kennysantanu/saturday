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
import { migrateDatabase } from '../src/lib/server/database.js';
import {
	createJob,
	editJob,
	getJob,
	setJobScore,
	setJobFollowUp,
	setJobStarred,
	getDashboardStats,
	dismissJob,
	reopenJob
} from '../src/lib/server/services.js';
import {
	createBackup,
	importBackup,
	getBackupFile,
	prepareRestore,
	restoreBackup
} from '../src/lib/server/backups.js';
const previous = process.env.SATURDAY_DB_PATH;
let scratch;
beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'saturday-job-details-'));
	process.env.SATURDAY_DB_PATH = join(scratch, 'career.sqlite');
	migrateDatabase();
});
afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	if (previous === undefined) delete process.env.SATURDAY_DB_PATH;
	else process.env.SATURDAY_DB_PATH = previous;
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
test('existing schema upgrades without changing old records or history', () => {
	const legacy = join(scratch, 'legacy.sqlite');
	const db = new DatabaseSync(legacy);
	applyMigrations(db, 1);
	db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,1,?,?,?)').run(
		'old-id',
		'Engineer',
		'Example',
		null,
		null,
		'Keep this',
		'manual',
		'2026-10-01T00:00:00Z',
		'2026-10-01T00:00:00Z'
	);
	db.prepare(
		'INSERT INTO job_updates (id, job_id, event_type, event_date, note, created_via, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
	).run(
		'old-update',
		'old-id',
		'applied',
		'2026-10-01',
		null,
		'mcp',
		'2026-10-01T00:00:00Z',
		'2026-10-01T00:00:00Z'
	);
	db.close();
	process.env.SATURDAY_DB_PATH = legacy;
	migrateDatabase();
	const job = getJob('old-id');
	assert.equal(job.notes, 'Keep this');
	assert.equal(job.isStarred, false);
	assert.equal(job.followUpDate, null);
	assert.equal(job.score, null);
	assert.equal(job.updates[0].id, 'old-update');
	assert.equal(job.status.label, 'Applied');
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
	assert.deepEqual(saved.updates, []);
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
	assert.equal(getJob(early.id).updates.length, 0);
	dismissJob(early.id, '2026-10-05');
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
test('version-one backups restore with empty new fields without modifying the original backup', () => {
	const legacy = join(scratch, 'legacy.sqlite');
	const db = new DatabaseSync(legacy);
	applyMigrations(db, 1);
	db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,1,?,?,?)').run(
		'old-id',
		'Engineer',
		'Example',
		null,
		null,
		'Legacy',
		'mcp',
		'2026-10-01T00:00:00Z',
		'2026-10-01T00:00:00Z'
	);
	db.prepare(
		'INSERT INTO job_updates (id, job_id, event_type, event_date, note, created_via, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
	).run(
		'legacy-note',
		'old-id',
		null,
		'2026-10-01',
		'Preserve history',
		'mcp',
		'2026-10-01T00:00:00Z',
		'2026-10-01T00:00:00Z'
	);
	db.close();
	const original = readFileSync(legacy);
	const backup = importBackup(legacy);
	assert.equal(backup.schema_version, 1);
	const stored = getBackupFile(backup.backup_id).path;
	const managedBytes = readFileSync(stored);
	createJob(details);
	const preview = prepareRestore(backup.backup_id);
	assert.equal(preview.incoming.schema_version, schemaVersion);
	restoreBackup(preview.restore_id, true);
	const job = getJob('old-id');
	assert.equal(job.notes, 'Legacy');
	assert.equal(job.updates[0].id, 'legacy-note');
	assert.equal(job.updates[0].recordedOrder, 1);
	assert.equal(job.updates[0].note, 'Preserve history');
	assert.equal(job.score, null);
	assert.equal(job.isStarred, false);
	assert.equal(job.followUpDate, null);
	assert.deepEqual(readFileSync(legacy), original);
	assert.deepEqual(readFileSync(stored), managedBytes);
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
	dismissJob(job.id, '2026-10-05');
	const entry = getJob(job.id).updates[0];
	assert.equal(entry.eventType, 'dismissed');
	assert.equal('score' in entry, false);
	assert.equal('location' in entry, false);
});
