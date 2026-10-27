import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import {
	createApplication,
	createAssistantCatalog,
	capabilityStatus
} from '../src/lib/application/index.js';
import { parseJobInput, ValidationError } from '../src/lib/domain/validation.js';
import {
	webApplication as web,
	assistantApplication as assistant
} from '../src/lib/server/application.js';
import { localOperations } from '../src/lib/server/local-operations.js';
import { localCapabilities } from '../src/lib/server/platform.js';
import { migrateDatabase, withDatabase, inTransaction } from '../src/lib/server/database.js';

let scratch;
const environment = ['SATURDAY_DB_PATH', 'SATURDAY_FILES_PATH'];
const saved = Object.fromEntries(environment.map((key) => [key, process.env[key]]));
beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'saturday-application-'));
	process.env.SATURDAY_DB_PATH = join(scratch, 'db.sqlite');
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	migrateDatabase();
});
afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	for (const [key, value] of Object.entries(saved)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

test('portable application entry bundles without local, Node, framework or MCP runtime code', async () => {
	const result = await build({
		entryPoints: ['src/lib/application/index.js'],
		bundle: true,
		platform: 'browser',
		write: false,
		metafile: true
	});
	assert(result.outputFiles[0].contents.length > 0);
	for (const path of Object.keys(result.metafile.inputs)) {
		assert(!path.includes('/server/'), path);
		assert(!path.includes('@sveltejs/kit'), path);
		assert(!path.includes('@modelcontextprotocol'), path);
	}
});

test('application operations await asynchronous implementations and preserve validation errors', async () => {
	let finish;
	const delayed = new Promise((resolve) => {
		finish = resolve;
	});
	const app = createApplication(
		{
			createJob: async (_context, input) => {
				const values = parseJobInput(input);
				await delayed;
				return { id: 10, title: values.job_title };
			}
		},
		{ actor: 'manual', permissions: [] },
		{ records: true }
	);
	let settled = false;
	const pending = app
		.createJob({ job_title: 'Engineer', company_name: 'Example' })
		.then((value) => {
			settled = true;
			return value;
		});
	await Promise.resolve();
	assert.equal(settled, false);
	finish();
	assert.deepEqual(await pending, { id: 10, title: 'Engineer' });
	await assert.rejects(app.createJob({ job_title: '', company_name: 'Example' }), ValidationError);
});

test('actor labels and caller input cannot grant assessment, deletion or workflow permissions', async () => {
	const input = { job_title: 'Engineer', company_name: 'Example' };
	const job = await web.createJob(input, 'assistant');
	assert.equal(job.createdVia, 'manual');
	assert.equal((await web.createJob({ ...input, score: 9, score_comment: 'Forged' })).score, null);
	await assert.rejects(web.setJobScore(job.id, { score: 9 }), { code: 'forbidden' });
	const unprivileged = createApplication(
		localOperations,
		{ actor: 'assistant', permissions: [] },
		localCapabilities
	);
	await assert.rejects(
		unprivileged.createJob({ ...input, score: 9, permissions: ['assessment.write'] }),
		{ code: 'forbidden' }
	);
	await assert.rejects(
		unprivileged.deleteJob({
			job_id: job.id,
			dataset_id: (await web.getJob(job.id)).dataset_id,
			confirm: true
		}),
		{ code: 'forbidden' }
	);
	await assert.rejects(assistant.addWorkflowStage({ name: 'Unapproved' }), { code: 'forbidden' });
	const scored = await assistant.setJobScore(job.id, {
		score: 9,
		score_comment: 'Relevant experience'
	});
	assert.equal(scored.score, 9);
	assert.equal((await assistant.createJob(input)).createdVia, 'assistant');
	assert.equal((await web.getJob(job.id)).scoreComment, 'Relevant experience');
});

test('unsupported capabilities reject before local code executes and are absent from assistant discovery', async () => {
	let touched = false;
	const app = createApplication(
		{
			generateDocumentPdf: () => {
				touched = true;
			}
		},
		{ actor: 'assistant', permissions: [] },
		{ pdf: false }
	);
	await assert.rejects(app.generateDocumentPdf({ id: 'irrelevant' }), {
		code: 'unsupported_capability',
		capability: 'pdf'
	});
	assert.equal(touched, false);
	assert.deepEqual(capabilityStatus({}, 'pdf'), {
		capability: 'pdf',
		available: false,
		code: 'unsupported_capability',
		message: 'pdf is unavailable on this platform.'
	});
	const commands = createAssistantCatalog(assistant, { records: true, documents: true });
	assert(commands.some((command) => command.name === 'create_job'));
	assert(!commands.some((command) => command.name === 'generate_document_pdf'));
	assert(!commands.some((command) => command.name === 'export_backup'));
	assert(!commands.some((command) => /password|restart|installation/.test(command.name)));
});

test('web and assistant catalog share atomic placement/history/reminder operations and plain results', async () => {
	const commands = new Map(
		createAssistantCatalog(assistant, localCapabilities).map((command) => [command.name, command])
	);
	assert.equal(commands.size, 59);
	const job = await web.createJob({ job_title: 'Engineer', company_name: 'Example' });
	const stages = await web.listWorkflowStages();
	const applied = stages.find((stage) => stage.name === 'Applied');
	const before = await web.getJob(job.id);
	await assert.rejects(
		commands.get('change_job_stage').execute({
			job_id: job.id,
			stage_id: applied.id,
			event_date: '2020-01-01',
			reminder: { scheduled_at: 'invalid' }
		}),
		ValidationError
	);
	assert.deepEqual(await web.getJob(job.id), before);
	await commands.get('change_job_stage').execute({
		job_id: job.id,
		stage_id: applied.id,
		event_date: '2020-01-01',
		note: 'Applied',
		reminder: { scheduled_at: '2099-01-01T00:00' }
	});
	const current = await web.getJob(job.id);
	assert.equal(current.currentStageId, applied.id);
	assert.equal(current.updates.length, before.updates.length + 1);
	assert.equal((await web.listReminders({ job_id: job.id })).reminders.length, 1);
	const discovered = await commands.get('get_job').execute({ job_id: job.id });
	assert.equal(discovered.current_stage_id, current.currentStageId);
	assert.equal(
		discovered.updates.find((entry) => entry.stage_id === applied.id).created_via,
		'assistant'
	);
	assert.deepEqual(JSON.parse(JSON.stringify(discovered)), discovered);
});

test('people, relationships, interactions and tag merge remain available through the same boundary', async () => {
	const job = await web.createJob({ job_title: 'Engineer', company_name: 'Example' });
	const person = await assistant.createNetwork({ name: 'Alex' });
	await web.linkJobNetwork({ job_id: job.id, network_id: person.id, notes: 'Referral' });
	await assistant.addNetworkUpdate({
		network_id: person.id,
		interaction_date: '2020-01-01',
		note: 'Met',
		reminder: { scheduled_at: '2099-01-01T00:00' }
	});
	assert.equal((await web.listNetworkUpdates({ network_id: person.id })).updates.length, 1);
	assert.equal((await web.listNetworkJobs({ network_id: person.id })).jobs.length, 1);
	const first = await web.createTag({
		collection: 'person',
		name: 'career fair',
		color: '#123456'
	});
	const second = await assistant.createTag({
		collection: 'person',
		name: 'referral',
		color: '#654321'
	});
	await web.setTagAssignments({
		collection: 'person',
		owner_id: person.id,
		tag_ids: [first.id, second.id]
	});
	await assistant.mergeTags({
		collection: 'person',
		first_tag_id: first.id,
		second_tag_id: second.id,
		confirm: true
	});
	assert.deepEqual(
		(await web.getNetwork(person.id)).tags.map((tag) => tag.id),
		[first.id]
	);
});

test('document contract streams bytes and ranges without paths and preserves conflicts and Profile assignments', async () => {
	const bytes = new TextEncoder().encode('first second third');
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(bytes.subarray(0, 6));
			controller.enqueue(bytes.subarray(6));
			controller.close();
		}
	});
	const uploaded = await web.uploadDocument({ filename: 'resume.md', stream });
	assert.equal(uploaded.key, 'documents/resume.md');
	const catalog = await web.listDocuments();
	await web.setMasterDocument({
		id: uploaded.id,
		token: uploaded.token,
		catalog_token: catalog.catalog_token
	});
	const opened = await web.openDocument({
		id: uploaded.id,
		token: uploaded.token,
		range: { start: 6, end: 11 }
	});
	assert(opened.stream instanceof ReadableStream);
	assert.equal(await new Response(opened.stream).text(), 'second');
	assert(!('path' in opened));
	assert(!('root' in (await web.storageSummary())));
	const edited = await assistant.editDocument({
		id: uploaded.id,
		token: uploaded.token,
		content: 'New content'
	});
	await assert.rejects(
		web.editDocument({ id: uploaded.id, token: uploaded.token, content: 'Stale' }),
		{ code: 'CONFLICT' }
	);
	const current = await web.listDocuments();
	await assert.rejects(
		web.deleteDocument({
			id: edited.id,
			token: edited.token,
			confirm: true,
			catalog_token: current.catalog_token
		}),
		{ code: 'CONFIRMATION' }
	);
	await web.deleteDocument({
		id: edited.id,
		token: edited.token,
		confirm: true,
		catalog_token: current.catalog_token,
		clear_designations: true
	});
	assert.equal((await web.listDocuments()).designations.master_cv, null);
});

test('accidental asynchronous SQLite callbacks roll back instead of committing early', () => {
	withDatabase((db) => {
		const before = db.prepare('SELECT name FROM workflow_stages WHERE id=1').get().name;
		assert.throws(
			() =>
				inTransaction(db, async () => {
					db.prepare('UPDATE workflow_stages SET name=? WHERE id=1').run('Must roll back');
					await Promise.resolve();
				}),
			{ code: 'async_transaction' }
		);
		assert.equal(db.prepare('SELECT name FROM workflow_stages WHERE id=1').get().name, before);
	});
	assert.throws(() => withDatabase(async () => 1), { code: 'async_transaction' });
});
