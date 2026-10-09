import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
const root = await mkdtemp(join(tmpdir(), 'saturday-files-test-'));
process.env.SATURDAY_FILES_PATH = join(root, 'files');
process.env.SATURDAY_DB_PATH = join(root, 'jobs.sqlite');
const d = await import('../src/lib/server/files/documents.js');
const b = await import('../src/lib/server/files/backups.js');
const s = await import('../src/lib/server/files/store.js');
const jobs = await import('../src/lib/server/services.js');
const pairs = await import('../src/lib/server/files/pairs.js');
const pdf = await import('../src/lib/server/files/pdf.js');
test.after(async () => rm(root, { recursive: true, force: true }));
let cv, job, backup;
test('shared text files, designation, scopes, independent copies and conflict tokens', async () => {
	job = jobs.createJob({ job_title: 'Engineer', company_name: 'Saturday' }, 'manual');
	cv = await d.createDocument(
		{ filename: 'master.md', content: '# Profile\n\nA **career**.' },
		'mcp'
	);
	const stored = JSON.parse(await readFile(join(s.filePaths().root, 'manifest.json'), 'utf8'));
	assert.deepEqual(
		Object.keys(stored.documents[0]).sort(),
		['id', 'key', 'size', 'sha256', 'created_via', 'created_at', 'updated_at', 'token'].sort()
	);
	await assert.rejects(d.editDocument({ id: cv.id, token: cv.token }), { code: 'VALIDATION' });
	let listing = await d.listDocuments();
	await d.setMasterDocument({ id: cv.id, token: cv.token, catalog_token: listing.catalog_token });
	assert.equal(
		(await d.getDocument({ designation: 'master_cv', include_content: true })).content,
		'# Profile\n\nA **career**.'
	);
	cv = await d.editDocument({ id: cv.id, token: cv.token, filename: 'renamed.md' });
	assert.equal((await d.getDocument({ designation: 'master_cv' })).id, cv.id);
	await assert.rejects(d.getDocument({ id: cv.id, scope: job.id }), { code: 'NOT_FOUND' });
	const copy = await d.copyDocument({
		id: cv.id,
		token: cv.token,
		destination_scope: job.id,
		filename: 'tailored.md'
	});
	assert.equal(copy.designation, null);
	assert.notEqual(copy.id, cv.id);
	await d.editDocument({ id: copy.id, scope: job.id, token: copy.token, content: '' });
	assert.match((await d.getDocument({ id: cv.id, include_content: true })).content, /career/);
	await assert.rejects(d.editDocument({ id: cv.id, token: 'stale', content: 'bad' }), {
		code: 'CONFLICT'
	});
	await assert.rejects(d.editDocument({ id: cv.id, token: cv.token, filename: 'cv.html' }), {
		code: 'VALIDATION'
	});
	await assert.rejects(
		d.setMasterDocument({
			id: copy.id,
			token: copy.token,
			catalog_token: (await d.listDocuments()).catalog_token
		}),
		{ code: 'NOT_FOUND' }
	);
});
test('portable filenames, literal search, binary management and byte limits', async () => {
	for (const name of ['../evil.md', 'CON.txt', 'a/b.txt', 'x'.repeat(256) + '.md'])
		await assert.rejects(d.createDocument({ filename: name, content: 'x' }));
	const text = await d.createDocument({ filename: '100%_literal.txt', content: 'hello' });
	assert.equal((await d.listDocuments({ query: '%_' })).total, 1);
	await assert.rejects(
		d.createDocument({ filename: 'huge.txt', content: 'é'.repeat(s.TEXT_LIMIT) }),
		{ code: 'SIZE_LIMIT' }
	);
	const binary = await d.uploadDocument({
		filename: 'thing.bin',
		stream: Readable.from([Buffer.from([0, 1, 255])])
	});
	await assert.rejects(d.getDocument({ id: binary.id, include_content: true }), {
		code: 'UNSUPPORTED_FORMAT'
	});
	const renamed = await d.editDocument({
		id: binary.id,
		token: binary.token,
		filename: 'renamed.bin'
	});
	assert.equal(renamed.sha256, binary.sha256);
	await assert.rejects(
		d.editDocument({ id: renamed.id, token: renamed.token, filename: 'bad.txt' }),
		{ code: 'ENCODING' }
	);
	const duplicate = await d.copyDocument({ id: text.id, token: text.token });
	assert.equal(duplicate.filename, '100%_literal copy.txt');
	await d.deleteDocument({ id: duplicate.id, token: duplicate.token, confirm: true });
});
test('editor snapshots include eligible content and retain download-only capabilities', async () => {
	const options = { includeAvailableContent: true };
	const text = await d.createDocument({ filename: 'snapshot.md', content: '# Snapshot' });
	const snapshot = await d.getDocument({ id: text.id }, options);
	assert.equal(snapshot.content, '# Snapshot');
	assert.equal(snapshot.token, text.token);
	assert.equal(snapshot.can_edit_text, true);
	assert.equal(Object.hasOwn(await d.getDocument({ id: text.id }), 'content'), false);
	for (const [filename, bytes] of [
		['snapshot.bin', Buffer.from([0, 255])],
		['invalid-utf8.txt', Buffer.from([255])],
		['oversized.txt', Buffer.alloc(s.TEXT_LIMIT + 1)],
		['snapshot.pdf', Buffer.from('%PDF-1.7\n')]
	]) {
		const file = await d.uploadDocument({ filename, stream: Readable.from([bytes]) });
		const result = await d.getDocument({ id: file.id }, options);
		assert.equal(Object.hasOwn(result, 'content'), false);
		assert.equal(result.can_edit_text, false);
		assert.equal(result.can_preview, filename.endsWith('.pdf'));
		await d.deleteDocument({ id: file.id, token: file.token, confirm: true });
	}
});
test('counting, stable pagination and direct designation lookup beyond page one', async () => {
	for (let i = 0; i < 102; i++)
		await d.createDocument({
			filename: `aaa-${String(i).padStart(3, '0')}.txt`,
			content: String(i)
		});
	const first = await d.listDocuments({ limit: 50 });
	const second = await d.listDocuments({ limit: 50, page: 2, catalog_token: first.catalog_token });
	assert.equal(first.documents.length, 50);
	assert.equal(second.documents.length, 50);
	assert.ok(first.total > 100);
	assert.ok(!first.documents.some((a) => second.documents.some((b) => a.id === b.id)));
	assert.equal((await d.getDocument({ designation: 'master_cv' })).id, cv.id);
	await d.createDocument({ filename: 'new.txt', content: 'new' });
	await assert.rejects(d.listDocuments({ page: 2, catalog_token: first.catalog_token }), {
		code: 'CONFLICT'
	});
});
test('ZIP backup/import, add conflicts, Replace recovery and old token invalidation', async () => {
	backup = await b.createFileBackup();
	const path = (await b.getFileBackup(backup.backup_id)).path;
	const imported = await b.importFileBackup((await import('node:fs')).createReadStream(path));
	assert.equal(imported.file_count, backup.file_count);
	const before = await d.getDocument({ id: cv.id });
	await d.editDocument({ id: cv.id, token: before.token, content: 'changed' });
	await assert.rejects(b.prepareFileRestore({ backup_id: backup.backup_id }), { code: 'CONFLICT' });
	const preview = await b.prepareFileRestore({ backup_id: backup.backup_id, mode: 'replace' });
	const result = await b.restoreFiles({ restore_id: preview.restore_id, confirm: true });
	assert.ok(result.recovery_backup_id);
	const restored = await d.getDocument({ id: cv.id, include_content: true });
	assert.match(restored.content, /career/);
	assert.notEqual(restored.token, before.token);
	await assert.rejects(d.editDocument({ id: cv.id, token: before.token, content: 'stale' }), {
		code: 'CONFLICT'
	});
	await assert.rejects(b.restoreFiles({ restore_id: preview.restore_id, confirm: true }), {
		code: 'CONSUMED'
	});
});
test('independent schedule settings and safe failed automatic runs', async () => {
	const settings = await b.setFileBackupSettings({
		enabled: true,
		interval_hours: 2,
		keep_count: 1
	});
	assert.equal(settings.keep_count, 1);
	await assert.rejects(b.setFileBackupSettings({ interval_hours: 0 }), { code: 'VALIDATION' });
	const success = await b.runScheduledFileBackup();
	assert.equal(success.kind, 'automatic');
	const preview = await b.prepareFileRestore({ backup_id: success.backup_id });
	await b.setFileBackupSettings({ enabled: false });
	await b.setFileBackupSettings({ enabled: true });
	const next = await b.runScheduledFileBackup();
	assert.equal(next.kind, 'automatic');
	assert.ok((await b.listFileBackups()).backups.some((x) => x.backup_id === success.backup_id));
	const previewPath = join(s.filePaths().state, `${preview.restore_id}.restore.json`);
	const record = JSON.parse(await readFile(previewPath, 'utf8'));
	await writeFile(previewPath, JSON.stringify({ ...record, expires_at: '2000-01-01T00:00:00Z' }));
	await b.setFileBackupSettings({ enabled: false });
	await b.setFileBackupSettings({ enabled: true });
	const latest = await b.runScheduledFileBackup();
	const automatic = (await b.listFileBackups()).backups.filter((x) => x.kind === 'automatic');
	assert.deepEqual(
		automatic.map((x) => x.backup_id),
		[latest.backup_id]
	);
	await b.setFileBackupSettings({ enabled: false });
	assert.equal((await b.getFileBackupSettings()).enabled, false);
	assert.ok((await b.listFileBackups()).backups.some((x) => x.backup_id === backup.backup_id));
});
test('symlinks and external changes are rejected without silent repair', async () => {
	const file = await d.createDocument({ filename: 'integrity.txt', content: 'original' });
	const path = join(s.filePaths().root, file.key);
	await writeFile(path, 'external');
	await assert.rejects(d.getDocument({ id: file.id, include_content: true }), {
		code: 'INTEGRITY'
	});
	await writeFile(path, 'original');
	await rm(path);
	await symlink(join(root, 'jobs.sqlite'), path);
	await assert.rejects(d.getDocument({ id: file.id, include_content: true }), { code: 'STORAGE' });
	await rm(path);
	await writeFile(path, 'original');
});
test('journal resumes an interrupted publication before reads', async () => {
	const manifest = JSON.parse(await readFile(join(s.filePaths().root, 'manifest.json'), 'utf8'));
	const entry = manifest.documents.find((x) => x.id === cv.id);
	const bytes = Buffer.from('Recovered');
	Object.assign(entry, s.bytesMetadata(bytes), { token: 'recovered-token' });
	await (
		await import('node:fs/promises')
	).mkdir(join(s.filePaths().state, 'pending'), { recursive: true });
	await writeFile(join(s.filePaths().state, 'pending', '0'), bytes);
	await s.atomicJson(join(s.filePaths().state, 'journal.json'), {
		manifest,
		changes: [{ key: entry.key, remove: false }]
	});
	assert.equal((await d.getDocument({ id: cv.id, include_content: true })).content, 'Recovered');
});
test('coordinated capture and restore preserve both artifacts', async () => {
	const pair = await pairs.createBackupPair();
	assert.ok(pair.backup_set_id);
	assert.ok(pair.file_backup_id);
	assert.match(pair.database_sha256, /^[a-f0-9]{64}$/);
	assert.match(pair.files_sha256, /^[a-f0-9]{64}$/);
	const preview = await pairs.prepareBackupPairRestore({ file_backup_id: pair.file_backup_id });
	const result = await pairs.restoreBackupPair({ restore_id: preview.restore_id, confirm: true });
	assert.ok(result.database.recovery_backup_id);
	assert.ok(result.files.recovery_backup_id);
});
test('two processes serialize creates without catalog loss', async () => {
	const script = `import {createDocument} from './src/lib/server/files/documents.js';await createDocument({filename:process.argv[1],content:'process'});`;
	const run = (name) =>
		new Promise((res, rej) => {
			const child = spawn(process.execPath, ['--input-type=module', '-e', script, name], {
				cwd: process.cwd(),
				env: process.env,
				stdio: ['ignore', 'pipe', 'pipe']
			});
			let err = '';
			child.stderr.on('data', (c) => (err += c));
			child.on('error', rej);
			child.on('exit', (code) => (code ? rej(new Error(err)) : res()));
		});
	await Promise.all([run('process-a.txt'), run('process-b.txt')]);
	assert.equal((await d.listDocuments({ query: 'process-' })).total, 2);
});
test('real HTML PDF generation saves independently and enforces source conflicts', async () => {
	assert.equal(
		(await pdf.pdfReadiness()).ready,
		true,
		'Install Puppeteer Chrome before running integration tests'
	);
	const html = await d.createDocument(
		{
			scope: job.id,
			filename: 'resume.html',
			content:
				'<!doctype html><style>@page{size:A4}body{font:12pt sans-serif}</style><h1>Résumé</h1><p>Selectable career history.</p>'
		},
		'mcp'
	);
	const result = await pdf.generateDocumentPdf(
		{ id: html.id, scope: job.id, token: html.token },
		'mcp'
	);
	assert.equal(result.filename, 'resume.pdf');
	assert.equal(result.created_via, 'mcp');
	assert.ok(result.size > 1000);
	await assert.rejects(pdf.generateDocumentPdf({ id: html.id, scope: job.id, token: 'old' }), {
		code: 'CONFLICT'
	});
	const invalid = await d.createDocument({
		filename: 'invalid-page.html',
		content: '<style>@page {size:100in}</style><p>Keep this source.</p>'
	});
	const before = (await d.listDocuments()).total;
	await assert.rejects(pdf.generateDocumentPdf({ id: invalid.id, token: invalid.token }), {
		code: 'VALIDATION'
	});
	assert.equal((await d.listDocuments()).total, before, 'Failed rendering publishes no PDF');
	assert.equal(
		(await d.getDocument({ id: invalid.id, include_content: true })).token,
		invalid.token
	);
	const fixed = await d.editDocument({
		id: invalid.id,
		token: invalid.token,
		content: '<p>Valid page.</p>'
	});
	assert.equal(
		(await pdf.generateDocumentPdf({ id: fixed.id, token: fixed.token })).filename,
		'invalid-page.pdf'
	);
});

test('manifest validation preserves extensions and refuses unknown versions', async () => {
	const m = JSON.parse(await readFile(join(s.filePaths().root, 'manifest.json'), 'utf8'));
	m.custom = { future_note: 'preserve' };
	const converted = s.migrateManifest(m);
	assert.deepEqual(converted.custom, m.custom);
	assert.notEqual(converted, m);
	assert.throws(() => s.migrateManifest({ ...m, format_version: 3 }), { code: 'FORMAT' });
	const stable = await readFile(join(s.filePaths().root, 'manifest.json'), 'utf8');
	await writeFile(
		join(s.filePaths().root, 'manifest.json'),
		JSON.stringify({ ...m, format_version: 3 })
	);
	try {
		await assert.rejects(d.listDocuments(), { code: 'FORMAT' });
		assert.throws(() => jobs.getJob(job.id), { code: 'FORMAT' });
	} finally {
		await writeFile(join(s.filePaths().root, 'manifest.json'), stable);
	}
	assert.ok(jobs.getJob(job.id));
});
test('corrupt and extra archive contents fail without modifying live state', async () => {
	const { default: yazl } = await import('yazl');
	const { pipeline } = await import('node:stream/promises');
	const { createWriteStream, createReadStream } = await import('node:fs');
	const m = JSON.parse(await readFile(join(s.filePaths().root, 'manifest.json'), 'utf8'));
	const original = (await d.getDocument({ id: cv.id, include_content: true })).content;
	const path = join(root, 'malicious.zip');
	const zip = new yazl.ZipFile();
	const output = pipeline(zip.outputStream, createWriteStream(path));
	zip.addBuffer(Buffer.from(JSON.stringify({ ...m, documents: [] })), 'manifest.json');
	zip.addBuffer(Buffer.from('extra'), 'documents/extra.txt');
	zip.end();
	await output;
	await assert.rejects(b.importFileBackup(createReadStream(path)), { code: 'FORMAT' });
	assert.equal((await d.getDocument({ id: cv.id, include_content: true })).content, original);
});
test('delete Master CV requires both acknowledgement and fresh catalog token', async () => {
	const current = await d.getDocument({ designation: 'master_cv' });
	await assert.rejects(d.deleteDocument({ id: current.id, token: current.token, confirm: true }), {
		code: 'CONFLICT'
	});
	await assert.rejects(
		d.deleteDocument({
			id: current.id,
			token: current.token,
			confirm: true,
			catalog_token: current.catalog_token
		}),
		{ code: 'CONFIRMATION' }
	);
	await d.setMasterDocument({ id: null, catalog_token: current.catalog_token });
	assert.equal((await d.getDocument({ id: current.id, include_content: true })).id, current.id);
	await assert.rejects(d.getDocument({ designation: 'master_cv' }), { code: 'NOT_CONFIGURED' });
});
test('failed scheduled backup keeps previous artifacts and reports status', async () => {
	const file = await d.createDocument({ filename: 'scheduled-integrity.txt', content: 'healthy' });
	await writeFile(join(s.filePaths().root, file.key), 'tampered');
	const before = await b.listFileBackups();
	await b.setFileBackupSettings({ enabled: true, interval_hours: 1, keep_count: 1 });
	const result = await b.runScheduledFileBackup();
	assert.ok(result.error);
	assert.equal((await b.listFileBackups()).total, before.total);
	assert.ok((await b.getFileBackupSettings()).last_error);
	await writeFile(join(s.filePaths().root, file.key), 'healthy');
	await b.setFileBackupSettings({ enabled: false });
});
test('offline recovery preserves damaged store and restores validated contents', async () => {
	const snapshot = await b.createFileBackup();
	const { path } = await b.getFileBackup(snapshot.backup_id);
	await writeFile(join(s.filePaths().root, 'manifest.json'), '{broken');
	await assert.rejects(d.listDocuments());
	const result = await new Promise((res, rej) => {
		const child = spawn(process.execPath, ['scripts/files.mjs', 'recover', path, '--confirm'], {
			env: process.env,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let out = '',
			err = '';
		child.stdout.on('data', (c) => (out += c));
		child.stderr.on('data', (c) => (err += c));
		child.on('error', rej);
		child.on('close', (code) => (code ? rej(new Error(err)) : res(JSON.parse(out))));
	});
	assert.equal(result.recovered, true);
	assert.equal(await readFile(join(result.original, 'manifest.json'), 'utf8'), '{broken');
	assert.ok((await d.listDocuments()).total > 100);
});

test('failed coordinated file validation returns both stores to recovery snapshots', async () => {
	const pair = await pairs.createBackupPair();
	const prepared = await pairs.prepareBackupPairRestore({ file_backup_id: pair.file_backup_id });
	const record = JSON.parse(
		await readFile(join(s.filePaths().state, `${prepared.files.restore_id}.restore.json`), 'utf8')
	);
	const target = record.manifest.documents[0];
	await writeFile(join(record.stage, target.key), 'corrupt staged content');
	const before = (await d.listDocuments()).total;
	await assert.rejects(
		pairs.restoreBackupPair({ restore_id: prepared.restore_id, confirm: true }),
		{ code: 'RESTORE_FAILED' }
	);
	assert.equal((await d.listDocuments()).total, before);
	assert.ok(jobs.getJob(job.id));
});

test('abandoned file and scheduler locks recover without deleting a new owner', async () => {
	const script = `import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {randomUUID} from 'node:crypto';for(const name of ['lock','scheduled.lock']){const dir=join(process.env.SATURDAY_FILES_PATH+'.state',name);await mkdir(dir);await writeFile(join(dir,process.pid+'-'+randomUUID()+'.owner'),'');}`;
	await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
			env: process.env,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let error = '';
		child.stderr.on('data', (c) => (error += c));
		child.on('error', reject);
		child.on('close', (code) => (code ? reject(new Error(error)) : resolve()));
	});
	await Promise.all([
		d.createDocument({ filename: 'reclaimed-a.txt', content: 'a' }),
		d.createDocument({ filename: 'reclaimed-b.txt', content: 'b' })
	]);
	assert.equal((await d.listDocuments({ query: 'reclaimed-' })).total, 2);
	await b.runScheduledFileBackup();
	await assert.rejects(s.fs.access(join(s.filePaths().state, 'scheduled.lock')), {
		code: 'ENOENT'
	});
	const release = await s.acquireDirectoryLock(join(s.filePaths().state, 'lock'));
	assert.equal(
		await s.acquireDirectoryLock(join(s.filePaths().state, 'lock'), { attempts: 0 }),
		null
	);
	await release();
});

test('case-only renames preserve bytes on case-insensitive storage', async () => {
	const created = await d.createDocument({ filename: 'CASE-NAME.txt', content: 'case preserved' });
	const renamed = await d.editDocument({
		id: created.id,
		token: created.token,
		filename: 'case-name.txt'
	});
	assert.equal(renamed.id, created.id);
	await assert.rejects(d.openDocument({ id: renamed.id, token: created.token }), {
		code: 'CONFLICT'
	});
	assert.equal(
		(await d.getDocument({ id: renamed.id, include_content: true })).content,
		'case preserved'
	);
	await s.withFileLock(s.validateWholeStore);
});

test('coordinated pair preparation rejects mismatched artifact identities', async () => {
	const pair = await pairs.createBackupPair();
	const path = join(s.filePaths().backups, `${pair.backup_set_id}.pair.json`);
	const original = await readFile(path, 'utf8');
	await writeFile(path, JSON.stringify({ ...pair, database_sha256: '0'.repeat(64) }));
	await assert.rejects(pairs.prepareBackupPairRestore({ file_backup_id: pair.file_backup_id }), {
		code: 'INTEGRITY'
	});
	await writeFile(path, original);
});

async function isolatedStores(run) {
	const previousDb = process.env.SATURDAY_DB_PATH;
	const previousFiles = process.env.SATURDAY_FILES_PATH;
	const scratch = await mkdtemp(join(root, 'namespace-'));
	process.env.SATURDAY_DB_PATH = join(scratch, 'database.sqlite');
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	try {
		await run(scratch);
	} finally {
		process.env.SATURDAY_DB_PATH = previousDb;
		process.env.SATURDAY_FILES_PATH = previousFiles;
		await rm(scratch, { recursive: true, force: true });
	}
}

test('new file stores bind once to the database and accept only canonical numeric job keys', async () => {
	await isolatedStores(async () => {
		const database = await import('../src/lib/server/database.js');
		await d.createDocument({ filename: 'cv.md', content: '# CV' });
		const m = JSON.parse(await readFile(join(s.filePaths().root, 'manifest.json'), 'utf8'));
		assert.equal(m.format, 'saturday.files.numeric');
		assert.equal(m.dataset_id, database.databaseIdentity().dataset_id);
		const original = m.dataset_id;
		database.migrateDatabase();
		await d.listDocuments();
		assert.equal(database.databaseIdentity().dataset_id, original);
		for (const id of ['01', '0', '-1', '1.0', '1e1', 'abc', '9007199254740992'])
			assert.throws(() => s.validKey(`jobs/${id}/cv.md`), { code: 'VALIDATION' });
		assert.equal(s.validKey('jobs/2345/cv.md'), 'jobs/2345/cv.md');
		const { format, dataset_id, ...legacy } = m;
		assert.throws(() => s.validateManifest(legacy), { code: 'FORMAT' });
		assert.throws(() => s.validateManifest({ ...m, dataset_id: 'unknown' }), { code: 'FORMAT' });
	});
});

test('same numeric job in another dataset cannot expose files; independent backup and explicit recovery remain available', async () => {
	await isolatedStores(async (scratch) => {
		const first = jobs.createJob({ job_title: 'Original', company_name: 'A' });
		const file = await d.createDocument({
			scope: first.id,
			filename: 'resume.html',
			content: '<p>Private A</p>'
		});
		const userFile = await d.createDocument({ filename: 'notes.md', content: 'Shared collection' });
		const identity = (await import('../src/lib/server/database.js')).databaseIdentity().dataset_id;
		process.env.SATURDAY_DB_PATH = join(scratch, 'other.sqlite');
		const other = jobs.createJob({ job_title: 'Different', company_name: 'B' });
		assert.equal(first.id, other.id);
		for (const operation of [
			() => d.listDocuments({ scope: other.id }),
			() => d.getDocument({ id: file.id, scope: other.id, include_content: true }),
			() => d.openDocument({ id: file.id, scope: other.id }),
			() => d.editDocument({ id: file.id, scope: other.id, token: file.token, content: 'Wrong' }),
			() =>
				d.copyDocument({
					id: userFile.id,
					token: userFile.token,
					destination_scope: other.id,
					filename: 'copy.md'
				}),
			() => pdf.generateDocumentPdf({ id: file.id, scope: other.id, token: file.token }),
			() => pairs.createBackupPair()
		])
			await assert.rejects(operation, { code: 'DATASET_MISMATCH' });
		assert.equal(
			(await d.getDocument({ id: userFile.id, include_content: true })).content,
			'Shared collection'
		);
		assert.deepEqual((await d.storageSummary()).unmatched, ['1']);
		assert.equal((await d.recoveryDocuments(1))[0].id, file.id);
		const recovered = await d.recoverCopy({
			id: file.id,
			job_id: 1,
			token: file.token,
			destination_scope: 'documents',
			filename: 'recovered.html'
		});
		assert.equal(
			(await d.getDocument({ id: recovered.id, include_content: true })).content,
			'<p>Private A</p>'
		);
		const artifact = await b.createFileBackup();
		assert.equal(artifact.dataset_id, identity);
		assert.equal(typeof artifact.creator_build, 'string');
		assert.equal(jobs.getJob(other.id).title, 'Different');
		// Initialized file collections can be backed up even without a database.
		process.env.SATURDAY_DB_PATH = join(scratch, 'absent.sqlite');
		assert.equal((await b.createFileBackup()).dataset_id, identity);
		await assert.rejects(s.fs.access(process.env.SATURDAY_DB_PATH), { code: 'ENOENT' });
	});
});

for (const order of ['database-first', 'files-first'])
	test(`independent ${order} recovery reserves newer same-dataset folders`, async () => {
		await isolatedStores(async (scratch) => {
			const dbBackups = await import('../src/lib/server/backups.js');
			const database = await import('../src/lib/server/database.js');
			jobs.createJob({ job_title: 'Snapshot', company_name: 'A' });
			const dbSnapshot = dbBackups.createBackup();
			const dbPath = dbBackups.getBackupFile(dbSnapshot.backup_id).path;
			const later = jobs.createJob({ job_title: 'Later', company_name: 'A' });
			const file = await d.createDocument({
				scope: later.id,
				filename: 'later.md',
				content: 'Owned by later job'
			});
			const fileSnapshot = await b.createFileBackup();
			const filePath = (await b.getFileBackup(fileSnapshot.backup_id)).path;
			process.env.SATURDAY_DB_PATH = join(scratch, 'clean.sqlite');
			process.env.SATURDAY_FILES_PATH = join(scratch, 'clean-files');
			jobs.createJob({ job_title: 'Disposable', company_name: 'B' });
			const dbImported = dbBackups.importBackup(dbPath);
			const fileImported = await b.importFileBackup(
				(await import('node:fs')).createReadStream(filePath)
			);
			const restoreDatabase = () =>
				dbBackups.restoreBackup(dbBackups.prepareRestore(dbImported.backup_id).restore_id, true);
			const restoreFiles = async () => {
				const preview = await b.prepareFileRestore({ backup_id: fileImported.backup_id });
				assert.equal(preview.incoming_dataset_id, dbSnapshot.dataset_id);
				assert.equal(preview.files_match_database, order === 'database-first');
				await b.restoreFiles({ restore_id: preview.restore_id, confirm: true });
			};
			if (order === 'database-first') {
				restoreDatabase();
				await restoreFiles();
			} else {
				await restoreFiles();
				await assert.rejects(d.listDocuments({ scope: 1 }), { code: 'DATASET_MISMATCH' });
				restoreDatabase();
			}
			assert.equal(database.databaseIdentity().dataset_id, dbSnapshot.dataset_id);
			assert.equal(jobs.getJob(later.id), null);
			const next = jobs.createJob({ job_title: 'New after recovery', company_name: 'A' });
			assert.equal(next.id, later.id + 1);
			assert.equal((await d.recoveryDocuments(later.id))[0].id, file.id);
			assert.equal((await d.listDocuments({ scope: next.id })).total, 0);
		});
	});

test('cross-dataset Add missing is blocked and database changes invalidate file restore previews', async () => {
	await isolatedStores(async (scratch) => {
		const database = await import('../src/lib/server/database.js');
		await d.createDocument({ filename: 'a.md', content: 'A' });
		const snapshot = await b.createFileBackup();
		const archive = (await b.getFileBackup(snapshot.backup_id)).path;
		process.env.SATURDAY_DB_PATH = join(scratch, 'b.sqlite');
		process.env.SATURDAY_FILES_PATH = join(scratch, 'b-files');
		await d.createDocument({ filename: 'b.md', content: 'B' });
		const imported = await b.importFileBackup((await import('node:fs')).createReadStream(archive));
		await assert.rejects(b.prepareFileRestore({ backup_id: imported.backup_id }), {
			code: 'DATASET_MISMATCH'
		});
		const preview = await b.prepareFileRestore({ backup_id: imported.backup_id, mode: 'replace' });
		assert.equal(preview.files_match_database, false);
		assert.match(preview.warning, /same dataset/);
		const original = await readFile(join(s.filePaths().root, 'manifest.json'));
		database.withDatabase((db) =>
			db.prepare('UPDATE app_metadata SET dataset_id=?').run(randomUUID())
		);
		await assert.rejects(b.restoreFiles({ restore_id: preview.restore_id, confirm: true }), {
			code: 'CONFLICT'
		});
		assert.deepEqual(await readFile(join(s.filePaths().root, 'manifest.json')), original);
	});
});

test('mutation boundaries reject a manifest replaced by another process, including an already-open file operation', async () => {
	await isolatedStores(async () => {
		await d.createDocument({ filename: 'safe.md', content: 'Safe' });
		const path = join(s.filePaths().root, 'manifest.json');
		const original = await readFile(path);
		const future = JSON.parse(original);
		future.format_version = 3;
		await assert.rejects(
			s.withFileLock(async (m) => {
				const script = `import {writeFileSync} from 'node:fs';writeFileSync(process.argv[1],process.argv[2]);`;
				await new Promise((resolve, reject) => {
					const child = spawn(
						process.execPath,
						['--input-type=module', '-e', script, path, JSON.stringify(future)],
						{ stdio: ['ignore', 'pipe', 'pipe'] }
					);
					child.on('error', reject);
					child.on('close', (code) => (code ? reject(new Error('Child failed')) : resolve()));
				});
				await s.createEntry(m, { name: 'blocked.md', bytes: Buffer.from('Blocked') });
			}),
			{ code: 'FORMAT' }
		);
		assert.throws(() => jobs.createJob({ job_title: 'Blocked', company_name: 'Example' }), {
			code: 'FORMAT'
		});
		await assert.rejects(s.fs.access(join(s.filePaths().root, 'documents/blocked.md')), {
			code: 'ENOENT'
		});
		await assert.rejects(s.fs.access(join(s.filePaths().state, 'journal.json')), {
			code: 'ENOENT'
		});
		await writeFile(path, original);
		assert.equal((await d.listDocuments()).total, 1);
	});
});

test('cross-dataset pair restore publishes one namespace and retains incoming empty-table counters', async () => {
	await isolatedStores(async (scratch) => {
		const database = await import('../src/lib/server/database.js');
		const original = jobs.createJob({ job_title: 'Original', company_name: 'A' });
		await d.createDocument({ scope: original.id, filename: 'resume.md', content: 'A' });
		database.withDatabase((db) =>
			db.exec(
				"UPDATE sqlite_sequence SET seq=40 WHERE name='jobs'; INSERT INTO sqlite_sequence(name,seq) VALUES('job_updates',30);"
			)
		);
		const pair = await pairs.createBackupPair();
		assert.equal(pair.format, 'saturday.backup-pair.numeric');
		const originalDbPath = process.env.SATURDAY_DB_PATH;
		process.env.SATURDAY_DB_PATH = join(scratch, 'other.sqlite');
		jobs.createJob({ job_title: 'Other', company_name: 'B' });
		database.withDatabase((db) => db.exec("UPDATE sqlite_sequence SET seq=100 WHERE name='jobs'"));
		await s.fs.copyFile(process.env.SATURDAY_DB_PATH, originalDbPath);
		process.env.SATURDAY_DB_PATH = originalDbPath;
		const preview = await pairs.prepareBackupPairRestore({ file_backup_id: pair.file_backup_id });
		await pairs.restoreBackupPair({ restore_id: preview.restore_id, confirm: true });
		assert.equal(database.databaseIdentity().dataset_id, pair.dataset_id);
		assert.equal((await d.listDocuments({ scope: 1 })).total, 1);
		const next = jobs.createJob({ job_title: 'Next', company_name: 'A' });
		assert.equal(next.id, 41);
		assert.equal(
			jobs.addJobUpdate({ job_id: next.id, event_date: '2026-10-08', note: 'Next' }).id,
			31
		);
	});
});

test('unsupported archives, pair formats and pending journals are rejected without publication', async () => {
	await isolatedStores(async (scratch) => {
		await d.createDocument({ filename: 'safe.md', content: 'Keep me' });
		const path = join(s.filePaths().root, 'manifest.json');
		const before = await readFile(path);
		const yazl = (await import('yazl')).default;
		const zip = new yazl.ZipFile();
		const legacy = join(scratch, 'legacy.zip');
		const { pipeline } = await import('node:stream/promises');
		const fs = await import('node:fs');
		const writing = pipeline(zip.outputStream, fs.createWriteStream(legacy));
		zip.addBuffer(
			Buffer.from(
				JSON.stringify({ format_version: 1, token: randomUUID(), documents: [], designations: {} })
			),
			'manifest.json'
		);
		zip.end();
		await writing;
		await assert.rejects(b.importFileBackup(fs.createReadStream(legacy)), { code: 'FORMAT' });
		assert.deepEqual(await readFile(path), before);
		const pair = await pairs.createBackupPair();
		const pairPath = join(s.filePaths().backups, `${pair.backup_set_id}.pair.json`);
		await writeFile(pairPath, JSON.stringify({ ...pair, format: 'future.format' }));
		await assert.rejects(pairs.prepareBackupPairRestore({ file_backup_id: pair.file_backup_id }), {
			code: 'FORMAT'
		});
		const manifest = JSON.parse(before);
		manifest.format_version = 3;
		await s.atomicJson(join(s.filePaths().state, 'journal.json'), {
			manifest,
			changes: [{ key: 'documents/safe.md', remove: true }]
		});
		await assert.rejects(d.listDocuments(), { code: 'FORMAT' });
		assert.equal(await readFile(join(s.filePaths().root, 'documents/safe.md'), 'utf8'), 'Keep me');
		assert.deepEqual(await readFile(path), before);
	});
});

test('interrupted cross-dataset pair publication recovers the original database and file namespaces', async () => {
	await isolatedStores(async (scratch) => {
		const database = await import('../src/lib/server/database.js');
		const dbBackups = await import('../src/lib/server/backups.js');
		jobs.createJob({ job_title: 'Incoming A', company_name: 'A' });
		await d.createDocument({ scope: 1, filename: 'a.md', content: 'A' });
		const incomingPair = await pairs.createBackupPair();
		const originalDbPath = process.env.SATURDAY_DB_PATH;
		const incomingRoot = process.env.SATURDAY_FILES_PATH;
		process.env.SATURDAY_DB_PATH = join(scratch, 'b.sqlite');
		process.env.SATURDAY_FILES_PATH = join(scratch, 'b-files');
		jobs.createJob({ job_title: 'Original B', company_name: 'B' });
		const originalFile = await d.createDocument({ scope: 1, filename: 'b.md', content: 'B' });
		const originalDataset = database.databaseIdentity().dataset_id;
		await s.fs.copyFile(process.env.SATURDAY_DB_PATH, originalDbPath);
		process.env.SATURDAY_DB_PATH = originalDbPath;
		// Keep the incoming pair artifacts, but install the original B collection as live files.
		await rm(incomingRoot, { recursive: true, force: true });
		await s.fs.cp(process.env.SATURDAY_FILES_PATH, incomingRoot, { recursive: true });
		process.env.SATURDAY_FILES_PATH = incomingRoot;
		const preview = await pairs.prepareBackupPairRestore({
			file_backup_id: incomingPair.file_backup_id
		});
		await assert.rejects(
			dbBackups.restoreDatabaseWithFiles(preview.database.restore_id, (recoveryDb) =>
				s.withFileLock(async (m) => {
					const recoveryFiles = await b.publishCapture(await b.captureFiles(m), 'recovery');
					await s.atomicJson(join(s.filePaths().state, 'pair-session.json'), {
						format: 'saturday.backup-pair.numeric',
						format_version: 1,
						recovery_database_id: recoveryDb.backup_id,
						recovery_files_id: recoveryFiles.backup_id,
						recovery_database_dataset_id: recoveryDb.dataset_id,
						recovery_files_dataset_id: recoveryFiles.dataset_id
					});
					const record = JSON.parse(
						await readFile(
							join(s.filePaths().state, `${preview.files.restore_id}.restore.json`),
							'utf8'
						)
					);
					await b.applyFileRestore(m, record);
					throw new Error('Interrupted after file publication');
				})
			),
			/Interrupted after file publication/
		);
		await assert.rejects(d.listDocuments(), { code: 'RECOVERY_REQUIRED' });
		await pairs.recoverBackupPair();
		assert.equal(database.databaseIdentity().dataset_id, originalDataset);
		assert.equal(jobs.getJob(1).title, 'Original B');
		assert.equal(
			(await d.getDocument({ id: originalFile.id, scope: 1, include_content: true })).content,
			'B'
		);
	});
});

test('one automatic schedule captures and retains complete sets; prepared file halves protect both artifacts', async () => {
	await isolatedStores(async () => {
		const backups = await import('../src/lib/server/backups.js');
		jobs.createJob({ job_title: 'Scheduled', company_name: 'Example' });
		await d.createDocument({ filename: 'cv.md', content: '# CV' });
		assert.equal(backups.getBackupSettings().contents, 'all');
		const manual = await pairs.createBackupPair();
		const fileOnly = await b.createFileBackup();
		const now = Date.now();
		backups.setBackupSettings(
			{ enabled: true, contents: 'all', interval_hours: 1, keep_count: 1 },
			{ now }
		);
		const first = await backups.runScheduledBackup({ now });
		assert.equal(first.ran, true);
		const original = first.backup;
		assert.ok(original.file_backup_id);
		await b.prepareFileRestore({ backup_id: original.file_backup_id, mode: 'replace' });
		assert.equal((await backups.runScheduledBackup({ now: now + 1 })).ran, false);
		// Re-enabling makes a catch-up run due while the preview is still valid.
		backups.setBackupSettings({ enabled: false }, { now: now + 2 });
		backups.setBackupSettings({ enabled: true }, { now: now + 2 });
		await backups.runScheduledBackup({ now: now + 2 });
		assert.equal(
			backups.listBackups({ limit: 50 }).backups.filter((x) => x.kind === 'scheduled').length,
			2
		);
		assert.ok(backups.getBackupFile(original.backup_id));
		assert.ok(await b.getFileBackup(original.file_backup_id));
		// Once the preview expires, retention removes both halves and the pair record.
		await backups.runScheduledBackup({ now: now + 3600002 });
		assert.equal(
			backups.listBackups({ limit: 50 }).backups.filter((x) => x.kind === 'scheduled').length,
			1
		);
		assert.throws(() => backups.getBackupFile(original.backup_id));
		await assert.rejects(b.getFileBackup(original.file_backup_id));
		await assert.rejects(
			readFile(join(s.filePaths().backups, `${original.backup_set_id}.pair.json`))
		);
		assert.ok(backups.getBackupFile(manual.database_backup_id));
		assert.ok(await b.getFileBackup(manual.file_backup_id));
		assert.ok(await b.getFileBackup(fileOnly.backup_id));
	});
});

test('a failed complete backup keeps prior sets and database-only mode skips file contents', async () => {
	await isolatedStores(async () => {
		const backups = await import('../src/lib/server/backups.js');
		jobs.createJob({ job_title: 'Retention', company_name: 'Example' });
		const file = await d.createDocument({ filename: 'cv.md', content: 'healthy' });
		const now = Date.now();
		backups.setBackupSettings(
			{ enabled: true, contents: 'all', interval_hours: 1, keep_count: 1 },
			{ now }
		);
		const first = await backups.runScheduledBackup({ now });
		await writeFile(join(s.filePaths().root, file.key), 'tampered');
		const failure = await backups.runScheduledBackup({ now: now + 3600000 });
		assert.equal(failure.ran, false);
		assert.ok(failure.error);
		assert.equal(backups.getBackupSettings().last_backup_id, first.backup.backup_id);
		assert.ok(backups.getBackupFile(first.backup.backup_id));
		assert.ok(await b.getFileBackup(first.backup.file_backup_id));
		backups.setBackupSettings({ contents: 'database' }, { now: now + 7200000 });
		const databaseOnly = await backups.runScheduledBackup({ now: now + 7200000 });
		assert.equal(databaseOnly.ran, true);
		assert.equal(databaseOnly.backup.file_backup_id, undefined);
		assert.throws(() => backups.setBackupSettings({ contents: 'files' }), {
			code: 'invalid_request'
		});
	});
});

test('failed atomic metadata publication cleans staging and allows retry', async () => {
	await isolatedStores(async (scratch) => {
		const fs = (await import('node:fs/promises')).default;
		const { syncBuiltinESMExports } = await import('node:module');
		const path = join(scratch, 'metadata.json');
		await s.atomicJson(path, { value: 'original' });
		const rename = fs.rename;
		try {
			fs.rename = async () => {
				throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
			};
			syncBuiltinESMExports();
			await assert.rejects(s.atomicJson(path, { value: 'replacement' }), { code: 'ENOSPC' });
		} finally {
			fs.rename = rename;
			syncBuiltinESMExports();
		}
		assert.equal(JSON.parse(await readFile(path, 'utf8')).value, 'original');
		assert.deepEqual(
			(await fs.readdir(scratch)).filter((name) => name.endsWith('.tmp')),
			[]
		);
		await s.atomicJson(path, { value: 'replacement' });
		assert.equal(JSON.parse(await readFile(path, 'utf8')).value, 'replacement');
	});
});

test('disk-full publication blocks inconsistent reads then replays after space returns', async () => {
	await isolatedStores(async () => {
		const file = await d.createDocument({ filename: 'retry.txt', content: 'original' });
		const put = s.LocalFileStore.prototype.put;
		try {
			s.LocalFileStore.prototype.put = async () => {
				throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
			};
			await assert.rejects(
				d.editDocument({ id: file.id, token: file.token, content: 'replacement' }),
				{ code: 'ENOSPC' }
			);
			await assert.rejects(d.getDocument({ id: file.id, include_content: true }), {
				code: 'ENOSPC'
			});
			assert.equal(await readFile(join(s.filePaths().root, file.key), 'utf8'), 'original');
			assert.ok(await s.fs.stat(join(s.filePaths().state, 'journal.json')));
		} finally {
			s.LocalFileStore.prototype.put = put;
		}
		const recovered = await d.getDocument({ id: file.id, include_content: true });
		assert.equal(recovered.content, 'replacement');
		assert.notEqual(recovered.token, file.token);
		await assert.rejects(s.fs.access(join(s.filePaths().state, 'journal.json')), {
			code: 'ENOENT'
		});
		await d.editDocument({ id: file.id, token: recovered.token, content: 'next edit' });
	});
});

test('interrupted byte stream never replaces the visible file or leaves a partial upload', async () => {
	await isolatedStores(async () => {
		await d.listDocuments();
		const store = new s.LocalFileStore(s.filePaths().root);
		const key = 'documents/stream.txt';
		await store.put(key, Readable.from(['original']));
		const stream = Readable.from(
			(async function* () {
				yield 'partial replacement';
				throw new Error('Upload disconnected');
			})()
		);
		await assert.rejects(store.put(key, stream), /Upload disconnected/);
		assert.equal(await readFile(join(s.filePaths().root, key), 'utf8'), 'original');
		assert.deepEqual(await s.fs.readdir(join(s.filePaths().root, 'documents')), ['stream.txt']);
	});
});

test('process death after byte publication recovers the pending manifest on restart', async () => {
	await isolatedStores(async () => {
		const file = await d.createDocument({ filename: 'restart.txt', content: 'original' });
		const script = `
			import * as store from './src/lib/server/files/store.js';
			import * as documents from './src/lib/server/files/documents.js';
			const put = store.LocalFileStore.prototype.put;
			store.LocalFileStore.prototype.put = async function (...args) {
				await put.apply(this, args);
				process.exit(17);
			};
			await documents.editDocument(${JSON.stringify({ id: file.id, token: file.token, content: 'published before interruption' })});
		`;
		const code = await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
				env: process.env,
				stdio: ['ignore', 'ignore', 'pipe']
			});
			let error = '';
			child.stderr.on('data', (data) => (error += data));
			child.on('error', reject);
			child.on('close', (code) => (code === 17 ? resolve(code) : reject(new Error(error))));
		});
		assert.equal(code, 17);
		assert.equal(
			await readFile(join(s.filePaths().root, file.key), 'utf8'),
			'published before interruption'
		);
		const recovered = await d.getDocument({ id: file.id, include_content: true });
		assert.equal(recovered.content, 'published before interruption');
		assert.notEqual(recovered.token, file.token);
		await assert.rejects(s.fs.access(join(s.filePaths().state, 'journal.json')), {
			code: 'ENOENT'
		});
	});
});

test('Profile assignments are atomic, format checked, protected on deletion and restored', async () => {
	await isolatedStores(async () => {
		let catalog = await d.listDocuments();
		const template = await d.createDocument({
			filename: 'letter.html',
			content: '<p>Dear team</p>',
			designation: 'cover_letter_template',
			catalog_token: catalog.catalog_token
		});
		assert.equal(
			(await d.getDocument({ designation: 'cover_letter_template', include_content: true }))
				.content,
			'<p>Dear team</p>'
		);
		const before = await d.listDocuments();
		await assert.rejects(
			d.createDocument({
				filename: 'wrong.md',
				content: 'Not HTML',
				designation: 'resume_template',
				catalog_token: before.catalog_token
			}),
			{ code: 'VALIDATION' }
		);
		await assert.rejects(
			d.uploadDocument({
				filename: 'invalid.html',
				stream: Readable.from([Buffer.from([255])]),
				designation: 'resume_template',
				catalog_token: before.catalog_token
			}),
			{ code: 'ENCODING' }
		);
		assert.equal((await d.listDocuments()).total, 1);
		await assert.rejects(
			d.createDocument({
				filename: 'stale.html',
				content: '',
				designation: 'resume_template',
				catalog_token: 'stale'
			}),
			{ code: 'CONFLICT' }
		);
		catalog = await d.listDocuments();
		await d.setMasterDocument({
			designation: 'resume_template',
			id: template.id,
			token: template.token,
			catalog_token: catalog.catalog_token
		});
		const renamed = await d.editDocument({
			id: template.id,
			token: template.token,
			filename: 'renamed.html'
		});
		assert.deepEqual(
			new Set(renamed.designations),
			new Set(['cover_letter_template', 'resume_template'])
		);
		await assert.rejects(
			d.editDocument({ id: renamed.id, token: renamed.token, filename: 'wrong.md' }),
			{ code: 'VALIDATION' }
		);
		const copy = await d.copyDocument({ id: renamed.id, token: renamed.token });
		assert.deepEqual(copy.designations, []);
		const saved = await b.createFileBackup();
		catalog = await d.listDocuments();
		await assert.rejects(
			d.deleteDocument({
				id: renamed.id,
				token: renamed.token,
				catalog_token: catalog.catalog_token,
				confirm: true,
				clear_master: true
			}),
			{ code: 'CONFIRMATION' }
		);
		await d.deleteDocument({
			id: renamed.id,
			token: renamed.token,
			catalog_token: catalog.catalog_token,
			confirm: true,
			clear_designations: true
		});
		assert.equal((await d.listDocuments()).designations.resume_template, undefined);
		const preview = await b.prepareFileRestore({ backup_id: saved.backup_id, mode: 'replace' });
		await b.restoreFiles({ restore_id: preview.restore_id, confirm: true });
		assert.equal((await d.getDocument({ designation: 'cover_letter_template' })).id, template.id);
	});
});

test('version-1 manifest upgrade preserves original metadata and selections', async () => {
	await isolatedStores(async () => {
		const cv = await d.createDocument({ filename: 'cv.md', content: '# Experience' });
		let catalog = await d.listDocuments();
		await d.setMasterDocument({ id: cv.id, token: cv.token, catalog_token: catalog.catalog_token });
		const path = join(s.filePaths().root, 'manifest.json');
		const original = JSON.parse(await readFile(path, 'utf8'));
		original.format_version = 1;
		original.custom = { preserved: true };
		await writeFile(path, JSON.stringify(original));
		catalog = await d.listDocuments();
		assert.equal(catalog.designations.master_cv, cv.id);
		const upgraded = JSON.parse(await readFile(path, 'utf8'));
		assert.equal(upgraded.format_version, 2);
		assert.deepEqual(upgraded.custom, original.custom);
		assert.deepEqual(
			JSON.parse(await readFile(join(s.filePaths().state, 'manifest-v1.json'), 'utf8')),
			original
		);
		assert.deepEqual(s.migrateManifest(original).documents, original.documents);
		const { default: yazl } = await import('yazl');
		const { pipeline } = await import('node:stream/promises');
		const { createWriteStream, createReadStream } = await import('node:fs');
		const archive = join(s.filePaths().state, 'v1.zip');
		const zip = new yazl.ZipFile();
		zip.addBuffer(Buffer.from(JSON.stringify(original)), 'manifest.json');
		zip.addFile(join(s.filePaths().root, cv.key), cv.key);
		const output = pipeline(zip.outputStream, createWriteStream(archive));
		zip.end();
		await output;
		const imported = await b.importFileBackup(createReadStream(archive));
		const preview = await b.prepareFileRestore({ backup_id: imported.backup_id, mode: 'replace' });
		await b.restoreFiles({ restore_id: preview.restore_id, confirm: true });
		assert.equal((await d.getDocument({ designation: 'master_cv' })).id, cv.id);

		assert.throws(
			() => s.validateManifest({ ...original, designations: { resume_template: cv.id } }),
			{ code: 'FORMAT' }
		);
	});
});
