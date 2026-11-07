import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { webApplication, assistantApplication } from '../src/lib/server/application.js';
import { createJob, editJob, getJob, moveJobStage } from '../src/lib/server/local/jobs.js';
import { listWorkflowStages } from '../src/lib/server/local/workflow.js';
import { createTag } from '../src/lib/server/local/tags.js';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import {
	possibleDuplicateJobs,
	PossibleDuplicateJobError
} from '../src/lib/domain/job-duplicates.js';

let root;
const saved = { ...process.env };
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'saturday-job-duplicates-'));
	for (const key of Object.keys(process.env))
		if (key.startsWith('SATURDAY_')) delete process.env[key];
	Object.assign(process.env, {
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'extension-code')
	});
	migrateDatabase();
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
	Object.assign(process.env, saved);
});
const details = { job_title: 'Product Engineer', company_name: 'Example', location: 'New York' };
const counts = () =>
	withDatabase((db) => ({
		jobs: db.prepare('SELECT * FROM jobs ORDER BY id').all(),
		history: db.prepare('SELECT * FROM job_updates ORDER BY id').all(),
		tags: db.prepare('SELECT * FROM job_tag_assignments').all(),
		sequences: db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()
	}));

test('duplicate creation returns closed matches without writes; a boolean override creates an independent job', async () => {
	const first = await webApplication.createJob(details);
	moveJobStage(first.id, {
		stage_id: listWorkflowStages().find((stage) => stage.name === 'Rejected').id,
		event_date: '2020-01-01'
	});
	const tag = createTag({ collection: 'job', name: 'test', color: '#123456' });
	const before = counts();
	const input = {
		...details,
		job_title: '  PRODUCT   Engineer ',
		company_name: ' example ',
		location: ' new   YORK ',
		notes: 'Keep this draft',
		tag_ids: [tag.id]
	};
	await assert.rejects(assistantApplication.createJob(input), (error) => {
		assert(error instanceof PossibleDuplicateJobError);
		assert.equal(error.code, 'possible_duplicate');
		assert.equal(error.total, 1);
		assert.deepEqual(error.matches, [
			{
				id: first.id,
				title: details.job_title,
				company: details.company_name,
				location: details.location,
				stage: 'Rejected',
				reason: 'matching_title_company'
			}
		]);
		return true;
	});
	assert.deepEqual(counts(), before);
	for (const allow_duplicate of ['true', 'false', 1, null]) {
		assert.throws(
			() => createJob({ ...input, allow_duplicate }),
			(e) => Boolean(e.fieldErrors.allow_duplicate)
		);
	}
	assert.deepEqual(counts(), before);
	const second = await assistantApplication.createJob({ ...input, allow_duplicate: true });
	assert.notEqual(first.id, second.id);
	assert.equal(second.createdVia, 'assistant');
	assert.equal(second.updates.length, 1);
	assert.equal(second.notes, input.notes);
	assert.equal(second.tags[0].id, tag.id);
	assert.equal(second.allow_duplicate, undefined);
	assert.equal(getJob(first.id).status.label, 'Rejected');
	// This safeguard applies to creation; ordinary detail edits remain unchanged.
	assert.equal(editJob(second.id, { ...details }).title, details.job_title);
});

test('posting links normalize hosts/fragments while preserving posting IDs, path case and locations', () => {
	const row = {
		...details,
		id: 1,
		stage: 'New',
		posting_url: 'https://EXAMPLE.com/Jobs?id=1#about'
	};
	const different = { job_title: 'Other', company_name: 'Elsewhere', location: 'Paris' };
	assert.equal(
		possibleDuplicateJobs({ ...different, posting_url: 'https://example.com/Jobs?id=1#apply' }, [
			row
		]).total,
		1
	);
	for (const posting_url of [
		'https://example.com/Jobs?id=2',
		'https://example.com/jobs?id=1',
		'',
		null
	])
		assert.equal(possibleDuplicateJobs({ ...different, posting_url }, [row]).total, 0);
	assert.equal(possibleDuplicateJobs({ ...details, location: 'Paris' }, [row]).total, 0);
	assert.equal(possibleDuplicateJobs({ ...details, location: '' }, [row]).total, 1);
	assert.equal(possibleDuplicateJobs(details, [{ ...row, location: null }]).total, 1);
	assert.equal(
		possibleDuplicateJobs({ job_title: 'développeur', company_name: 'équipe' }, [
			{ id: 2, job_title: ' DÉVELOPPEUR ', company_name: ' ÉQUIPE ', location: null }
		]).total,
		1
	);
});

test('matches are bounded, counted and prioritize identical posting links', () => {
	for (let i = 0; i < 12; i++) createJob({ ...details, allow_duplicate: true });
	const exact = createJob({
		job_title: 'Other opening',
		company_name: 'Other',
		posting_url: 'https://example.com/123'
	});
	assert.throws(
		() => createJob({ ...details, posting_url: 'https://example.com/123' }),
		(error) => {
			assert.equal(error.total, 13);
			assert.equal(error.matches.length, 10);
			assert.equal(error.matches[0].id, exact.id);
			assert.equal(error.matches[0].reason, 'matching_posting_url');
			return true;
		}
	);
});

test('concurrent ordinary creations serialize the check and insert', async () => {
	const run = () =>
		new Promise((resolve, reject) => {
			const child = spawn(
				process.execPath,
				[
					'--input-type=module',
					'-e',
					`
			import {createJob} from './src/lib/server/local/jobs.js';
			try { console.log(JSON.stringify({id:createJob(${JSON.stringify(details)}).id})); }
			catch(e) { console.log(JSON.stringify({code:e.code})); }
		`
				],
				{ env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
			);
			let out = '',
				err = '';
			child.stdout.on('data', (chunk) => (out += chunk));
			child.stderr.on('data', (chunk) => (err += chunk));
			child.on('error', reject);
			child.on('close', (code) => (code ? reject(new Error(err)) : resolve(JSON.parse(out))));
		});
	const results = await Promise.all([run(), run()]);
	assert.equal(results.filter((result) => result.id).length, 1);
	assert.equal(results.filter((result) => result.code === 'possible_duplicate').length, 1);
	assert.equal(counts().jobs.length, 1);
	assert.equal(counts().history.length, 1);
});

test('built MCP exposes the override and returns structured matches without creating records', async (t) => {
	const child = spawn(process.execPath, ['build/mcp/index.js'], {
		env: process.env,
		stdio: ['pipe', 'pipe', 'pipe']
	});
	let next = 1,
		stderr = '';
	const pending = new Map();
	const lines = createInterface({ input: child.stdout });
	child.stderr.on('data', (chunk) => (stderr += chunk));
	const exited = new Promise((resolve) => child.once('exit', resolve));
	t.after(async () => {
		child.stdin.end();
		child.kill();
		await exited;
		lines.close();
	});
	lines.on('line', (line) => {
		const message = JSON.parse(line),
			entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		clearTimeout(entry.timer);
		message.error
			? entry.reject(new Error(JSON.stringify(message.error)))
			: entry.resolve(message.result);
	});
	const request = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = next++;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`MCP timed out: ${stderr}`));
			}, 10000);
			pending.set(id, { resolve, reject, timer });
			child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
		});
	await request('initialize', {
		protocolVersion: '2024-11-05',
		capabilities: {},
		clientInfo: { name: 'duplicate-test', version: '1' }
	});
	const catalog = await request('tools/list');
	assert(
		catalog.tools.find((tool) => tool.name === 'create_job').inputSchema.properties.allow_duplicate
	);
	const call = (input) => request('tools/call', { name: 'create_job', arguments: input });
	const original = JSON.parse((await call(details)).content[0].text);
	const before = counts();
	const denied = await call({ ...details, allow_duplicate: false });
	assert.equal(denied.isError, true);
	const error = JSON.parse(denied.content[0].text);
	assert.equal(error.code, 'possible_duplicate');
	assert.equal(error.matches[0].id, original.id);
	assert.equal(error.total, 1);
	assert.deepEqual(counts(), before);
	const explicit = JSON.parse((await call({ ...details, allow_duplicate: true })).content[0].text);
	assert.notEqual(explicit.id, original.id);
	assert.equal(counts().jobs.length, 2);
});
