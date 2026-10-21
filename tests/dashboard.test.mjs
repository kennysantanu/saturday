import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import {
	createJob,
	moveJobStage,
	addJobUpdate,
	getDashboardStats,
	searchJobs
} from '../src/lib/server/services.js';
import {
	listWorkflowStages,
	renameWorkflowStage,
	archiveWorkflowStage,
	reorderWorkflowStage
} from '../src/lib/server/workflow.js';
import { pipelineHref, pipelinePage } from '../src/lib/job-pipeline.js';
import { jobReturn } from '../src/lib/job-navigation.js';

let root;
const saved = { ...process.env };
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'saturday-dashboard-'));
	process.env.SATURDAY_DB_PATH = join(root, 'db.sqlite');
	process.env.SATURDAY_FILES_PATH = join(root, 'files');
	process.env.SATURDAY_INSTALLATION_PATH = '';
	migrateDatabase();
});
afterEach(() => {
	mock.restoreAll();
	rmSync(root, { recursive: true, force: true });
	for (const key of ['SATURDAY_DB_PATH', 'SATURDAY_FILES_PATH', 'SATURDAY_INSTALLATION_PATH']) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
});
const stages = () => listWorkflowStages();
const stage = (name) => stages().find((s) => s.name === name);
const job = (title = 'Engineer') => createJob({ job_title: title, company_name: 'Example' });
const move = (id, name) => moveJobStage(id, { stage_id: stage(name).id, event_date: '2020-01-01' });

test('pipeline independently pages more than 100 jobs, retains full counts and uses deterministic recent order', () => {
	const newId = stage('New').id,
		acceptedId = stage('Accepted').id;
	for (let i = 0; i < 105; i++) job(`Role ${i}`);
	for (let i = 0; i < 23; i++) move(job(`Closed ${i}`).id, 'Accepted');
	// Equal timestamps exercise the stable ID tie-breaker.
	withDatabase((db) => db.prepare('UPDATE jobs SET updated_at=?').run('2020-01-01T00:00:00.000Z'));
	const data = getDashboardStats({ pipelinePages: { [newId]: '3', [acceptedId]: '2' } });
	const open = data.pipeline.find((s) => s.id === newId),
		closed = data.pipeline.find((s) => s.id === acceptedId);
	assert.deepEqual([open.total, open.page, open.totalPages, open.jobs.length], [105, 3, 6, 20]);
	assert.deepEqual(
		open.jobs.map((j) => j.id),
		Array.from({ length: 20 }, (_, i) => 65 - i)
	);
	assert.deepEqual([closed.total, closed.page, closed.jobs.length], [23, 2, 3]);
	assert.equal(data.stats.active, 105);
	assert.equal(data.totalJobs, 128);
	assert.equal(
		data.pipeline.reduce((sum, col) => sum + col.total, 0),
		128
	);
	assert(!('updates' in open.jobs[0]));
	assert(!('jobDescription' in open.jobs[0]));
	for (const column of data.pipeline) {
		assert.equal(searchJobs({ current_stage: [column.id], view: 'all' }).total, column.total);
		assert(column.jobs.length <= 20);
	}
	const href = pipelineHref(data.pipeline, acceptedId, 1);
	assert.equal(href, `/?pipeline_page_${newId}=3#pipeline-stage-${acceptedId}`);
	assert.equal(jobReturn(href), href);
	const windowHref = pipelineHref(data.pipeline, acceptedId, 1, acceptedId);
	assert.equal(
		new URL(windowHref, 'http://localhost').searchParams.get('pipeline_stage'),
		String(acceptedId)
	);
	assert.equal(jobReturn(windowHref), windowHref);
});

test('empty, closed-only, renamed, reordered and archived stages have accurate current/history counts', () => {
	const empty = getDashboardStats();
	assert.equal(empty.totalJobs, 0);
	assert.equal(empty.pipeline.length, 8);
	assert(empty.pipeline.every((s) => s.total === 0 && s.page === 1 && !s.jobs.length));
	const j = job();
	move(j.id, 'Accepted');
	const interview = stage('Interview').id,
		offer = stage('Offer').id;
	addJobUpdate({ job_id: j.id, stage_id: interview, event_date: '2099-01-01' });
	addJobUpdate({ job_id: j.id, stage_id: interview, event_date: '2020-01-01' });
	archiveWorkflowStage(interview);
	renameWorkflowStage(stage('Accepted').id, 'Hired');
	reorderWorkflowStage(offer, 'up');
	const data = getDashboardStats({ pipelinePages: { [interview]: '2', [offer]: '9999' } });
	assert.equal(data.stats.active, 0);
	assert.equal(data.pipeline.find((s) => s.name === 'Hired').total, 1);
	assert.equal(data.stages.find((s) => s.id === interview).history_count, 1);
	assert(!data.pipeline.some((s) => s.id === interview));
	assert(
		data.pipeline.findIndex((s) => s.id === offer) <
			data.pipeline.findIndex((s) => s.name === 'Screening')
	);
	assert.deepEqual(data.followUps, []);
	assert.deepEqual(data.upcoming, []);
	assert(!pipelineHref(data.pipeline, offer, 1).includes(`pipeline_page_${interview}`));
	assert(data.pipeline.every((s, i, all) => !i || !all[i - 1].is_closed || s.is_closed));
});

test('invalid pages reset and stale pages clamp after jobs move away', () => {
	for (const value of ['-1', '0', '1.5', '1e3', 'Infinity', '999999999999999999', 'bad', null])
		assert.equal(pipelinePage(value), 1);
	const newId = stage('New').id;
	const jobs = Array.from({ length: 21 }, () => job());
	assert.equal(getDashboardStats({ pipelinePages: { [newId]: '999' } }).pipeline[0].page, 2);
	move(jobs[0].id, 'Applied');
	const column = getDashboardStats({ pipelinePages: { [newId]: '2' } }).pipeline[0];
	assert.equal(column.page, 1);
	assert.equal(column.total, 20);
	assert.equal(column.jobs.length, 20);
});

test('board counts and pages stay on one snapshot while another client moves a job', () => {
	const j = job(),
		applied = stage('Applied').id;
	withDatabase((db) => db.exec('PRAGMA journal_mode=WAL'));
	const prepare = DatabaseSync.prototype.prepare;
	let moved = false;
	mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
		if (!moved && sql.includes('WHERE j.current_stage_id=? ORDER BY')) {
			moved = true;
			moveJobStage(j.id, { stage_id: applied, event_date: '2020-01-01' });
		}
		return prepare.call(this, sql);
	});
	const data = getDashboardStats();
	assert(moved);
	assert.equal(data.pipeline[0].total, 1);
	assert.equal(data.pipeline[0].jobs[0].id, j.id);
	assert.equal(data.pipeline.find((s) => s.id === applied).total, 0);
	assert.equal(getDashboardStats().pipeline.find((s) => s.id === applied).total, 1);
});

test('a board read failure is exposed separately while sibling sections stay available', () => {
	job();
	const prepare = DatabaseSync.prototype.prepare;
	mock.method(console, 'error', () => {});
	mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
		if (sql.includes('WHERE j.current_stage_id=? ORDER BY'))
			throw new Error('Simulated read failure');
		return prepare.call(this, sql);
	});
	const data = getDashboardStats();
	assert(data.errors.pipeline);
	assert.equal(data.stats.active, 1);
	assert.equal(data.stages[0].history_count, 1);
	assert.equal(data.errors.history, undefined);
});
