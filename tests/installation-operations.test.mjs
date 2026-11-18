import { createServer } from 'node:net';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
	prepareRuntime,
	developmentHold,
	pruneOperationArtifacts,
	connectedClients,
	assistantConnectionNotice,
	PREVIOUS_BUILDS_RETAINED
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

test('fresh managed installation from a CRLF Git checkout uses its descriptor and starts the UI', async () => {
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
		// Reproduce an assistant's Windows-style checkout from committed, secret-free source.
		await run('git', [
			'-c',
			'core.autocrlf=true',
			'clone',
			'--quiet',
			'--no-local',
			'--depth=1',
			resolve('.'),
			source
		]);
		assert.ok((await fs.readFile(join(source, 'scripts/setup.mjs'), 'utf8')).includes('\r\n'));
		assert.deepEqual(
			await fs.readFile(join(source, 'tests/fixtures/release-0.1.0-current/expected.json')),
			await fs.readFile(resolve('tests/fixtures/release-0.1.0-current/expected.json'))
		);
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
		const repeatEnv = { ...process.env };
		for (const key of ['SATURDAY_BUILD_ID', 'SATURDAY_BUILD_COMMIT', 'SATURDAY_BUILD_DIRTY'])
			delete repeatEnv[key];
		await run(
			config.node_path,
			[
				join(config.code_root, 'scripts/setup.mjs'),
				'--skip-dependencies',
				'--skip-build',
				'--skip-pdf',
				'--json'
			],
			{ env: repeatEnv }
		);
		assert.deepEqual(
			JSON.parse(await fs.readFile(descriptor)).build,
			config.build,
			'skipped builds retain the identity of installed artifacts'
		);
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
				`import {createJob} from ${JSON.stringify(join(f.app, 'src/lib/server/local/jobs.js'))};createJob({job_title:'Preserve',company_name:'Fixture'});`
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
		const resumed = await install({
			root: f.root,
			source: resolve('.'),
			desktop,
			'skip-pdf': true,
			'no-open': true
		});
		assert.equal(resumed.installation_id, config.installation_id);
		const fresh = await run(
			getInstallation().node_path,
			[
				'--input-type=module',
				'-e',
				`import {withDatabase} from ${JSON.stringify(join(f.app, 'src/lib/server/database.js'))};console.log(JSON.stringify(withDatabase(db=>({jobs:db.prepare('SELECT count(*) n FROM jobs').get().n,stages:db.prepare('SELECT count(*) n FROM workflow_stages').get().n}))));`
			],
			{ env: f.env }
		);
		assert.deepEqual(JSON.parse(fresh.stdout), { jobs: 0, stages: 8 });
		assert.equal(
			JSON.parse(await fs.readFile(join(getInstallation().data_root, 'access.json'))).password,
			null
		);
		assert.equal(await fs.readFile(external, 'utf8'), 'external export');
		const pid = serverSummary().managed
			? JSON.parse(await fs.readFile(join(getInstallation().data_root, 'server.state/server.json')))
					.pid
			: null;
		await run(getInstallation().node_path, [
			join(f.app, 'scripts/start.mjs'),
			'stop',
			'--installation',
			f.descriptor,
			'--json'
		]);
		if (pid) {
			let stopped = false;
			for (let i = 0; i < 150; i++) {
				try {
					process.kill(pid, 0);
				} catch (e) {
					if (e.code === 'ESRCH') {
						stopped = true;
						break;
					}
					throw e;
				}
				await wait(100);
			}
			assert(stopped);
		}
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

test('operation cleanup removes disposable folders, keeps the newest previous build and respects journals', async () => {
	const root = await fs.mkdtemp(join(tmpdir(), 'saturday-prune-'));
	try {
		const paths = { root, journal: join(root, 'publication.json') };
		const id = (n) =>
			`${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
		const names = [
			`controller-${id(1)}`,
			`work-${id(2)}`,
			`previous-${id(3)}`,
			`previous-${id(4)}`,
			`controller-${id(5)}`,
			`previous-${id(5)}`
		];
		for (const name of names) await fs.mkdir(join(root, name, 'app'), { recursive: true });
		await fs.writeFile(join(root, 'retained-extension-x.sqlite'), 'keep');
		await fs.writeFile(join(root, `${id(1)}.log`), 'keep');
		await fs.utimes(join(root, `previous-${id(3)}`), new Date(1000), new Date(1000));
		await fs.utimes(join(root, `previous-${id(4)}`), new Date(2000), new Date(2000));
		await fs.writeFile(paths.journal, '{}');
		assert.deepEqual(await pruneOperationArtifacts(paths), [], 'a pending journal blocks cleanup');
		await fs.rm(paths.journal);
		// As after a completed update: keep protects the running controller, but its own
		// previous build still counts toward retention and older builds are removed.
		await pruneOperationArtifacts(paths, new Set([id(5)]));
		assert.equal(PREVIOUS_BUILDS_RETAINED, 1);
		assert.deepEqual((await fs.readdir(root)).sort(), [
			`${id(1)}.log`,
			`controller-${id(5)}`,
			`previous-${id(5)}`,
			'retained-extension-x.sqlite'
		]);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('connected assistants are refused before staging and failed updates leave terminal state without staging', async () => {
	const f = await fixture(),
		prior = { ...process.env },
		client = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
	Object.assign(process.env, f.env);
	let liveMcp;
	try {
		await new Promise((r) => client.once('spawn', r));
		const config = getInstallation(),
			paths = operationPaths(),
			leases = join(config.extension_state, 'processes');
		await fs.mkdir(leases, { recursive: true });
		// Explicit legacy {pid, role} compatibility cases (no identity endpoint).
		await fs.writeFile(
			join(leases, `${client.pid}.json`),
			JSON.stringify({ pid: client.pid, role: 'web' })
		);
		assert.equal(await connectedClients(config), 0, 'legacy web UI leases are not assistants');
		await fs.writeFile(
			join(leases, `${client.pid}.json`),
			JSON.stringify({ pid: client.pid, role: 'mcp' })
		);
		assert.equal(await connectedClients(config), 1, 'legacy MCP leases still count conservatively');
		// Stale v2 lease for an unrelated live PID with a refused endpoint is ignored.
		const probe = createServer();
		await new Promise((r) => probe.listen(0, '127.0.0.1', r));
		const refusedPort = probe.address().port;
		await new Promise((r) => probe.close(r));
		await fs.writeFile(
			join(leases, `${client.pid}.json`),
			JSON.stringify({
				pid: client.pid,
				role: 'mcp',
				lease_version: 2,
				instance_id: randomUUID(),
				secret: randomBytes(32).toString('hex'),
				identity_port: refusedPort
			})
		);
		assert.equal(
			await connectedClients(config),
			0,
			'stale v2 lease for unrelated live PID is ignored'
		);
		assert.ok(existsSync(join(leases, `${client.pid}.json`)), 'reader does not delete stale lease');

		// Owned child runtime with a genuine v2 lease blocks update and repair even with aged mtime.
		const leaseModuleUrl = new URL('../src/lib/server/process-leases.js', import.meta.url).href;
		liveMcp = spawn(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import { registerProcessLease } from ${JSON.stringify(leaseModuleUrl)}; process.on('SIGTERM', () => process.exit(143)); await registerProcessLease(JSON.parse(process.argv[1]), 'mcp'); process.stdout.write('ready\\n'); setInterval(() => {}, 60000);`,
				JSON.stringify(config)
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		);
		await new Promise((res, rej) => {
			let out = '';
			let err = '';
			liveMcp.stderr.on('data', (c) => (err += c));
			liveMcp.stdout.on('data', (c) => {
				out += c;
				if (out.includes('ready\n')) res();
			});
			liveMcp.once('exit', (code) => rej(new Error(`child exited (${code}): ${err}`)));
		});
		const liveLeasePath = join(leases, `${liveMcp.pid}.json`);
		const oldTime = new Date(Date.now() - 48 * 3600 * 1000);
		await fs.utimes(liveLeasePath, oldTime, oldTime);
		assert.equal(await connectedClients(config), 1);

		const target = { kind: 'development', commit: 'd'.repeat(40), available: true },
			fingerprint = await codeFingerprint(f.app),
			checkId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
		await fs.mkdir(paths.root, { recursive: true });
		await fs.writeFile(
			paths.check,
			JSON.stringify({
				format: 'saturday.update-check',
				version: 1,
				id: checkId,
				installation_id: config.installation_id,
				checked_at: new Date().toISOString(),
				local: { dirty: false, fingerprint },
				target
			})
		);
		await assert.rejects(
			queueOperation('update', { check_id: checkId, confirm: true }),
			/assistant is connected/
		);
		await assert.rejects(queueOperation('repair', {}), /assistant is connected.*then repair/);
		assert.equal(operationStatus(), null, 'nothing was queued');

		liveMcp.kill('SIGTERM');
		await new Promise((r) => liveMcp.once('exit', r));
		assert.equal(existsSync(liveLeasePath), false, 'child exit removes genuine v2 lease');
		await fs.rm(join(leases, `${client.pid}.json`));
		assert.equal(await connectedClients(config), 0);

		const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
		await fs.writeFile(
			paths.status,
			JSON.stringify({
				format: 'saturday.operation',
				version: 1,
				id,
				installation_id: config.installation_id,
				pid: process.pid,
				operation: 'update',
				status: 'queued',
				config,
				selected: { local: { fingerprint }, target },
				started_at: new Date().toISOString(),
				log: join(paths.root, 'failed-update.log')
			})
		);
		await executeOperation(id, {
			copySource,
			downloadSource: async () => {
				throw Object.assign(Error('Stopped waiting for assistant disconnect.'), {
					code: 'MCP_CONNECTED'
				});
			},
			run: () => {},
			resolveTarget: async () => target
		});
		const failed = operationStatus();
		assert.equal(failed.status, 'failed', JSON.stringify(failed));
		assert.equal(failed.error_code, 'MCP_CONNECTED');
		assert.equal(existsSync(join(paths.root, `work-${id}`)), false, 'staging is removed');
		assert.ok(existsSync(f.app), 'installed code is untouched');
	} finally {
		if (liveMcp && liveMcp.exitCode === null) liveMcp.kill('SIGKILL');
		client.kill();
		for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
		Object.assign(process.env, prior);
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test('a main build moves to releases only when the release is a step forward', async () => {
	const root = await fs.mkdtemp(join(tmpdir(), 'saturday-hold-'));
	try {
		const metadata = {
			release: '0.2.0',
			commit: sha,
			storage: {
				database: { currentVersion: 2 },
				manifest: { version: 1 }
			}
		};
		const installed = async (version, database = 1, manifest = 1) => {
			await fs.writeFile(
				join(root, 'package.json'),
				JSON.stringify({
					version,
					saturday: {
						storage: { database: { currentVersion: database }, manifest: { version: manifest } }
					}
				})
			);
			return { code_root: root, build: { commit: other } };
		};
		assert.equal(developmentHold({ build: { commit: null } }, metadata), null, 'fresh install');
		assert.equal(developmentHold(await installed('0.1.9'), metadata), null, 'older main build');
		assert.equal(developmentHold(await installed('0.2.0', 2), metadata), null, 'same version');
		assert.match(developmentHold(await installed('0.2.1', 2), metadata), /newer than the latest/);
		assert.match(developmentHold(await installed('0.1.9', 3), metadata), /newer storage format/);
		assert.match(developmentHold(await installed('0.1.9', 1, 2), metadata), /newer storage/);
		assert.match(
			developmentHold({ code_root: root, build: { commit: sha } }, metadata),
			/This build is release 0.2.0/
		);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('assistantConnectionNotice distinguishes verified MCP leases from unverified unknown/legacy evidence', async () => {
	const f = await fixture(),
		prior = { ...process.env },
		sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
	Object.assign(process.env, f.env);
	let liveMcp;
	try {
		await new Promise((r) => sleeper.once('spawn', r));
		const config = getInstallation();
		const leases = join(config.extension_state, 'processes');
		await fs.mkdir(leases, { recursive: true });

		// 1. No leases -> not connected
		assert.deepEqual(await assistantConnectionNotice(config), {
			connected: false,
			verified: false,
			blocking: [],
			notice: null
		});

		// 2. Unknown-only evidence -> connected stays true (blocking), wording says could not verify and names PID/path
		const unknownPath = join(leases, `${sleeper.pid}.json`);
		await fs.writeFile(unknownPath, '{malformed');
		const unknownRes = await assistantConnectionNotice(config);
		assert.equal(unknownRes.connected, true);
		assert.equal(unknownRes.verified, false);
		assert.match(unknownRes.notice.title, /unverified/i);
		assert.match(unknownRes.notice.message, /could not verify/i);
		assert.equal(unknownRes.notice.message.includes(String(sleeper.pid)), true);
		assert.equal(unknownRes.notice.message.includes(unknownPath), true);
		assert.equal(unknownRes.notice.message.includes('An assistant is connected'), false);

		// 3. Legacy-only evidence -> connected stays true (blocking), wording says could not verify and names PID/path
		await fs.writeFile(unknownPath, JSON.stringify({ pid: sleeper.pid, role: 'mcp' }));
		const legacyRes = await assistantConnectionNotice(config);
		assert.equal(legacyRes.connected, true);
		assert.equal(legacyRes.verified, false);
		assert.match(legacyRes.notice.message, /could not verify/i);
		assert.equal(legacyRes.notice.message.includes(String(sleeper.pid)), true);
		assert.equal(legacyRes.notice.message.includes(unknownPath), true);
		await fs.rm(unknownPath);

		// 4. Genuine MCP lease -> produces the "connected" wording
		const leaseModuleUrl = new URL('../src/lib/server/process-leases.js', import.meta.url).href;
		liveMcp = spawn(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import { registerProcessLease } from ${JSON.stringify(leaseModuleUrl)}; process.on('SIGTERM', () => process.exit(143)); await registerProcessLease(JSON.parse(process.argv[1]), 'mcp'); process.stdout.write('ready\\n'); setInterval(() => {}, 60000);`,
				JSON.stringify(config)
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] }
		);
		await new Promise((res, rej) => {
			let out = '';
			let err = '';
			liveMcp.stderr.on('data', (c) => (err += c));
			liveMcp.stdout.on('data', (c) => {
				out += c;
				if (out.includes('ready\n')) res();
			});
			liveMcp.once('exit', (code) => rej(new Error(`child exited (${code}): ${err}`)));
		});
		const genuineRes = await assistantConnectionNotice(config);
		assert.equal(genuineRes.connected, true);
		assert.equal(genuineRes.verified, true);
		assert.equal(genuineRes.notice.title, 'Assistant connected');
		assert.match(genuineRes.notice.message, /An assistant is connected to Saturday/);
	} finally {
		if (liveMcp && liveMcp.exitCode === null && liveMcp.signalCode === null) {
			liveMcp.kill('SIGKILL');
			await new Promise((r) => liveMcp.once('exit', r));
		}
		if (sleeper.exitCode === null && sleeper.signalCode === null) {
			sleeper.kill('SIGKILL');
			await new Promise((r) => sleeper.once('exit', r));
		}
		for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
		Object.assign(process.env, prior);
		await fs.rm(f.root, { recursive: true, force: true });
	}
});
