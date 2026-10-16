import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { atomicJson } from '../src/lib/server/files/store.js';
import { installExtension, uninstallExtension } from '../scripts/extension-install.mjs';
import * as extensions from '../src/lib/server/extensions.js';
import { migrateDatabase, databaseIdentity } from '../src/lib/server/database.js';
import { createJob, getJob } from '../src/lib/server/services.js';
const sample = resolve('examples/extensions/interview-practice');
test('portable extension lifecycle, shared services, retained data and guarded recovery', async () => {
	const scratch = await fs.mkdtemp(join(tmpdir(), 'saturday-extension-'));
	const previous = { ...process.env };
	process.env.SATURDAY_EXTENSION_STATE_PATH = join(scratch, 'state');
	process.env.SATURDAY_EXTENSIONS_PATH = join(scratch, 'code');
	process.env.SATURDAY_DB_PATH = join(scratch, 'core.sqlite');
	const app = join(scratch, 'app');
	await fs.mkdir(app);
	await fs.symlink(resolve('node_modules'), join(app, 'node_modules'), 'dir');
	await fs.mkdir(join(app, 'build'));
	await fs.writeFile(join(app, 'build', 'old'), 'working');
	const build = async (root) => {
		await fs.mkdir(join(root, 'build'));
		await fs.writeFile(join(root, 'build', 'candidate'), 'compiled');
	};
	const options = { trust: true, build, applicationRoot: app };
	try {
		migrateDatabase();
		const job = createJob({ job_title: 'Core unchanged', company_name: 'Example' }),
			dataset = databaseIdentity().dataset_id;
		await assert.rejects(installExtension(sample, { ...options, trust: false }), { code: 'TRUST' });
		const entry = await installExtension(sample, options),
			registry = {
				[entry.id]: {
					...entry,
					server: () => import(pathToFileURL(join(sample, 'server.js')).href)
				}
			};
		const call = (name, input = {}) => extensions.runExtensionTool(entry.id, name, input, registry);
		assert.equal((await extensions.extensionCatalog()).extensions_enabled, false);
		assert.equal(entry.enabled, true);
		await assert.rejects(call('list_questions'), { code: 'DISABLED' });
		await extensions.setExtensionsEnabled(true);
		const q = await call('create_question', { question: 'Why 100%_ here?', answer: 'An answer' });
		assert.equal(q.id, 1);
		assert.equal((await call('list_questions', { query: '%_' })).total, 1);
		const edited = await call('edit_question', {
			id: q.id,
			revision: q.revision,
			data_token: q.data_token,
			answer: 'Better answer'
		});
		assert.equal(edited.question, q.question);
		await assert.rejects(
			call('edit_question', { id: q.id, revision: 1, data_token: q.data_token, answer: 'stale' }),
			{
				code: 'CONFLICT'
			}
		);
		await assert.rejects(call('create_question', { question: ' ' }));
		assert.equal((await call('list_questions')).total, 1);
		for (let i = 0; i < 103; i++) await call('create_question', { question: `Question ${i}` });
		const first = await call('list_questions'),
			second = await call('list_questions', { page: 2 }),
			third = await call('list_questions', { page: 3 });
		assert.equal(first.total, 104);
		assert.equal(
			new Set([...first.questions, ...second.questions, ...third.questions].map((q) => q.id)).size,
			104
		);
		const saved = await extensions.createExtensionBackup(entry.id);
		assert.equal(saved.fingerprint, entry.fingerprint);
		assert.equal(saved.schema_version, 1);
		const downloaded = await extensions.getExtensionBackup(saved.backup_id),
			imported = await extensions.importExtensionBackup(createReadStream(downloaded.path));

		const { default: yazl } = await import('yazl');
		const { createWriteStream } = await import('node:fs');
		const { pipeline } = await import('node:stream/promises');
		const { createHash } = await import('node:crypto');
		const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
		async function archive(name, manifest, extra = false) {
			const path = join(scratch, name),
				dbBytes = await fs.readFile(join(scratch, 'incoming.sqlite'));
			const zip = new yazl.ZipFile();
			zip.addBuffer(
				Buffer.from(JSON.stringify({ ...manifest, database_sha256: hash(dbBytes) })),
				'manifest.json'
			);
			zip.addBuffer(dbBytes, 'database.sqlite');
			if (extra) zip.addBuffer(Buffer.from('bad'), 'unexpected.txt');
			const written = pipeline(zip.outputStream, createWriteStream(path));
			zip.end();
			await written;
			return path;
		}
		await fs.copyFile(extensions.dataPath(entry.id), join(scratch, 'incoming.sqlite'));
		await assert.rejects(
			extensions.importExtensionBackup(createReadStream(await archive('extra.zip', saved, true))),
			{ code: 'FORMAT' }
		);
		const altered = new DatabaseSync(join(scratch, 'incoming.sqlite'));
		altered.exec('CREATE TABLE unexpected(id INTEGER)');
		altered.close();
		const alteredBackup = await extensions.importExtensionBackup(
			createReadStream(await archive('altered.zip', saved))
		);
		await assert.rejects(
			extensions.prepareExtensionRestore(entry.id, alteredBackup.backup_id, registry),
			{ code: 'SCHEMA' }
		);
		const clean = new DatabaseSync(join(scratch, 'incoming.sqlite'));
		clean.exec('DROP TABLE unexpected');
		clean.close();
		const incoming = new DatabaseSync(join(scratch, 'incoming.sqlite'));
		incoming.prepare('UPDATE extension_metadata SET extension_id=?').run('foreign');
		incoming.close();
		const foreign = await extensions.importExtensionBackup(
			createReadStream(await archive('foreign.zip', { ...saved, extension_id: 'foreign' }))
		);
		await assert.rejects(
			extensions.prepareExtensionRestore(entry.id, foreign.backup_id, registry),
			{ code: 'SCHEMA' }
		);
		const newer = new DatabaseSync(join(scratch, 'incoming.sqlite'));
		newer.exec("UPDATE extension_metadata SET extension_id='interview-practice',schema_version=2");
		newer.close();
		const future = await extensions.importExtensionBackup(
			createReadStream(await archive('newer.zip', { ...saved, schema_version: 2 }))
		);
		await assert.rejects(extensions.prepareExtensionRestore(entry.id, future.backup_id, registry), {
			code: 'SCHEMA'
		});
		const intact = await fs.readFile(downloaded.path);
		await fs.writeFile(downloaded.path, Buffer.from('corrupt'));
		await assert.rejects(extensions.getExtensionBackup(saved.backup_id), { code: 'INTEGRITY' });
		await fs.writeFile(downloaded.path, intact);
		await extensions.setExtensionState(entry.id, false);
		await assert.rejects(call('list_questions'), { code: 'DISABLED' });
		const preview = await extensions.prepareExtensionRestore(
			entry.id,
			imported.backup_id,
			registry
		);
		await assert.rejects(
			extensions.restoreExtension({ restore_id: preview.restore_id, confirm: false }, registry),
			{ code: 'CONFIRMATION' }
		);
		await extensions.restoreExtension({ restore_id: preview.restore_id, confirm: true }, registry);
		await extensions.setExtensionState(entry.id, true);
		await extensions.runExtension(entry.id, registry, (_mod, ctx) =>
			ctx.database((db) => {
				db.prepare('UPDATE sqlite_sequence SET seq=900 WHERE name=?').run('questions');
				return 900;
			})
		);
		// Re-prepare after changing allocation state, then restore the older snapshot.
		const allocationFresh = await extensions.prepareExtensionRestore(
			entry.id,
			saved.backup_id,
			registry
		);
		await extensions.restoreExtension(
			{ restore_id: allocationFresh.restore_id, confirm: true },
			registry
		);

		await extensions.setExtensionState(entry.id, true);
		await assert.rejects(
			call('edit_question', {
				id: q.id,
				revision: edited.revision,
				data_token: edited.data_token,
				answer: 'Pre-restore stale editor'
			}),
			{ code: 'CONFLICT' }
		);
		const stale = await extensions.prepareExtensionRestore(entry.id, saved.backup_id, registry);
		const later = await call('create_question', { question: 'new' });
		assert.equal(later.id, 901);
		await assert.rejects(
			extensions.restoreExtension({ restore_id: stale.restore_id, confirm: true }, registry),
			{ code: 'CONFLICT' }
		);
		await assert.rejects(
			installExtension(sample, {
				...options,
				update: true,
				build: async () => {
					throw Error('compile failure');
				}
			}),
			/compile failure/
		);
		assert.equal((await call('list_questions')).total, 105);
		assert.equal(await fs.readFile(join(app, 'build', 'candidate'), 'utf8'), 'compiled');

		// Permission failure during publication retains a durable rollback journal.
		try {
			await assert.rejects(
				installExtension(sample, {
					...options,
					update: true,
					build: async (root) => {
						await build(root);
						await fs.chmod(app, 0o555);
					}
				})
			);
		} finally {
			await fs.chmod(app, 0o755);
		}
		assert.ok(await extensions.pendingExtensionRecovery());
		await extensions.recoverExtensions();
		assert.equal((await call('list_questions')).total, 105);
		assert.equal(await fs.readFile(join(app, 'build', 'candidate'), 'utf8'), 'compiled');
		// Failed candidate migration leaves original code/build/database unchanged.
		const modified = join(scratch, 'modified');
		await fs.cp(sample, modified, { recursive: true });
		await fs.appendFile(
			join(modified, 'server.js'),
			"\nmigrations.push({name:'failing',up(db){db.exec('CREATE TABLE should_rollback(id INTEGER)');throw new Error('migration failed');}});\n"
		);
		await assert.rejects(
			installExtension(modified, { ...options, update: true }),
			/migration failed/
		);
		assert.equal((await call('list_questions')).total, 105);
		// Simulate interruption after publication; runtime gates and offline recovery restores retained data.
		const dbPath = extensions.dataPath(entry.id),
			previousDB = join(scratch, 'prior.sqlite');
		await fs.copyFile(dbPath, previousDB);
		await atomicJson(join(process.env.SATURDAY_EXTENSION_STATE_PATH, 'recovery.json'), {
			version: 1,
			replacements: [{ target: dbPath, previous: previousDB }]
		});
		await assert.rejects(call('list_questions'), { code: 'RECOVERY_REQUIRED' });
		await extensions.recoverExtensions();
		assert.equal((await call('list_questions')).total, 105);
		await extensions.runExtension(entry.id, registry, async (_mod, ctx) => {
			const ref = ctx.core.jobs.reference(job);
			assert.equal(ref.dataset_id, dataset);
			assert.equal(ctx.core.jobs.resolve(ref).id, job.id);
			assert.equal(ctx.core.jobs.resolve({ ...ref, dataset_id: 'foreign' }), null);
		});
		await uninstallExtension(entry.id);
		assert.equal((await extensions.extensionCatalog()).installed.length, 0);
		await extensions.createExtensionBackup(entry.id);
		const reinstalled = await installExtension(sample, options);
		registry[entry.id] = { ...registry[entry.id], fingerprint: reinstalled.fingerprint };
		assert.equal((await call('list_questions')).total, 105);
		await extensions.setExtensionsEnabled(false);
		await assert.rejects(call('list_questions'), { code: 'DISABLED' });
		assert.equal((await extensions.extensionCatalog()).installed[0].enabled, true);
		assert.equal(getJob(job.id).title, 'Core unchanged');
		assert.equal(databaseIdentity().dataset_id, dataset);
	} finally {
		for (const key of [
			'SATURDAY_EXTENSION_STATE_PATH',
			'SATURDAY_EXTENSIONS_PATH',
			'SATURDAY_DB_PATH'
		]) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
		await fs.rm(scratch, { recursive: true, force: true });
	}
});
test('manifest rejects unsupported APIs, private imports and symlinks', async () => {
	const info = await extensions.inspectExtension(sample);
	assert.throws(() => extensions.validateExtensionManifest({ ...info.manifest, apiVersion: 2 }));
	assert.throws(() =>
		extensions.validateExtensionManifest({ ...info.manifest, page: '../page.svelte' })
	);
	assert.throws(() => extensions.extensionId('../outside'));
	assert.throws(
		() =>
			extensions.validateExtensionNamespaces([
				{ id: 'a', manifest: { mcp: ['b_c'] } },
				{ id: 'a-b', manifest: { mcp: ['c'] } }
			]),
		{ code: 'CONFLICT' }
	);
	const scratch = await fs.mkdtemp(join(tmpdir(), 'saturday-extension-format-'));
	try {
		await fs.cp(sample, scratch, { recursive: true });
		await fs.appendFile(
			join(scratch, 'server.js'),
			"\nimport secret from '$lib/server/database.js';\n"
		);
		await assert.rejects(extensions.inspectExtension(scratch), { code: 'VALIDATION' });
		await fs.rm(join(scratch, 'server.js'));
		await fs.symlink('/etc/passwd', join(scratch, 'server.js'));
		await assert.rejects(extensions.inspectExtension(scratch), { code: 'VALIDATION' });
	} finally {
		await fs.rm(scratch, { recursive: true, force: true });
	}
});

test('Git sources pin commits and retain copied snapshots through source changes', async () => {
	const { execFileSync } = await import('node:child_process');
	const scratch = await fs.mkdtemp(join(tmpdir(), 'saturday-extension-git-')),
		prior = { ...process.env };
	process.env.SATURDAY_DB_PATH = join(scratch, 'core.sqlite');
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	process.env.SATURDAY_INSTALLATION_PATH = '';
	process.env.SATURDAY_EXTENSION_STATE_PATH = join(scratch, 'state');
	process.env.SATURDAY_EXTENSIONS_PATH = join(scratch, 'code');
	const source = join(scratch, 'repo'),
		app = join(scratch, 'app');
	await fs.cp(sample, source, { recursive: true });
	await fs.mkdir(app);
	await fs.symlink(resolve('node_modules'), join(app, 'node_modules'));
	const git = (...args) =>
		execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
	try {
		git('init', '-q');
		git('add', '.');
		git(
			'-c',
			'user.name=Extension Test',
			'-c',
			'user.email=test@example.invalid',
			'commit',
			'-qm',
			'sample'
		);
		const commit = git('rev-parse', 'HEAD');
		const entry = await installExtension(pathToFileURL(source).href, {
			trust: true,
			ref: commit,
			applicationRoot: app,
			build: async (root) => {
				await fs.mkdir(join(root, 'build'));
			}
		});
		assert.equal(entry.source.commit, commit);
		await fs.appendFile(join(source, 'README.md'), '\nUninstalled change');
		assert.equal(
			(await extensions.inspectExtension(join(process.env.SATURDAY_EXTENSIONS_PATH, entry.id)))
				.fingerprint,
			entry.fingerprint
		);
	} finally {
		for (const k of ['SATURDAY_EXTENSION_STATE_PATH', 'SATURDAY_EXTENSIONS_PATH']) {
			if (prior[k] === undefined) delete process.env[k];
			else process.env[k] = prior[k];
		}
		await fs.rm(scratch, { recursive: true, force: true });
	}
});

test('built MCP discovers multiple namespaced tools, shares data and rejects disabled calls', async () => {
	const { spawn } = await import('node:child_process');
	const { createInterface } = await import('node:readline');
	const scratch = await fs.mkdtemp(join(tmpdir(), 'saturday-extension-mcp-')),
		prior = { ...process.env };
	process.env.SATURDAY_EXTENSION_STATE_PATH = join(scratch, 'state');
	process.env.SATURDAY_DB_PATH = join(scratch, 'core.sqlite');
	process.env.SATURDAY_EXTENSIONS_PATH = join(scratch, 'code');
	await fs.cp(sample, join(process.env.SATURDAY_EXTENSIONS_PATH, 'interview-practice'), {
		recursive: true
	});
	const info = await extensions.inspectExtension(sample),
		entry = {
			id: info.manifest.id,
			manifest: info.manifest,
			fingerprint: info.fingerprint,
			enabled: true,
			source: { type: 'local', reference: sample }
		};
	await fs.mkdir(process.env.SATURDAY_EXTENSION_STATE_PATH);
	await atomicJson(extensions.extensionPaths().catalog, {
		version: 1,
		extensions_enabled: true,
		installed: [entry]
	});
	await extensions.initializeExtension(entry, {
		server: () => import(pathToFileURL(join(sample, 'server.js')).href)
	});
	migrateDatabase();
	const child = spawn(process.execPath, ['build/mcp/index.js'], {
			env: process.env,
			stdio: ['pipe', 'pipe', 'pipe']
		}),
		pending = new Map();
	let next = 1,
		stderr = '';
	child.stderr.on('data', (c) => (stderr += c));
	const lines = createInterface({ input: child.stdout });
	lines.on('line', (line) => {
		const m = JSON.parse(line),
			p = pending.get(m.id);
		if (p) {
			clearTimeout(p.timer);
			pending.delete(m.id);
			m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
		}
	});
	const request = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = next++,
				timer = setTimeout(() => {
					pending.delete(id);
					reject(Error(`MCP timeout: ${stderr}`));
				}, 5000);
			pending.set(id, { resolve, reject, timer });
			child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
		});
	try {
		await request('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'extension-test', version: '1' }
		});
		child.stdin.write(
			JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
		);
		const listing = await request('tools/list');
		assert.equal(
			listing.tools.filter((t) => t.name.startsWith('extension_interview_practice_')).length,
			5
		);
		assert.ok(listing.tools.some((t) => t.name === 'get_job'));
		const created = await request('tools/call', {
			name: 'extension_interview_practice_create_question',
			arguments: { question: 'MCP question', answer: 'Saved' }
		});
		assert.equal(created.isError, undefined);
		const question = JSON.parse(created.content[0].text);
		assert.equal(question.id, 1);
		await assert.rejects(extensions.assertExtensionProcessesStopped(), { code: 'RUNNING' });
		await extensions.setExtensionsEnabled(false);
		const blocked = await request('tools/call', {
			name: 'extension_interview_practice_list_questions',
			arguments: {}
		});
		assert.equal(blocked.isError, true);
		await new Promise((r) => setTimeout(r, 1200));
		const disabled = await request('tools/list');
		assert.equal(disabled.tools.filter((t) => t.name.startsWith('extension_')).length, 0);
		assert.ok(disabled.tools.some((t) => t.name === 'get_job'));
		await extensions.setExtensionsEnabled(true);
		await new Promise((r) => setTimeout(r, 1200));
		const restored = await request('tools/call', {
			name: 'extension_interview_practice_list_questions',
			arguments: {}
		});
		assert.equal(JSON.parse(restored.content[0].text).total, 1);
	} finally {
		child.kill('SIGTERM');
		await new Promise((r) => child.once('exit', r));
		lines.close();
		for (const k of [
			'SATURDAY_EXTENSION_STATE_PATH',
			'SATURDAY_EXTENSIONS_PATH',
			'SATURDAY_DB_PATH'
		]) {
			if (prior[k] === undefined) delete process.env[k];
			else process.env[k] = prior[k];
		}
		await fs.rm(scratch, { recursive: true, force: true });
	}
});

test('real candidate build produces web and MCP artifacts without changing the running checkout', async () => {
	const scratch = await fs.mkdtemp(join(tmpdir(), 'saturday-extension-build-')),
		prior = { ...process.env },
		checkout = resolve('.'),
		app = join(scratch, 'app');
	process.env.SATURDAY_DB_PATH = join(scratch, 'core.sqlite');
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	process.env.SATURDAY_INSTALLATION_PATH = '';
	process.env.SATURDAY_EXTENSION_STATE_PATH = join(scratch, 'state');
	process.env.SATURDAY_EXTENSIONS_PATH = join(app, 'extensions');
	try {
		await fs.cp(checkout, app, {
			recursive: true,
			filter: (path) =>
				!['node_modules', '.git', 'data', 'build', '.svelte-kit', 'extensions'].includes(
					path.slice(checkout.length + 1).split('/')[0]
				)
		});
		await fs.symlink(join(checkout, 'node_modules'), join(app, 'node_modules'), 'dir');
		const entry = await installExtension(sample, { trust: true, applicationRoot: app });
		assert.equal(entry.id, 'interview-practice');
		await fs.access(join(app, 'build', 'index.js'));
		await fs.access(join(app, 'build', 'mcp', 'index.js'));
		const { execFileSync } = await import('node:child_process');
		const cli = (...args) =>
			JSON.parse(
				execFileSync(process.execPath, [join(app, 'scripts', 'extensions.mjs'), ...args], {
					env: process.env,
					encoding: 'utf8'
				})
			);
		const snapshot = cli('backup', entry.id);
		const preview = cli('preview', entry.id, snapshot.backup_id);
		assert.equal(preview.extension_id, entry.id);
		assert.equal(cli('restore', preview.restore_id, '--confirm').restored, true);

		assert.equal((await extensions.extensionCatalog()).extensions_enabled, false);
	} finally {
		for (const k of ['SATURDAY_EXTENSION_STATE_PATH', 'SATURDAY_EXTENSIONS_PATH']) {
			if (prior[k] === undefined) delete process.env[k];
			else process.env[k] = prior[k];
		}
		await fs.rm(scratch, { recursive: true, force: true });
	}
});
