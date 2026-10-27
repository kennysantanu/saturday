import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {
	webApplication as web,
	assistantApplication as assistant
} from '../src/lib/server/application.js';
import { createAssistantCatalog, createApplication } from '../src/lib/application/index.js';
import { localOperations } from '../src/lib/server/local-operations.js';
import { localCapabilities } from '../src/lib/server/platform.js';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import { verifyJobCrud } from './contracts/job-crud.mjs';

const keys = [
	'SATURDAY_INSTALLATION_PATH',
	'SATURDAY_DB_PATH',
	'SATURDAY_FILES_PATH',
	'SATURDAY_EXTENSION_STATE_PATH',
	'SATURDAY_EXTENSIONS_PATH'
];
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
let scratch, commands;
beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'saturday-local-contract-'));
	Object.assign(process.env, {
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(scratch, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(scratch, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(scratch, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(scratch, 'code')
	});
	migrateDatabase();
	commands = new Map(
		createAssistantCatalog(assistant, localCapabilities).map((command) => [command.name, command])
	);
});
afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});
const call = (name, input) => commands.get(name).execute(input);
const makeJob = () => web.createJob({ job_title: 'Engineer', company_name: 'Example' });

test('local adapter satisfies the same creation/read/partial-update contract as the Cloudflare fixture', async () => {
	await verifyJobCrud(web);
});

test('browser operations and assistant commands share partial edits, nullable fields and immutable placement', async () => {
	const job = await makeJob();
	await web.editJob(job.id, { notes: 'Keep', location: 'Paris' });
	await call('edit_job', { job_id: job.id, job_title: 'Lead Engineer' });
	let current = await web.getJob(job.id);
	assert.equal(current.notes, 'Keep');
	assert.equal(current.location, 'Paris');
	await call('edit_job', { job_id: job.id, location: null });
	await web.editJob(job.id, { current_stage_id: 999, score: 999, created_via: 'assistant' });
	current = await web.getJob(job.id);
	assert.equal(current.currentStageId, job.currentStageId);
	assert.equal(current.createdVia, 'manual');
	assert.equal(current.location, null);
	assert.equal(current.score, null);
	const discovered = await call('get_job', { job_id: job.id });
	assert.equal(discovered.title, current.title);
	assert.equal(discovered.notes, current.notes);
	assert.equal(discovered.current_stage_id, current.currentStageId);
	await assert.rejects(call('edit_job', { job_id: job.id, company_name: '' }), (error) =>
		Boolean(error.fieldErrors.company_name)
	);
	assert.deepEqual(await web.getJob(job.id), current);
});

test('actual SQLite writes roll back placement, history and tags when later related writes fail', async () => {
	const job = await makeJob();
	const before = await web.getJob(job.id);
	const applied = (await web.listWorkflowStages()).find((stage) => stage.name === 'Applied');
	// The direct browser operation reaches reminder validation after its placement/history writes.
	await assert.rejects(
		web.moveJobStage(job.id, {
			stage_id: applied.id,
			event_date: '2020-01-01',
			reminder: { scheduled_at: 'invalid' }
		})
	);
	assert.deepEqual(await web.getJob(job.id), before);
	await assert.rejects(
		web.editJob(job.id, { notes: 'Must roll back', tag_ids: [Number.MAX_SAFE_INTEGER] }),
		{ code: 'not_found' }
	);
	assert.deepEqual(await web.getJob(job.id), before);
	const counts = withDatabase((db) => ({
		history: db.prepare('SELECT COUNT(*) n FROM job_updates').get().n,
		reminders: db.prepare('SELECT COUNT(*) n FROM reminders').get().n
	}));
	assert.deepEqual(counts, { history: 1, reminders: 0 });
});

test('person edits and interaction/reminder writes preserve omissions and roll back invalid companions', async () => {
	const person = await web.createNetwork({ name: 'Alex', organization: 'Example', notes: 'Keep' });
	await call('edit_network', { network_id: person.id, role: 'Recruiter' });
	let current = await web.getNetwork(person.id);
	assert.equal(current.notes, 'Keep');
	assert.equal(current.organization, 'Example');
	await web.editNetwork(person.id, { notes: null });
	current = await web.getNetwork(person.id);
	assert.equal(current.notes, null);
	await assert.rejects(
		web.addNetworkUpdate({
			network_id: person.id,
			interaction_date: '2020-01-01',
			note: 'Must roll back',
			reminder: { scheduled_at: 'invalid' }
		})
	);
	assert.equal((await web.listNetworkUpdates({ network_id: person.id })).total, 0);
	assert.equal((await web.listReminders({ network_id: person.id })).total, 0);
	assert.deepEqual(await web.getNetwork(person.id), current);
});

test('scope and dataset guards cannot be bypassed through assistant commands or browser operations', async () => {
	const job = await makeJob(),
		other = await makeJob();
	const note = await web.addJobUpdate({
		job_id: job.id,
		stage_id: null,
		event_date: '2020-01-01',
		note: 'Private history'
	});
	await assert.rejects(
		call('edit_job_update', { job_id: other.id, update_id: note.id, note: 'Wrong job' }),
		{ code: 'not_found' }
	);
	const reminder = await web.createReminder({ job_id: job.id, scheduled_at: '2099-01-01T00:00' });
	await assert.rejects(
		call('edit_reminder', { job_id: other.id, reminder_id: reminder.id, note: 'Wrong owner' }),
		{ code: 'not_found' }
	);
	const before = await web.getJob(job.id);
	await assert.rejects(
		call('delete_job', { job_id: job.id, dataset_id: randomUUID(), confirm: true }),
		{ code: 'DATASET_MISMATCH' }
	);
	await assert.rejects(
		web.deleteJob({ job_id: job.id, dataset_id: before.dataset_id, confirm: false })
	);
	assert.deepEqual(await web.getJob(job.id), before);
	const restricted = createApplication(
		localOperations,
		{ actor: 'assistant', permissions: [] },
		localCapabilities
	);
	await assert.rejects(
		restricted.correctJobUpdate(note.id, {
			job_id: job.id,
			remove: '1',
			permissions: ['records.delete']
		}),
		{ code: 'forbidden' }
	);
});

test('document scope, hashes, conflicts and job deletion preserve unrelated content and linked people', async () => {
	const job = await makeJob(),
		other = await makeJob();
	const owned = await web.createDocument({ scope: job.id, filename: 'notes.md', content: 'Owned' });
	const preserved = await web.createDocument({
		scope: other.id,
		filename: 'notes.md',
		content: 'Unrelated'
	});
	const person = await web.createNetwork({ name: 'Alex' });
	await web.linkJobNetwork({ job_id: job.id, network_id: person.id });
	await web.createReminder({ job_id: job.id, scheduled_at: '2099-01-01T00:00' });
	await assert.rejects(call('get_document', { id: owned.id, scope: other.id }), {
		code: 'NOT_FOUND'
	});
	await assert.rejects(
		web.deleteDocument({ id: owned.id, scope: other.id, token: owned.token, confirm: true }),
		{ code: 'NOT_FOUND' }
	);
	const edited = await call('edit_document', {
		id: owned.id,
		scope: job.id,
		token: owned.token,
		content: 'Revised'
	});
	assert.equal(edited.sha256, createHash('sha256').update('Revised').digest('hex'));
	await assert.rejects(
		web.editDocument({ id: owned.id, scope: job.id, token: owned.token, content: 'Stale' }),
		{ code: 'CONFLICT' }
	);
	const info = await web.getJob(job.id);
	await call('delete_job', { job_id: job.id, dataset_id: info.dataset_id, confirm: true });
	assert.equal(await web.getJob(job.id), null);
	assert.equal((await web.getNetwork(person.id)).name, 'Alex');
	assert.equal((await web.listNetworkJobs({ network_id: person.id })).total, 0);
	const surviving = await web.getDocument({
		id: preserved.id,
		scope: other.id,
		include_content: true
	});
	assert.equal(surviving.content, 'Unrelated');
	await assert.rejects(web.getDocument({ id: edited.id, scope: job.id }), { code: 'NOT_FOUND' });
});

test('matching job numbers in a different dataset cannot claim existing document content', async () => {
	const job = await makeJob();
	const document = await web.createDocument({
		scope: job.id,
		filename: 'bound.md',
		content: 'Original dataset'
	});
	const originalPath = process.env.SATURDAY_DB_PATH;
	process.env.SATURDAY_DB_PATH = join(scratch, 'another.sqlite');
	try {
		migrateDatabase();
		assert.equal((await makeJob()).id, job.id);
		await assert.rejects(web.getDocument({ id: document.id, scope: job.id }), {
			code: 'DATASET_MISMATCH'
		});
	} finally {
		process.env.SATURDAY_DB_PATH = originalPath;
	}
	assert.equal(
		(await web.getDocument({ id: document.id, scope: job.id, include_content: true })).content,
		'Original dataset'
	);
});
