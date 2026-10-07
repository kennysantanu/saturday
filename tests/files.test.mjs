import test from 'node:test';
import assert from 'node:assert/strict';
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
});

test('manifest validation preserves extensions and refuses unknown versions', async () => {
	const m = JSON.parse(await readFile(join(s.filePaths().root, 'manifest.json'), 'utf8'));
	m.custom = { future_note: 'preserve' };
	const converted = s.migrateManifest(m);
	assert.deepEqual(converted.custom, m.custom);
	assert.notEqual(converted, m);
	assert.throws(() => s.migrateManifest({ ...m, format_version: 2 }), { code: 'FORMAT' });
	const stable = await readFile(join(s.filePaths().root, 'manifest.json'), 'utf8');
	await writeFile(
		join(s.filePaths().root, 'manifest.json'),
		JSON.stringify({ ...m, format_version: 2 })
	);
	await assert.rejects(d.listDocuments(), { code: 'FORMAT' });
	assert.ok(jobs.getJob(job.id), 'Core jobs remain usable');
	await writeFile(join(s.filePaths().root, 'manifest.json'), stable);
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
