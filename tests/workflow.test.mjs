import * as backups from '../src/lib/server/backups.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import {
	listWorkflowStages,
	addWorkflowStage,
	renameWorkflowStage,
	setWorkflowStageClosed,
	reorderWorkflowStage,
	archiveWorkflowStage,
	restoreWorkflowStage
} from '../src/lib/server/workflow.js';
import {
	createJob,
	getJob,
	moveJobStage,
	addJobUpdate,
	correctJobUpdate,
	searchJobs,
	getDashboardStats,
	editJob
} from '../src/lib/server/services.js';
let root;
const previous = { ...process.env };
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'saturday-workflow-'));
	process.env.SATURDAY_DB_PATH = join(root, 'db.sqlite');
	process.env.SATURDAY_FILES_PATH = join(root, 'files');
	migrateDatabase();
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	for (const key of ['SATURDAY_DB_PATH', 'SATURDAY_FILES_PATH']) {
		if (previous[key] === undefined) delete process.env[key];
		else process.env[key] = previous[key];
	}
});
const stage = (name) => listWorkflowStages().find((stage) => stage.name === name);
const job = () => createJob({ job_title: 'Engineer', company_name: 'Example', location: 'Remote' });
const date = '2020-01-01';
const move = (id, name) => moveJobStage(id, { stage_id: stage(name).id, event_date: date });
test('fresh workflow seeds once; creation records the starting milestone and forbids arbitrary placement edits', () => {
	const stages = listWorkflowStages();
	assert.equal(stages.length, 8);
	assert.equal(stages.filter((s) => s.is_closed).length, 3);
	const j = job();
	assert.equal(j.currentStageId, stage('New').id);
	assert.equal(j.updates.length, 1);
	renameWorkflowStage(stage('New').id, 'Interested');
	migrateDatabase();
	assert.equal(listWorkflowStages().length, 8);
	assert.equal(job().status.label, 'Interested');
	assert.equal(
		editJob(j.id, { current_stage_id: stage('Rejected').id }).currentStageId,
		j.currentStageId
	);
});
test('moves skip, go backward, close/reopen and last committed placement wins; same destination is a no-op', () => {
	const j = job();
	move(j.id, 'Offer');
	move(j.id, 'Screening');
	move(j.id, 'Rejected');
	assert.equal(getJob(j.id).isActive, false);
	move(j.id, 'Interview');
	const saved = getJob(j.id);
	assert.equal(saved.updates.length, 5);
	assert.equal(saved.status.label, 'Interview');
	assert.equal(saved.isActive, true);
	assert.equal(move(j.id, 'Interview').unchanged, true);
	assert.equal(getJob(j.id).updatedAt, saved.updatedAt);
	assert.equal(getJob(j.id).updates.length, 5);
	assert.throws(() =>
		moveJobStage(j.id, { stage_id: stage('Offer').id, event_date: '9999-01-01' })
	);
});
test('notes, scheduled milestones and archived history do not move placement; invalid writes roll back', () => {
	const j = job();
	addJobUpdate({ job_id: j.id, stage_id: stage('Interview').id, event_date: '2099-01-01' });
	addJobUpdate({ job_id: j.id, event_date: date, note: 'Remember this' });
	assert.equal(getJob(j.id).status.label, 'New');
	assert.equal(getDashboardStats().stages.find((s) => s.name === 'Interview').history_count, 1);
	const count = getJob(j.id).updates.length;
	assert.throws(() => addJobUpdate({ job_id: j.id, event_date: date }));
	assert.throws(() => moveJobStage(j.id, { stage_id: 999, event_date: date }));
	assert.equal(getJob(j.id).updates.length, count);
	archiveWorkflowStage(stage('Screening').id);
	assert.throws(() => move(j.id, 'Screening'));
	addJobUpdate({ job_id: j.id, stage_id: stage('Screening').id, event_date: date });
});
test('history correction is scoped and cannot remove sole current-stage evidence', () => {
	const j = job();
	const entry = j.updates[0];
	assert.throws(
		() => correctJobUpdate(entry.id, { job_id: j.id, remove: true }),
		/supports the current stage/
	);
	assert.throws(() => correctJobUpdate(entry.id, { job_id: job().id, remove: true }), /not found/);
	correctJobUpdate(entry.id, { job_id: j.id, note: 'Corrected' });
	move(j.id, 'Applied');
	correctJobUpdate(entry.id, { job_id: j.id, remove: true });
	assert.equal(getJob(j.id).status.label, 'Applied');
	const repeat = addJobUpdate({ job_id: j.id, stage_id: stage('Applied').id, event_date: date });
	correctJobUpdate(repeat.id, { job_id: j.id, remove: true });
});
test('stage configuration enforces references, availability, same-type reorder and explicit starting-stage confirmation', () => {
	const j = job();
	assert.throws(() => archiveWorkflowStage(stage('New').id), /current job/);
	assert.throws(() => setWorkflowStageClosed(stage('New').id, true), /referenced/);
	assert.throws(
		() => reorderWorkflowStage(stage('Applied').id, 'up'),
		(e) => e.code === 'starting_stage_confirmation'
	);
	assert.equal(stage('New').is_starting, true);
	reorderWorkflowStage(stage('Applied').id, 'up', { confirm_starting_stage: true });
	assert.equal(job().status.label, 'Applied');
	assert.equal(getJob(j.id).status.label, 'New');
	const before = stage('Accepted').sort_order;
	reorderWorkflowStage(stage('Accepted').id, 'up');
	assert.equal(stage('Accepted').sort_order, before);
});
test('case-insensitive names, archive collisions and restore append preserve IDs and history', () => {
	const id = stage('Screening').id;
	archiveWorkflowStage(id);
	addWorkflowStage({ name: ' screening ' });
	assert.throws(
		() => restoreWorkflowStage(id),
		(e) => !!e.fieldErrors?.name
	);
	renameWorkflowStage(id, 'Old screening');
	restoreWorkflowStage(id);
	assert.equal(stage('Old screening').id, id);
	assert.equal(stage('New').is_starting, true);
	assert.throws(
		() => addWorkflowStage({ name: 'NEW' }),
		(e) => !!e.fieldErrors?.name
	);
	assert.throws(() => addWorkflowStage({ name: ' ' }));
});
test('cannot archive or close the final available open stage; failed changes leave state intact', () => {
	for (const s of listWorkflowStages().filter((s) => !s.is_closed && s.name !== 'New'))
		archiveWorkflowStage(s.id);
	assert.throws(
		() => archiveWorkflowStage(stage('New').id, { confirm_starting_stage: true }),
		/at least one/
	);
	assert.throws(
		() => setWorkflowStageClosed(stage('New').id, true, { confirm_starting_stage: true }),
		/at least one/
	);
	assert.equal(stage('New').is_closed, false);
});
test('stage and milestone filters are distinct, include closed jobs, count repeats once, and validate IDs', () => {
	const j = job();
	move(j.id, 'Interview');
	addJobUpdate({ job_id: j.id, stage_id: stage('Interview').id, event_date: date });
	move(j.id, 'Rejected');
	assert.equal(searchJobs().total, 0);
	assert.equal(searchJobs({ current_stage: [stage('Rejected').id] }).total, 1);
	assert.equal(searchJobs({ current_stage: [stage('Interview').id] }).total, 0);
	assert.equal(searchJobs({ milestone_stage: [stage('Interview').id] }).total, 1);
	assert.equal(getDashboardStats().stages.find((s) => s.name === 'Interview').history_count, 1);
	assert.throws(() => searchJobs({ current_stage: [999] }));
	assert.equal(searchJobs({ view: 'all', query: 'remote' }).total, 1);
});
test('independent clients serialize moves without losing either milestone', async () => {
	const j = job();
	const ids = [stage('Offer').id, stage('Rejected').id];
	const moduleUrl = new URL('../src/lib/server/services.js', import.meta.url).href;
	await Promise.all(
		ids.map(
			(stage_id) =>
				new Promise((resolve, reject) => {
					const child = spawn(
						process.execPath,
						[
							'--input-type=module',
							'-e',
							`import {moveJobStage} from ${JSON.stringify(moduleUrl)}; moveJobStage(${j.id}, {stage_id:${stage_id},event_date:'2020-01-01'});`
						],
						{ env: process.env, stdio: ['ignore', 'ignore', 'pipe'] }
					);
					let error = '';
					child.stderr.on('data', (chunk) => (error += chunk));
					child.on('error', reject);
					child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(error))));
				})
		)
	);
	const saved = getJob(j.id);
	assert(ids.includes(saved.currentStageId));
	assert.equal(saved.updates.length, 3);
	for (const id of ids) assert(saved.updates.some((entry) => entry.stageId === id));
});
test('old numeric-baseline databases reject unchanged', () => {
	const file = join(root, 'old.sqlite');
	const db = new DatabaseSync(file);
	db.exec(
		"CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT,applied_at TEXT);INSERT INTO schema_migrations VALUES(1,'create_numeric_id_baseline','2020');CREATE TABLE jobs(id INTEGER PRIMARY KEY);INSERT INTO jobs VALUES(7)"
	);
	db.close();
	const bytes = readFileSync(file);
	process.env.SATURDAY_DB_PATH = file;
	assert.throws(() => migrateDatabase(), /Unsupported/);
	assert.deepEqual(readFileSync(file), bytes);
});

test('restore replaces seeded stages, preserves archived history and IDs, and never reseeds retired defaults', () => {
	const j = job();
	move(j.id, 'Interview');
	archiveWorkflowStage(stage('New').id, { confirm_starting_stage: true });
	renameWorkflowStage(stage('Interview').id, 'Technical interview');
	addWorkflowStage({ name: 'Extra' });
	const before = listWorkflowStages();
	const saved = getJob(j.id);
	const backup = backups.createBackup();
	addWorkflowStage({ name: 'Later' });
	renameWorkflowStage(stage('Technical interview').id, 'Changed');
	const preview = backups.prepareRestore(backup.backup_id);
	backups.restoreBackup(preview.restore_id, true);
	assert.deepEqual(listWorkflowStages(), before);
	assert.deepEqual(getJob(j.id), saved);
	migrateDatabase();
	assert.equal(stage('New').is_archived, true);
	assert.equal(listWorkflowStages().length, 9);
	const max = Math.max(...before.map((s) => s.id));
	addWorkflowStage({ name: 'After restore' });
	assert(stage('After restore').id > max + 1);
});
test('workflow configuration changes invalidate an existing restore preview', () => {
	job();
	const backup = backups.createBackup();
	const preview = backups.prepareRestore(backup.backup_id);
	renameWorkflowStage(stage('Screening').id, 'Phone screen');
	assert.throws(
		() => backups.restoreBackup(preview.restore_id, true),
		(e) => e.code === 'restore_stale'
	);
	assert(stage('Phone screen'));
});
