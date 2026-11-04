import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';

test('file writes and coordinated recovery flush writable handles as required by Windows', async (t) => {
	const root = await fsp.mkdtemp(join(tmpdir(), 'saturday-win-file-sync-'));
	const previous = { ...process.env };
	for (const key of Object.keys(process.env))
		if (key.startsWith('SATURDAY_')) delete process.env[key];
	Object.assign(process.env, {
		SATURDAY_DB_PATH: join(root, 'database.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'extension-code')
	});
	t.after(async () => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
		for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
		Object.assign(process.env, previous);
		await fsp.rm(root, { recursive: true, force: true });
	});
	const writable = (flags = 'r') =>
		typeof flags === 'string'
			? /[wa+]/.test(flags)
			: Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR));
	const denied = () =>
		Object.assign(new Error('EPERM: operation not permitted, fsync'), {
			code: 'EPERM',
			syscall: 'fsync'
		});
	const open = fsp.open.bind(fsp),
		openSync = fs.openSync.bind(fs),
		closeSync = fs.closeSync.bind(fs),
		fsyncSync = fs.fsyncSync.bind(fs),
		handles = new Map();
	let asyncFlushes = 0,
		syncFlushes = 0,
		failNextFlush = false;
	t.mock.method(fsp, 'open', async (path, flags, ...args) => {
		const handle = await open(path, flags, ...args),
			sync = handle.sync.bind(handle);
		handle.sync = async () => {
			if ((await handle.stat()).isFile()) {
				if (!writable(flags)) throw denied();
				asyncFlushes++;
				if (failNextFlush) {
					failNextFlush = false;
					throw denied();
				}
			}
			return sync();
		};
		return handle;
	});
	t.mock.method(fs, 'openSync', (path, flags, ...args) => {
		const fd = openSync(path, flags, ...args);
		handles.set(fd, flags);
		return fd;
	});
	t.mock.method(fs, 'closeSync', (fd) => {
		handles.delete(fd);
		return closeSync(fd);
	});
	t.mock.method(fs, 'fsyncSync', (fd) => {
		if (fs.fstatSync(fd).isFile()) {
			if (!writable(handles.get(fd))) throw denied();
			syncFlushes++;
		}
		return fsyncSync(fd);
	});
	syncBuiltinESMExports();
	// Confirm the model rejects the read-only handles accepted by POSIX systems.
	const probe = join(root, 'probe.txt');
	await fsp.writeFile(probe, 'probe');
	const readonly = await fsp.open(probe, 'r');
	await assert.rejects(readonly.sync(), { code: 'EPERM' });
	await readonly.close();
	const fd = fs.openSync(probe, 'r');
	assert.throws(() => fs.fsyncSync(fd), { code: 'EPERM' });
	fs.closeSync(fd);
	const documents = await import('../src/lib/server/files/documents.js'),
		store = await import('../src/lib/server/files/store.js'),
		pairs = await import('../src/lib/server/files/pairs.js'),
		jobs = await import('../src/lib/server/local/jobs.js'),
		extensions = await import('../src/lib/server/extensions.js');
	const job = jobs.createJob({ job_title: 'Fictional job', company_name: 'Example' });
	const document = await documents.createDocument({ filename: 'sample.md', content: '# Sample' });
	await documents.uploadDocument({
		filename: 'uploaded.txt',
		stream: Readable.from(['Uploaded text'])
	});
	await documents.createDocument({ scope: job.id, filename: 'job.md', content: 'Job attachment' });
	const pair = await pairs.createBackupPair();
	const bundle = join(root, 'combined.zip');
	await pairs.exportManualBackup({ backup_id: pair.database_backup_id, contents: 'all' }, bundle);
	const extra = jobs.createJob({ job_title: 'Disposable', company_name: 'Example' });
	await documents.editDocument({ id: document.id, token: document.token, content: 'Changed' });
	const imported = await pairs.importBackupBundle(fs.createReadStream(bundle));
	const preview = await pairs.prepareBackupPairRestore({ file_backup_id: imported.file_backup_id });
	await pairs.restoreBackupPair({ restore_id: preview.restore_id, confirm: true });
	assert.equal(jobs.getJob(extra.id), null);
	assert.equal(
		(await documents.getDocument({ id: document.id, include_content: true })).content,
		'# Sample'
	);
	const extensionDir = join(root, 'extension-snapshot');
	await fsp.mkdir(extensionDir);
	await fsp.writeFile(join(extensionDir, 'snapshot.txt'), 'Extension recovery');
	await extensions.syncExtensionPath(extensionDir);
	const rawStore = new store.LocalFileStore(join(root, 'raw-store'));
	await rawStore.put('documents/direct.txt', Readable.from(['Direct write']));
	assert.ok(asyncFlushes > 0);
	assert.ok(syncFlushes > 0);
	// Real sync errors must still abort writes; do not suppress EPERM on files.
	failNextFlush = true;
	await assert.rejects(rawStore.put('documents/failed.txt', Readable.from(['Must not publish'])), {
		code: 'EPERM'
	});
	assert.equal(await rawStore.head('documents/failed.txt'), null);
});
