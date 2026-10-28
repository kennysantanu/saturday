// Explicit developer command: create a new fixture directory once; tests only consume it.
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
const { values } = parseArgs({
	options: { source: { type: 'string' }, output: { type: 'string' }, commit: { type: 'string' } }
});
if (!values.source || !values.output || !/^[a-f0-9]{40}$/.test(values.commit ?? ''))
	throw new Error(
		'Provide --source, --output and the full verified --commit. Existing fixtures must never be overwritten.'
	);
const source = resolve(values.source),
	output = resolve(values.output);
if (existsSync(output))
	throw new Error('Fixture output already exists. Retain released fixtures unchanged.');
const pkg = JSON.parse(await fs.readFile(join(source, 'package.json')));
if (
	pkg.version !== '0.1.0' ||
	pkg.saturday.storage.database.currentVersion !== 1 ||
	pkg.saturday.storage.manifest.version !== 1
)
	throw new Error('This reproducer is pinned to app 0.1.0 and storage baseline 1.');
const scratch = await fs.mkdtemp('/private/tmp/saturday-fixture-producer-');
for (const key of Object.keys(process.env))
	if (key.startsWith('SATURDAY_')) delete process.env[key];
Object.assign(process.env, {
	SATURDAY_INSTALLATION_PATH: '',
	SATURDAY_PROJECT_ROOT: source,
	SATURDAY_DB_PATH: join(scratch, 'database.sqlite'),
	SATURDAY_FILES_PATH: join(scratch, 'files'),
	SATURDAY_EXTENSION_STATE_PATH: join(scratch, 'extensions'),
	SATURDAY_EXTENSIONS_PATH: join(scratch, 'extension-code')
});
const load = (name) => import(pathToFileURL(join(source, 'src/lib/server', name)));
const database = await load('database.js'),
	{ webApplication: app, assistantApplication: assistant } = await load('application.js');
try {
	database.migrateDatabase();
	const fresh = database.withDatabase((db) => ({
		stages: db.prepare('SELECT count(*) n FROM workflow_stages').get().n,
		jobs: db.prepare('SELECT count(*) n FROM jobs').get().n
	}));
	if (fresh.stages !== 8 || fresh.jobs !== 0) throw new Error('Unexpected initialization.');
	await app.renameWorkflowStage(1, 'Research');
	await app.addWorkflowStage({ name: 'Technical review' });
	const stages = await app.listWorkflowStages(),
		technical = stages.find((stage) => stage.name === 'Technical review');
	const job = await app.createJob({
		job_title: 'Fictional engineer',
		company_name: 'Example Labs',
		notes: 'Release compatibility fixture only',
		location: 'Example City',
		is_starred: true
	});
	const closed = await assistant.createJob({
		job_title: 'Fictional analyst',
		company_name: 'Example Company'
	});
	await app.moveJobStage(job.id, {
		stage_id: technical.id,
		event_date: '2026-10-20',
		note: 'Technical discussion recorded.'
	});
	await app.moveJobStage(closed.id, {
		stage_id: stages.find((stage) => stage.name === 'Accepted').id,
		event_date: '2026-10-20'
	});
	await app.addJobUpdate({
		job_id: job.id,
		event_date: '2026-10-21',
		note: 'Independent historical note.'
	});
	await assistant.setJobScore(job.id, {
		score: 0,
		score_comment: 'Fictional zero score verifies missing-versus-zero handling.'
	});
	const person = await app.createNetwork({
		name: 'Example Person',
		role: 'Recruiter',
		organization: 'Example Labs',
		email: 'person@example.invalid'
	});
	await app.linkJobNetwork({
		job_id: job.id,
		network_id: person.id,
		notes: 'Fictional introduction.'
	});
	await app.addNetworkUpdate({
		network_id: person.id,
		interaction_date: '2026-10-20',
		note: 'Fictional conversation.'
	});
	await app.createReminder({
		job_id: job.id,
		scheduled_at: '2026-11-01T00:00',
		note: 'Date-only reminder.'
	});
	await assistant.createReminder({
		network_id: person.id,
		scheduled_at: '2026-11-02T14:30',
		note: 'Fixed-time reminder.'
	});
	const prior = await app.createReminder({ job_id: closed.id, scheduled_at: '2026-10-20T00:00' });
	await app.dismissReminder({ job_id: closed.id, reminder_id: prior.id });
	for (const [collection, owner_id, name, color] of [
		['job', job.id, 'release_fixture', '#336699'],
		['person', person.id, 'example_contact', '#885522']
	]) {
		const tag = await app.createTag({ collection, name, color });
		await app.setTagAssignments({ collection, owner_id, tag_ids: [tag.id] });
	}
	const docs = await load('files/documents.js');
	for (const [designation, filename, content] of [
		['master_cv', 'fictional-cv.md', '# Fictional CV\n\nExample experience only.\n'],
		[
			'resume_template',
			'resume.html',
			'<!doctype html><title>Fictional resume</title><h1>Example Person</h1>'
		],
		[
			'cover_letter_template',
			'cover-letter.html',
			'<!doctype html><title>Fictional cover letter</title><p>Example content.</p>'
		],
		['career_direction', 'direction.md', '# Direction\n\nFictional engineering roles.\n'],
		[
			'assistant_preferences',
			'preferences.md',
			'# Preferences\n\nUse only fictional fixture facts.\n'
		]
	]) {
		const document = await docs.createDocument({ filename, content });
		await docs.setMasterDocument({
			id: document.id,
			token: document.token,
			designation,
			catalog_token: (await docs.listDocuments()).catalog_token
		});
	}
	await docs.createDocument({
		scope: job.id,
		filename: 'job-note.md',
		content: '# Job document\n\nIndependent fictional attachment.\n'
	});
	const pairService = await load('files/pairs.js'),
		backups = await load('backups.js'),
		fileBackups = await load('files/backups.js');
	const pair = await pairService.createManualBackup({ contents: 'all' });
	await fs.mkdir(output);
	await fs.mkdir(join(output, 'backups'));
	await fs.copyFile(process.env.SATURDAY_DB_PATH, join(output, 'database.sqlite'));
	await fs.cp(process.env.SATURDAY_FILES_PATH, join(output, 'files'), { recursive: true });
	const dbBackup = backups.getBackupFile(pair.database_backup_id),
		fileBackup = await fileBackups.getFileBackup(pair.file_backup_id);
	await fs.copyFile(dbBackup.path, join(output, 'backups/database.sqlite'));
	await fs.copyFile(fileBackup.path, join(output, 'backups/files.zip'));
	await pairService.exportManualBackup(
		{ backup_id: pair.database_backup_id, contents: 'all' },
		join(output, 'backups/combined.zip')
	);
	const tables = database.withDatabase((db) =>
		Object.fromEntries(
			db
				.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
				.all()
				.map(({ name }) => [
					name,
					db
						.prepare(`SELECT * FROM "${name}" ORDER BY rowid`)
						.all()
						.map((row) => ({ ...row }))
				])
		)
	);
	const manifest = JSON.parse(await fs.readFile(join(output, 'files/manifest.json')));
	const hashes = {};
	async function walk(dir, prefix = '') {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const key = prefix + entry.name,
				path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path, key + '/');
			else
				hashes[key] = createHash('sha256')
					.update(await fs.readFile(path))
					.digest('hex');
		}
	}
	await walk(output);
	await fs.writeFile(
		join(output, 'expected.json'),
		JSON.stringify(
			{
				format: 'saturday.release-fixture',
				version: 1,
				app_version: pkg.version,
				source_commit: values.commit,
				producer_mode: 'source services from verified snapshot',
				storage: pkg.saturday.storage,
				dataset_id: manifest.dataset_id,
				tables,
				documents: manifest.documents.map(({ id, key, size, sha256 }) => ({
					id,
					key,
					size,
					sha256
				})),
				designations: manifest.designations,
				hashes
			},
			null,
			2
		) + '\n'
	);
	console.log(
		JSON.stringify({
			output,
			dataset_id: manifest.dataset_id,
			source_commit: values.commit,
			jobs: tables.jobs.length,
			documents: manifest.documents.length
		})
	);
} finally {
	await fs.rm(scratch, { recursive: true, force: true });
}
