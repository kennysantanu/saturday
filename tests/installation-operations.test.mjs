import { createServer } from 'node:net';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import {
	compareVersions,
	selectTarget,
	validateRelease,
	ownedRemovalTargets,
	assertSafeRemoval,
	queueOperation,
	operationStatus,
	operationPaths,
	executeOperation,
	codeFingerprint,
	prepareRuntime
} from '../src/lib/server/installation-operations.js';
import { copySource, install, run as installerRun } from '../scripts/install.mjs';
import { getInstallation, createDesktopShortcut } from '../src/lib/server/installation.js';
import { readBuildInfo } from '../scripts/build-info.mjs';
import { serverSummary } from '../src/lib/server/server-lifecycle.js';
const run = promisify(execFile);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const sha = 'a'.repeat(40),
	other = 'b'.repeat(40);
test('update selection distinguishes main, stable transition, version order and failed release discovery', async () => {
	assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
	const main = await selectTarget({ build: { commit: other } }, async (path) =>
		path.startsWith('/releases') ? [] : { sha }
	);
	assert.equal(main.commit, sha);
	assert.equal(main.available, true);
	const stableNoUpdate = await selectTarget({ release: '0.1.0' }, async (path) => {
		assert.ok(path.startsWith('/releases'));
		return [];
	});
	assert.equal(stableNoUpdate.available, false);
	await assert.rejects(
		selectTarget({}, async () => {
			throw Error('rate limited');
		}),
		/rate limited/
	);
	const metadata = {
		format: 'saturday.release',
		version: 1,
		release: '0.10.0',
		commit: sha,
		source: { type: 'github-source' },
		...pkg.saturday
	};
	const bytes = Buffer.from(JSON.stringify(metadata)),
		digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
	const releases = [
		{
			tag_name: 'v0.9.0',
			id: 9,
			assets: [{ name: 'saturday-release.json', state: 'uploaded', digest, id: 90 }]
		},
		{
			tag_name: 'v0.10.0',
			id: 10,
			assets: [{ name: 'saturday-release.json', state: 'uploaded', digest, id: 100 }]
		},
		{ tag_name: 'v9.0.0', draft: true, assets: [] }
	];
	const selected = await selectTarget(
		{ build: { commit: other } },
		async (path) => (path.startsWith('/releases') ? releases : { sha }),
		async () => new Response(bytes)
	);
	assert.equal(selected.release, '0.10.0');
	assert.equal(selected.commit, sha);
	assert.equal(selected.available, true);
	await assert.rejects(
		selectTarget(
			{},
			async (path) => (path.startsWith('/releases') ? releases : { sha }),
			async () => new Response('tampered')
		),
		/integrity/
	);
	assert.throws(() => validateRelease({ ...metadata, commit: 'bad' }, releases[1]), /metadata/);
});

test('removal targets retain data by default and refuse uncertain custom ownership or linked roots', async () => {
	const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'saturday-removal-')));
	const config = {
		mode: 'managed',
		descriptor_path: join(root, 'installation.json'),
		code_owned: true,
		runtime_owned: false,
		code_root: join(root, 'app'),
		data_root: join(root, 'data'),
		database: join(root, 'data', 'saturday.db'),
		files: join(root, 'data', 'files'),
		files_state: join(root, 'data', 'files.state'),
		database_backups: join(root, 'data', 'backups/database'),
		database_restore: join(root, 'data', 'saturday.db.restore'),
		file_backups: join(root, 'data', 'backups/files'),
		extension_state: join(root, 'data', 'extensions'),
		extension_code: join(root, 'extensions'),
		extension_backups: join(root, 'data', 'extensions.backups'),
		logs: join(root, 'logs')
	};
	try {
		assert.deepEqual(ownedRemovalTargets(config), [config.code_root]);
		assert.ok(ownedRemovalTargets(config, true).includes(config.data_root));
		assert.throws(
			() => ownedRemovalTargets({ ...config, database: '/unrelated/user.db' }, true),
			/External/
		);
		assert.throws(() => ownedRemovalTargets({ ...config, mode: 'source' }, true), /uncertain/);
		await fs.mkdir(join(root, 'outside'));
		await fs.writeFile(join(root, 'outside', 'keep'), 'keep');
		await fs.symlink(join(root, 'outside'), join(root, 'linked'), 'dir');
		await assert.rejects(assertSafeRemoval([join(root, 'linked')]), /linked|symlink/);
		await fs.mkdir(config.code_root);
		await fs.symlink(join(root, 'outside'), join(config.code_root, 'linked-child'), 'dir');
		await assertSafeRemoval([config.code_root]);
		await fs.rm(config.code_root, { recursive: true });
		assert.equal(await fs.readFile(join(root, 'outside', 'keep'), 'utf8'), 'keep');
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() {
	const server = createServer();
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const port = server.address().port;
	await new Promise((r) => server.close(r));
	return port;
}

test('fresh managed installation uses its descriptor for runtime preparation and starts the UI', async () => {
	const temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'saturday-fresh-install-')));
	const root = join(temporary, 'Saturday ü');
	const source = join(temporary, 'source');
	const desktop = join(temporary, 'desktop');
	const descriptor = join(root, 'installation.json');
	const prior = { ...process.env };
	let runtimePrepared = false;
	let setups = 0;
	try {
		process.env.PORT = String(await freePort());
		await copySource(resolve('.'), source);
		await fs.mkdir(root);
		await fs.mkdir(desktop);
		assert.deepEqual(await fs.readdir(root), []);
		assert.equal(existsSync(join(source, 'data', 'installation.json')), false);
		const receipt = await install(
			{ root, source, desktop, 'skip-pdf': true, 'no-open': true },
			{
				prepareRuntime: async (config, metadata) => {
					assert.equal(config.descriptor_path, descriptor);
					runtimePrepared = true;
					return prepareRuntime(config, metadata);
				},
				run: async (command, args, options) => {
					setups++;
					if (args.includes('--managed')) {
						// Reuse local dependencies; keep the real build, setup and publication steps.
						await fs.symlink(resolve('node_modules'), join(options.cwd, 'node_modules'), 'dir');
						args = [...args, '--skip-dependencies'];
					}
					await installerRun(command, args, options);
				}
			}
		);
		assert.equal(runtimePrepared, true);
		assert.equal(setups, 2);
		assert.equal(receipt.ok, true);
		assert.equal(receipt.descriptor_path, descriptor);
		assert.equal(receipt.data_path, join(root, 'data'));
		const config = JSON.parse(await fs.readFile(descriptor, 'utf8'));
		assert.equal(config.installation_id, receipt.installation_id);
		assert.equal(config.code_root, join(root, 'app'));
		assert.equal(config.pdf_cache, join(root, 'runtime', 'chrome'));
		assert.ok(existsSync(config.database));
		assert.ok(existsSync(join(config.files, 'manifest.json')));
		assert.ok(receipt.shortcut && existsSync(receipt.shortcut));
		const health = await fetch(new URL('/health', receipt.url));
		assert.equal(health.status, 200);
		assert.equal((await health.json()).installation_id, receipt.installation_id);
	} finally {
		try {
			if (existsSync(join(root, 'app', 'scripts', 'start.mjs')) && existsSync(descriptor))
				await run(process.execPath, [
					join(root, 'app', 'scripts', 'start.mjs'),
					'stop',
					'--installation',
					descriptor,
					'--json'
				]).catch((error) => {
					if (!error.stdout?.includes('No owned Saturday supervisor is running.')) throw error;
				});
			// Stop acknowledges shutdown before the supervisor has exited and finished writing state.
			if (existsSync(descriptor)) {
				const deadline = Date.now() + 15000;
				while (serverSummary().managed && Date.now() < deadline) await wait(50);
				assert.equal(
					serverSummary().managed,
					false,
					'The disposable supervisor must exit before cleanup.'
				);
			}
		} finally {
			for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
			Object.assign(process.env, prior);
			await fs.rm(temporary, { recursive: true, force: true });
		}
	}
});

async function fixture() {
	const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'saturday-operation-'))),
		app = join(root, 'app');
	await copySource(resolve('.'), app);
	await fs.symlink(resolve('node_modules'), join(app, 'node_modules'), 'dir');
	await fs.cp(resolve('build'), join(app, 'build'), { recursive: true });
	const env = {
		...process.env,
		SATURDAY_PROJECT_ROOT: app,
		PORT: String(await freePort()),
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: '',
		SATURDAY_FILES_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: '',
		SATURDAY_EXTENSIONS_PATH: ''
	};
	const setup = await run(
		process.execPath,
		[
			join(app, 'scripts/setup.mjs'),
			'--managed',
			'--root',
			root,
			'--skip-dependencies',
			'--skip-build',
			'--skip-pdf',
			'--json'
		],
		{ env, maxBuffer: 1024 * 1024 }
	);
	const descriptor = JSON.parse(setup.stdout).descriptor_path,
		config = JSON.parse(await fs.readFile(descriptor));
	config.port = Number(env.PORT);
	config.build = readBuildInfo(resolve('.'));
	config.code_owned = true;
	config.code_fingerprint = await codeFingerprint(app);
	await fs.writeFile(descriptor, JSON.stringify(config));
	return { root, app, descriptor, env: { ...env, SATURDAY_INSTALLATION_PATH: descriptor } };
}
async function terminal() {
	const deadline = Date.now() + 180000;
	while (Date.now() < deadline) {
		const state = operationStatus();
		if (
			state &&
			(state.error ||
				![
					'queued',
					'staging',
					'waiting_for_disconnect',
					'backing_up',
					'publishing',
					'migrating',
					'restarting',
					'removing'
				].includes(state.status))
		)
			return state;
		await wait(200);
	}
	throw Error('Installation operation timed out');
}

test('repair stages with recovery, preserves populated stores and stopped state; uninstall retains data and requires separate deletion confirmation', async () => {
	const f = await fixture(),
		prior = { ...process.env };
	Object.assign(process.env, f.env);
	try {
		await run(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import {createJob} from ${JSON.stringify(join(f.app, 'src/lib/server/services.js'))};createJob({job_title:'Preserve',company_name:'Fixture'});`
			],
			{ env: f.env }
		);
		const config = getInstallation(),
			db = await fs.readFile(config.database),
			manifest = await fs.readFile(join(config.files, 'manifest.json'));
		const desktop = join(f.root, 'desktop');
		await fs.mkdir(desktop);
		await createDesktopShortcut({ desktop });
		await assert.rejects(queueOperation('update', { confirm: true, check_id: 'unknown' }), /stale/);
		await assert.rejects(queueOperation('uninstall', { delete_data: true }), /Confirm/);
		const queued = await queueOperation('repair', { source: f.app });
		assert.equal(queued.operation, 'repair');
		const repaired = await terminal();
		assert.equal(repaired.status, 'complete', JSON.stringify(repaired));
		assert.equal(repaired.url, undefined);
		assert.deepEqual(await fs.readFile(config.database), db);
		assert.deepEqual(await fs.readFile(join(config.files, 'manifest.json')), manifest);
		assert.ok(repaired.recovery.database);
		assert.ok(repaired.recovery.files);
		const checkConfig = getInstallation(),
			paths = operationPaths(),
			updateId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
			target = { kind: 'development', commit: 'c'.repeat(40), available: true };
		await fs.writeFile(
			paths.status,
			JSON.stringify({
				format: 'saturday.operation',
				version: 1,
				id: updateId,
				installation_id: checkConfig.installation_id,
				pid: process.pid,
				operation: 'update',
				status: 'queued',
				config: checkConfig,
				selected: { local: { fingerprint: await codeFingerprint(f.app) }, target },
				started_at: new Date().toISOString(),
				log: join(paths.root, 'checked-update.log')
			})
		);
		await executeOperation(updateId, {
			copySource,
			downloadSource: async () => ({ source: f.app }),
			run: () => {},
			resolveTarget: async () => target
		});
		const updated = operationStatus();
		assert.equal(updated.status, 'complete', JSON.stringify(updated));
		assert.equal(getInstallation().build.commit, target.commit);
		assert.deepEqual(await fs.readFile(config.database), db);
		assert.deepEqual(await fs.readFile(join(config.files, 'manifest.json')), manifest);
		await queueOperation('uninstall', { confirm: true });
		const removed = await terminal();
		assert.equal(removed.status, 'complete', JSON.stringify(removed));
		assert.equal(existsSync(f.app), false);
		assert.deepEqual(await fs.readFile(config.database), db);
		assert.ok(existsSync(config.files));
		assert.equal((await fs.readdir(desktop)).length, 0);
		const { install } = await import('../scripts/install.mjs');
		const resumed = await install({
			root: f.root,
			source: resolve('.'),
			desktop,
			'skip-pdf': true,
			'no-open': true
		});
		assert.equal(resumed.installation_id, config.installation_id);
		assert.deepEqual(await fs.readFile(config.database), db);
		assert.deepEqual(await fs.readFile(join(config.files, 'manifest.json')), manifest);
		await run(getInstallation().node_path, [
			join(f.app, 'scripts/start.mjs'),
			'stop',
			'--installation',
			f.descriptor,
			'--json'
		]);
		await wait(500);
	} finally {
		for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
		Object.assign(process.env, prior);
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test('uninstall refuses a connected client then deletes only separately confirmed owned data', async () => {
	const f = await fixture(),
		prior = { ...process.env };
	Object.assign(process.env, f.env);
	try {
		const config = getInstallation(),
			desktop = join(f.root, 'desktop');
		await fs.mkdir(desktop);
		await createDesktopShortcut({ desktop });
		await fs.writeFile(join(config.files, 'keep-test.txt'), 'owned bytes');
		const external = join(f.root, 'downloaded-backup.sqlite');
		await fs.writeFile(external, 'external export');
		const clients = join(config.extension_state, 'processes');
		await fs.mkdir(clients, { recursive: true });
		await fs.writeFile(join(clients, `${process.pid}.json`), JSON.stringify({ pid: process.pid }));
		await queueOperation('uninstall', { confirm: true, delete_data: true });
		const blocked = await terminal();
		assert.match(blocked.error, /assistant disconnect/);
		assert.ok(existsSync(f.app));
		assert.ok(existsSync(config.database));
		await fs.rm(join(clients, `${process.pid}.json`));
		await queueOperation('uninstall', { confirm: true, delete_data: true });
		const removed = await terminal();
		assert.equal(removed.status, 'complete', JSON.stringify(removed));
		assert.equal(existsSync(config.data_root), false);
		assert.equal(await fs.readFile(external, 'utf8'), 'external export');
		assert.equal(getInstallation().data_deleted, true);
		assert.equal((await fs.readdir(desktop)).length, 0);
	} finally {
		for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
		Object.assign(process.env, prior);
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test('a required private runtime is pinned, validated and leaves the existing runtime untouched', async () => {
	const { runtimeHashes, runtimeVersion } = await import('../scripts/install.mjs');
	const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'saturday-runtime-'))),
		config = {
			descriptor_path: join(root, 'installation.json'),
			installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
			node_path: process.execPath,
			runtime_root: resolve(process.execPath, '..'),
			runtime_owned: false
		};
	try {
		const prepared = await prepareRuntime(
			config,
			{ node_minimum: '24.0.0', runtime: { version: runtimeVersion, hashes: runtimeHashes } },
			'22.13.0'
		);
		assert.equal(prepared.runtime_owned, true);
		assert.equal(resolve(prepared.runtime_root, '..'), join(root, 'runtime'));
		assert.notEqual(prepared.node_path, config.node_path);
		assert.ok(existsSync(config.node_path));
		assert.equal(
			(await run(prepared.node_path, ['--version'])).stdout.trim(),
			`v${runtimeVersion}`
		);
		assert.equal(prepared.runtime_history[0].owned, false);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('interrupted managed publication resumes with guarded storage instead of resetting or downgrading', async () => {
	const f = await fixture(),
		prior = { ...process.env };
	Object.assign(process.env, f.env);
	try {
		const config = getInstallation(),
			paths = operationPaths(),
			id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
			oldId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
			candidate = join(paths.root, `work-${oldId}`, 'app'),
			previous = join(paths.root, `previous-${oldId}`);
		await fs.mkdir(join(paths.root, `work-${oldId}`), { recursive: true });
		await fs.cp(f.app, candidate, { recursive: true });
		await fs.writeFile(
			paths.journal,
			JSON.stringify({
				format: 'saturday.update-publication',
				version: 1,
				installation_id: config.installation_id,
				operation_id: oldId,
				phase: 'prepared',
				config,
				next: config,
				candidate,
				previous,
				was_running: false
			})
		);
		await fs.writeFile(
			paths.status,
			JSON.stringify({
				format: 'saturday.operation',
				version: 1,
				id,
				installation_id: config.installation_id,
				pid: process.pid,
				operation: 'repair',
				status: 'queued',
				config,
				log: join(paths.root, 'recovery-test.log')
			})
		);
		const database = await fs.readFile(config.database),
			manifest = await fs.readFile(join(config.files, 'manifest.json'));
		await executeOperation(id, {
			copySource,
			downloadSource: () => {
				throw Error('Repair must use its retained candidate');
			},
			run: () => {}
		});
		assert.equal(operationStatus().status, 'complete', JSON.stringify(operationStatus()));
		assert.ok(!existsSync(paths.journal));
		assert.ok(existsSync(previous));
		assert.deepEqual(await fs.readFile(config.database), database);
		assert.deepEqual(await fs.readFile(join(config.files, 'manifest.json')), manifest);
	} finally {
		for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
		Object.assign(process.env, prior);
		await fs.rm(f.root, { recursive: true, force: true });
	}
});
