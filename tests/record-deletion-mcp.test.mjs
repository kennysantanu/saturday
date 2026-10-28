import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import { createJob, getJob } from '../src/lib/server/local/jobs.js';
import { createDocument } from '../src/lib/server/files/documents.js';
import { jobDeletionPath } from '../src/lib/server/job-deletion-state.js';

let root, clients;
test.beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'saturday-delete-mcp-'));
	clients = [];
	Object.assign(process.env, {
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	migrateDatabase();
});
test.afterEach(async () => {
	for (const client of clients) await client.close();
	await rm(root, { recursive: true, force: true });
});

async function connect() {
	const child = spawn(process.execPath, ['build/mcp/index.js'], {
		env: process.env,
		stdio: ['pipe', 'pipe', 'pipe']
	});
	let next = 1,
		stderr = '';
	const pending = new Map(),
		lines = createInterface({ input: child.stdout });
	child.stderr.on('data', (c) => (stderr += c));
	child.stdin.on('error', () => {});
	lines.on('line', (line) => {
		const message = JSON.parse(line),
			entry = pending.get(message.id);
		if (!entry) return;
		clearTimeout(entry.timer);
		pending.delete(message.id);
		if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
		else entry.resolve(message.result);
	});
	child.once('exit', () => {
		for (const entry of pending.values()) {
			clearTimeout(entry.timer);
			entry.reject(new Error(`MCP exited: ${stderr}`));
		}
		pending.clear();
	});
	const request = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = next++,
				timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`MCP timeout: ${stderr}`));
				}, 10000);
			pending.set(id, { resolve, reject, timer });
			child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
		});
	const raw = (name, args = {}) => request('tools/call', { name, arguments: args });
	const call = async (name, args = {}) => {
		const result = await raw(name, args),
			text = result.content[0].text;
		assert(!text.includes(root), 'Tool responses must not disclose private fixture paths.');
		return JSON.parse(text);
	};
	const client = {
		request,
		raw,
		call,
		close: async () => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			child.kill('SIGTERM');
			await new Promise((r) => child.once('exit', r));
			lines.close();
		}
	};
	clients.push(client);
	await request('initialize', {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'record-deletion-test', version: '1' }
	});
	child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
	return client;
}
async function crashJob(job, point) {
	const child = spawn(
		process.execPath,
		[
			'tests/helpers/record-deletion-worker.mjs',
			JSON.stringify({ job_id: job.id, dataset_id: job.dataset_id, point })
		],
		{ env: process.env, stdio: 'ignore' }
	);
	assert.equal(
		await new Promise((r) => child.once('exit', (_code, signal) => r(signal))),
		'SIGKILL'
	);
}

test('MCP deletion discovers strict destructive tools, uses normal reads and deletes current scope through shared services', async () => {
	const { request, raw, call } = await connect();
	const listing = await request('tools/list');
	for (const [name, field] of [
		['delete_job', 'job_id'],
		['delete_network', 'network_id']
	]) {
		const tool = listing.tools.find((item) => item.name === name);
		assert(tool);
		assert.equal(tool.annotations.destructiveHint, true);
		assert.equal(tool.annotations.readOnlyHint, false);
		assert.equal(tool.annotations.idempotentHint, false);
		assert.equal(tool.annotations.openWorldHint, false);
		assert.equal(tool.inputSchema.properties[field].type, 'integer');
		assert.deepEqual(tool.inputSchema.required.sort(), [field, 'dataset_id', 'confirm'].sort());
		assert(!('deletion_token' in tool.inputSchema.properties));
		assert.match(tool.description, /explicit user authorization/);
		assert.match(tool.description, /No automatic retry/);
	}
	assert(!listing.tools.some((tool) => /deletion_preview/.test(tool.name)));
	const job = await call('create_job', { job_title: 'Delete', company_name: 'Example' });
	const keep = await call('create_job', { job_title: 'Keep', company_name: 'Example' });
	const read = await call('get_job', { job_id: job.id });
	assert.equal(read.dataset_id, (await call('get_saturday_info')).dataset_id);
	const person = (await call('create_network', { name: 'Remove person later' })).network;
	await call('link_job_network', {
		job_id: job.id,
		network_id: person.id,
		notes: 'remove this relationship'
	});
	await call('link_job_network', {
		job_id: keep.id,
		network_id: person.id,
		notes: 'retain until person deletion'
	});
	await call('add_network_update', {
		network_id: person.id,
		interaction_date: '2020-01-01',
		note: 'Recorded interaction'
	});
	const personRead = await call('get_network', { network_id: person.id });
	assert.equal(personRead.network.dataset_id, read.dataset_id);
	assert.equal(personRead.network.interaction_count, 1);
	assert.equal(personRead.linked_jobs.total, 2);
	const general = await call('create_document', { filename: 'keep.md', content: 'general' });
	await call('create_document', { scope: job.id, filename: 'tailored.md', content: 'job file' });
	const base = { job_id: job.id, dataset_id: read.dataset_id, confirm: true };
	for (const fields of [
		{ ...base, confirm: false },
		{ job_id: job.id, dataset_id: read.dataset_id },
		{ ...base, job_id: String(job.id) },
		{ ...base, dataset_id: 'invalid' }
	]) {
		assert.equal((await raw('delete_job', fields)).isError, true);
		assert(getJob(job.id));
	}
	const mismatch = await call('delete_job', { ...base, dataset_id: randomUUID() });
	assert.equal(mismatch.ok, false);
	assert.equal(mismatch.error.code, 'DATASET_MISMATCH');
	// Mutations after normal reads are included automatically; there is no snapshot/token handshake.
	await call('add_job_update', {
		job_id: job.id,
		event_date: '2020-01-01',
		note: 'added after read'
	});
	await call('create_document', { scope: job.id, filename: 'late.md', content: 'late job file' });
	const result = await call('delete_job', base);
	assert.deepEqual(result, { ok: true, job_id: job.id, deleted: true, documents_deleted: 2 });
	assert.equal(getJob(job.id), null);
	assert(getJob(keep.id));
	assert.equal(
		withDatabase(
			(db) => db.prepare('SELECT COUNT(*) AS n FROM job_updates WHERE job_id=?').get(job.id).n
		),
		0
	);
	assert(!existsSync(join(root, 'files', `jobs/${job.id}`)));
	assert.equal((await call('list_documents')).total, 1);
	assert.equal((await call('get_document', { id: general.id })).id, general.id);
	assert.equal((await call('delete_job', base)).error.code, 'not_found');
	assert.equal((await raw('get_job', { job_id: job.id })).isError, true);
	const retained = await call('get_network', { network_id: person.id });
	assert.equal(retained.linked_jobs.total, 1);
	assert.equal(retained.network.interaction_count, 1);
	await call('add_network_update', {
		network_id: person.id,
		interaction_date: '2020-01-02',
		note: 'new after read'
	});
	const personInput = {
		network_id: person.id,
		dataset_id: retained.network.dataset_id,
		confirm: true
	};
	assert.equal((await raw('delete_network', { ...personInput, confirm: false })).isError, true);
	assert.equal(
		(await call('delete_network', { ...personInput, dataset_id: randomUUID() })).error.code,
		'DATASET_MISMATCH'
	);
	assert.deepEqual(await call('delete_network', personInput), {
		ok: true,
		network_id: person.id,
		deleted: true
	});
	assert.equal((await call('list_networks')).total, 0);
	assert(getJob(keep.id));
	assert.equal(
		withDatabase(
			(db) =>
				db.prepare('SELECT COUNT(*) AS n FROM network_updates WHERE network_id=?').get(person.id).n
		),
		0
	);
	assert.equal(
		withDatabase(
			(db) =>
				db.prepare('SELECT COUNT(*) AS n FROM job_networks WHERE network_id=?').get(person.id).n
		),
		0
	);
	assert.equal((await call('delete_network', personInput)).error.code, 'not_found');
});

test('MCP deletion reports file integrity and dataset errors without bypassing coordination or exposing paths', async () => {
	const { call } = await connect();
	const created = await call('create_job', { job_title: 'Keep on error', company_name: 'Example' });
	const job = await call('get_job', { job_id: created.id });
	await call('create_document', { scope: job.id, filename: 'doc.md', content: 'preserve' });
	await writeFile(join(root, 'files', `jobs/${job.id}/unknown.txt`), 'unregistered');
	const fields = { job_id: job.id, dataset_id: job.dataset_id, confirm: true };
	const result = await call('delete_job', fields);
	assert.equal(result.ok, false);
	assert.equal(result.error.code, 'INTEGRITY');
	assert(getJob(job.id));
	await rm(join(root, 'files', `jobs/${job.id}/unknown.txt`));
	const path = join(root, 'files', 'manifest.json'),
		original = await readFile(path, 'utf8');
	await writeFile(path, JSON.stringify({ ...JSON.parse(original), dataset_id: randomUUID() }));
	assert.equal((await call('delete_job', fields)).error.code, 'DATASET_MISMATCH');
	assert(getJob(job.id));
	await writeFile(path, original);
	assert.equal((await call('delete_job', fields)).ok, true);
});

for (const point of ['before-commit', 'after-commit']) {
	test(`MCP gates a pending deletion and recovers ${point} before serving a new connection`, async () => {
		const created = createJob({ job_title: 'Interrupted MCP deletion', company_name: 'Example' }),
			job = getJob(created.id);
		await createDocument({ scope: job.id, filename: 'doc.md', content: 'original' });
		const client = await connect();
		await crashJob(job, point);
		const blocked = await client.call('delete_job', {
			job_id: job.id,
			dataset_id: job.dataset_id,
			confirm: true
		});
		assert.equal(blocked.ok, false);
		assert.equal(blocked.error.code, 'RECOVERY_REQUIRED');
		assert(existsSync(jobDeletionPath()));
		await client.close();
		const reopened = await connect();
		assert(!existsSync(jobDeletionPath()));
		assert.equal(
			(await reopened.call('get_saturday_info')).jobs,
			point === 'before-commit' ? 1 : 0
		);
		assert.equal(!!getJob(job.id), point === 'before-commit');
		assert.equal(
			existsSync(join(root, 'files', `jobs/${job.id}/doc.md`)),
			point === 'before-commit'
		);
		if (point === 'before-commit')
			assert.equal(
				(
					await reopened.call('delete_job', {
						job_id: job.id,
						dataset_id: job.dataset_id,
						confirm: true
					})
				).ok,
				true
			);
	});
}
