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
	BRANCH_REFS,
	compareVersions,
	selectTarget,
	validateRelease,
	ownedRemovalTargets,
	assertSafeRemoval,
	queueOperation,
	queueBranchSwitch,
	listBranches,
	branchCompatibility,
	beginSwitchExport,
	readSwitchExport,
	completeSwitchExport,
	clearSwitchExport,
	resetLiveData,
	checkUpdates,
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
import {
	getInstallation,
	validateInstallation,
	createDesktopShortcut
} from '../src/lib/server/installation.js';
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

function packageResponse(overrides = {}) {
	const merged = {
		...pkg,
		...overrides,
		saturday: {
			...pkg.saturday,
			...(overrides.saturday || {}),
			storage: {
				database: {
					...pkg.saturday.storage.database,
					...(overrides.saturday?.storage?.database || {})
				},
				manifest: {
					...pkg.saturday.storage.manifest,
					...(overrides.saturday?.storage?.manifest || {})
				}
			}
		}
	};
	return {
		encoding: 'base64',
		content: Buffer.from(JSON.stringify(merged)).toString('base64')
	};
}

function makeStubBuildRun(f) {
	return async (cmd, args, options, defaultRun) => {
		if (args[1] === 'ci') {
			const targetModules = join(options.cwd, 'node_modules');
			if (!existsSync(targetModules))
				await fs.symlink(resolve('node_modules'), targetModules, 'dir');
			return;
		}
		if (args[1] === 'run' && args[2] === 'build') {
			const targetBuild = join(options.cwd, 'build');
			if (!existsSync(targetBuild)) await fs.cp(resolve('build'), targetBuild, { recursive: true });
			return;
		}
		return defaultRun(cmd, args, options);
	};
}

test('branch allowlist, descriptor tracking_ref validation, and source-mode refusal', async () => {
	assert.deepEqual([...BRANCH_REFS], ['main', 'dev']);
	const f = await fixture(),
		prior = { ...process.env };
	Object.assign(process.env, f.env);
	try {
		const validBase = JSON.parse(await fs.readFile(f.descriptor, 'utf8'));
		assert.equal(validateInstallation(validBase).tracking_ref, undefined);
		assert.equal(validateInstallation({ ...validBase, tracking_ref: 'main' }).tracking_ref, 'main');
		assert.equal(validateInstallation({ ...validBase, tracking_ref: 'dev' }).tracking_ref, 'dev');
		for (const bad of [
			'',
			'feat/x-1',
			'../etc',
			'-x',
			' main',
			'dev ',
			'a'.repeat(101),
			null,
			123
		]) {
			assert.throws(() => validateInstallation({ ...validBase, tracking_ref: bad }), {
				code: 'BRANCH_REF'
			});
		}

		// Source-mode refusal leaves descriptor and journal bytes intact.
		const sourceDescriptor = { ...validBase, mode: 'source', code_owned: false };
		await fs.writeFile(f.descriptor, JSON.stringify(sourceDescriptor));
		const beforeDesc = await fs.readFile(f.descriptor);
		const paths = operationPaths(getInstallation());
		await fs.mkdir(paths.root, { recursive: true });
		await fs.writeFile(paths.journal, '{"sentinel":true}');
		const beforeJournal = await fs.readFile(paths.journal);
		await assert.rejects(listBranches({ config: getInstallation() }), { code: 'BRANCH_MODE' });
		await assert.rejects(branchCompatibility({ ref: 'dev', config: getInstallation() }), {
			code: 'BRANCH_MODE'
		});
		await assert.rejects(
			queueBranchSwitch(
				{
					ref: 'dev',
					commit: sha,
					check_id: randomUUID(),
					export_id: randomUUID(),
					backup_id: 'b1',
					confirm: true
				},
				{ config: getInstallation() }
			),
			{ code: 'BRANCH_MODE' }
		);
		await assert.rejects(resetLiveData(getInstallation()), { code: 'BRANCH_MODE' });
		assert.deepEqual(await fs.readFile(f.descriptor), beforeDesc);
		assert.deepEqual(await fs.readFile(paths.journal), beforeJournal);
		assert.equal(existsSync(paths.switch_export), false);
	} finally {
		for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
		Object.assign(process.env, prior);
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test('listBranches filters allowlist across pages, reports missing refs, and distinguishes invalid/network/404 failures', async () => {
	const managedConfig = { mode: 'managed', tracking_ref: 'dev', release: null };
	const page1 = [
		{ name: 'main', commit: { sha } },
		...Array.from({ length: 99 }, (_, i) => ({ name: `feat/x-${i}`, commit: { sha: other } }))
	];
	const page2 = [
		{ name: 'dev', commit: { sha: other } },
		{ name: 'backup/2026', commit: { sha } }
	];
	const listed = await listBranches({
		config: managedConfig,
		request: async (path) => {
			if (path === '/branches?per_page=100&page=1') return page1;
			if (path === '/branches?per_page=100&page=2') return page2;
			throw new Error(`unexpected ${path}`);
		}
	});
	assert.equal(listed.current_ref, 'dev');
	assert.deepEqual(listed.branches, [
		{ ref: 'main', commit: sha, missing: false },
		{ ref: 'dev', commit: other, missing: false }
	]);

	// Missing/renamed dev appears as disabled missing row rather than substituting another branch.
	const missingDev = await listBranches({
		config: managedConfig,
		request: async () => [
			{ name: 'main', commit: { sha } },
			{ name: 'dev-renamed', commit: { sha: other } }
		]
	});
	assert.deepEqual(missingDev.branches, [
		{ ref: 'main', commit: sha, missing: false },
		{ ref: 'dev', commit: null, missing: true }
	]);

	// Invalid shape, bad SHA, duplicate allowlisted name, and >10 pages -> BRANCH_RESPONSE.
	await assert.rejects(
		listBranches({ config: managedConfig, request: async () => ({ not: 'array' }) }),
		{ code: 'BRANCH_RESPONSE' }
	);
	await assert.rejects(
		listBranches({
			config: managedConfig,
			request: async () => [{ name: 'main', commit: { sha: 'bad-sha' } }]
		}),
		{ code: 'BRANCH_RESPONSE' }
	);
	await assert.rejects(
		listBranches({
			config: managedConfig,
			request: async () => [
				{ name: 'main', commit: { sha } },
				{ name: 'main', commit: { sha: other } }
			]
		}),
		{ code: 'BRANCH_RESPONSE' }
	);
	await assert.rejects(
		listBranches({
			config: managedConfig,
			request: async () =>
				Array.from({ length: 100 }, (_, i) => ({ name: `f-${i}`, commit: { sha } }))
		}),
		{ code: 'BRANCH_RESPONSE' }
	);

	// Network/rate-limit failure -> BRANCH_LOOKUP.
	await assert.rejects(
		listBranches({
			config: managedConfig,
			request: async () => {
				throw Object.assign(new Error('GitHub update check failed (403).'), { status: 403 });
			}
		}),
		{ code: 'BRANCH_LOOKUP' }
	);

	// 404 branch resolution -> BRANCH_MISSING; non-404 preserves error.
	await assert.rejects(
		selectTarget({ mode: 'managed', tracking_ref: 'dev', build: { commit: sha } }, async () => {
			throw Object.assign(new Error('GitHub update check failed (404).'), { status: 404 });
		}),
		{ code: 'BRANCH_MISSING' }
	);
});

test('selectTarget honors tracking_ref before release discovery and reports three-state commit comparison', async () => {
	const seen = [];
	const tracked = await selectTarget(
		{ tracking_ref: 'dev', build: { commit: sha } },
		async (path) => {
			seen.push(path);
			if (path === '/commits/dev') return { sha: other };
			throw new Error(`unexpected ${path}`);
		}
	);
	assert.deepEqual(seen, ['/commits/dev'], 'explicit tracking_ref bypasses release discovery');
	assert.equal(tracked.ref, 'dev');
	assert.equal(tracked.commit, other);
	assert.equal(tracked.available, true);
	assert.equal(tracked.comparison, 'different');
	assert.match(tracked.notes, /^dev changed;/);

	const same = await selectTarget({ tracking_ref: 'dev', build: { commit: sha } }, async () => ({
		sha
	}));
	assert.equal(same.available, false);
	assert.equal(same.comparison, 'same');

	for (const badCommit of [null, undefined, '', 'not-a-sha']) {
		const unknown = await selectTarget(
			{ tracking_ref: 'main', build: { commit: badCommit } },
			async () => ({ sha })
		);
		assert.equal(unknown.available, null);
		assert.equal(unknown.comparison, 'unknown');
		assert.match(unknown.notes, /installed commit is unknown.*main/);
	}

	// Unknown installed commit persisted by checkUpdates cannot queue an ordinary update.
	const f = await fixture(),
		prior = { ...process.env };
	Object.assign(process.env, f.env);
	try {
		const config = JSON.parse(await fs.readFile(f.descriptor, 'utf8'));
		config.build = { id: 'local.0123456789ab', commit: null, dirty: null };
		config.tracking_ref = 'dev';
		await fs.writeFile(f.descriptor, JSON.stringify(config));
		const checked = await checkUpdates({
			request: async (path) => {
				if (path === '/commits/dev') return { sha };
				throw new Error(`unexpected ${path}`);
			}
		});
		assert.equal(checked.purpose, 'update');
		assert.equal(checked.target.available, null);
		assert.equal(checked.target.comparison, 'unknown');
		await assert.rejects(
			queueOperation('update', { check_id: checked.id, confirm: true }),
			/No checked update is available/
		);
		// CLI update check must NOT claim "up to date" when the installed commit is unknown.
		const cliFixturePath = join(f.root, 'branch-cli-fixture.json');
		await fs.writeFile(
			cliFixturePath,
			JSON.stringify({
				refs: { dev: sha, main: sha },
				packages: { [sha]: JSON.parse(await fs.readFile(resolve('package.json'), 'utf8')) }
			})
		);
		const cliOut = await run(
			process.execPath,
			[
				'--import',
				resolve('tests/helpers/branch-fetch-fixture.mjs'),
				resolve('scripts/install.mjs'),
				'update',
				'--installation',
				f.descriptor
			],
			{ env: { ...f.env, SATURDAY_TEST_BRANCH_FIXTURE: cliFixturePath } }
		);
		assert.match(cliOut.stderr, /installed commit is unknown/i);
		assert.doesNotMatch(cliOut.stderr, /up to date/i);
		// Matching commit still prints "Saturday is up to date".
		config.build = { id: `dev.${sha.slice(0, 12)}`, commit: sha, dirty: false };
		await fs.writeFile(f.descriptor, JSON.stringify(config));
		const cliUpToDate = await run(
			process.execPath,
			[
				'--import',
				resolve('tests/helpers/branch-fetch-fixture.mjs'),
				resolve('scripts/install.mjs'),
				'update',
				'--installation',
				f.descriptor
			],
			{ env: { ...f.env, SATURDAY_TEST_BRANCH_FIXTURE: cliFixturePath } }
		);
		assert.match(cliUpToDate.stderr, /Saturday is up to date/i);
	} finally {
		for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
		Object.assign(process.env, prior);
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test('local build identity captures Git commit and dirty state and preserves them through local-source repair', async () => {
	const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'saturday-local-id-')));
	const prior = { ...process.env };
	const cleanEnv = () => {
		for (const k of ['SATURDAY_BUILD_ID', 'SATURDAY_BUILD_COMMIT', 'SATURDAY_BUILD_DIRTY'])
			delete process.env[k];
	};
	try {
		const repoDir = join(root, 'repo');
		const archiveDir = join(root, 'archive');
		await fs.mkdir(repoDir);
		await fs.mkdir(archiveDir);
		await run('git', ['init', '--quiet'], { cwd: repoDir });
		await run(
			'git',
			[
				'-c',
				'user.name=Test',
				'-c',
				'user.email=test@example.invalid',
				'-c',
				'commit.gpgsign=false',
				'commit',
				'--allow-empty',
				'-m',
				'fixture'
			],
			{ cwd: repoDir }
		);
		const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
		const localId = 'local.abcdef012345';

		// Clean Git fixture with local ID retains ID and captures commit + dirty:false.
		cleanEnv();
		process.env.SATURDAY_BUILD_ID = localId;
		assert.deepEqual(readBuildInfo(repoDir), { id: localId, commit: head, dirty: false });

		// Dirty Git fixture retains ID and captures commit + dirty:true.
		await fs.writeFile(join(repoDir, 'dirty.txt'), 'change');
		assert.deepEqual(readBuildInfo(repoDir), { id: localId, commit: head, dirty: true });

		// Non-Git archive yields unknown (commit:null, dirty:null), never invents dirty:true.
		assert.deepEqual(readBuildInfo(archiveDir), { id: localId, commit: null, dirty: null });

		// Non-Git subdirectory inside an enclosing Git repo must NOT inherit the parent repo's commit.
		const nestedNonRepo = join(repoDir, 'nested-non-repo');
		await fs.mkdir(nestedNonRepo);
		assert.deepEqual(readBuildInfo(nestedNonRepo), { id: localId, commit: null, dirty: null });

		// Explicit invalid commit still fails even when SATURDAY_BUILD_ID is set.
		process.env.SATURDAY_BUILD_COMMIT = 'bad';
		assert.throws(() => readBuildInfo(repoDir), /full commit SHA/);

		// Explicit malformed dirty state throws BUILD_IDENTITY.
		process.env.SATURDAY_BUILD_COMMIT = head;
		process.env.SATURDAY_BUILD_DIRTY = 'maybe';
		assert.throws(() => readBuildInfo(repoDir), { code: 'BUILD_IDENTITY' });

		// Explicit valid commit + dirty pair works without Git.
		process.env.SATURDAY_BUILD_DIRTY = '0';
		assert.deepEqual(readBuildInfo(archiveDir), { id: localId, commit: head, dirty: false });
		process.env.SATURDAY_BUILD_DIRTY = '1';
		assert.deepEqual(readBuildInfo(archiveDir), { id: localId, commit: head, dirty: true });

		// Local-source repair captures Git SHA/dirty before copySource strips .git.
		cleanEnv();
		const f = await fixture();
		try {
			Object.assign(process.env, f.env);
			const sourceGit = join(f.root, 'source-git');
			await copySource(resolve('.'), sourceGit);
			await run('git', ['init', '--quiet'], { cwd: sourceGit });
			await run('git', ['add', '.'], { cwd: sourceGit });
			await run(
				'git',
				[
					'-c',
					'user.name=Test',
					'-c',
					'user.email=test@example.invalid',
					'-c',
					'commit.gpgsign=false',
					'commit',
					'--quiet',
					'-m',
					'local repair fixture'
				],
				{ cwd: sourceGit }
			);
			const repairHead = (
				await run('git', ['rev-parse', 'HEAD'], { cwd: sourceGit })
			).stdout.trim();
			await fs.writeFile(join(sourceGit, 'local-dirty.txt'), 'untracked');
			const config = getInstallation();
			const paths = operationPaths(config);
			const repairId = randomUUID();
			await fs.mkdir(paths.root, { recursive: true });
			await fs.writeFile(
				paths.status,
				JSON.stringify({
					format: 'saturday.operation',
					version: 1,
					id: repairId,
					installation_id: config.installation_id,
					pid: process.pid,
					operation: 'repair',
					status: 'queued',
					config,
					source: sourceGit,
					started_at: new Date().toISOString(),
					log: join(paths.root, `${repairId}.log`)
				})
			);
			const seenBuildEnv = [];
			await executeOperation(repairId, {
				copySource,
				onRun: async (cmd, args, options, defaultRun) => {
					if (args[1] === 'run' && args[2] === 'build') {
						seenBuildEnv.push({
							id: options.env.SATURDAY_BUILD_ID,
							commit: options.env.SATURDAY_BUILD_COMMIT,
							dirty: options.env.SATURDAY_BUILD_DIRTY
						});
					}
					return makeStubBuildRun(f)(cmd, args, options, defaultRun);
				}
			});
			assert.equal(operationStatus().status, 'complete', JSON.stringify(operationStatus()));
			const repairedConfig = getInstallation();
			assert.match(repairedConfig.build.id, /^local\.[a-f0-9]{12}$/);
			assert.equal(repairedConfig.build.commit, repairHead);
			assert.equal(repairedConfig.build.dirty, true);
			assert.equal(existsSync(join(repairedConfig.code_root, '.git')), false);
			assert.equal(seenBuildEnv[0].commit, repairHead);
			assert.equal(seenBuildEnv[0].dirty, '1');
			// Known candidate commit matching tracked head reports up-to-date (regression for 65c121a1).
			const upToDate = await selectTarget({ ...repairedConfig, tracking_ref: 'dev' }, async () => ({
				sha: repairHead
			}));
			assert.equal(upToDate.available, false);
			assert.equal(upToDate.comparison, 'same');
		} finally {
			await fs.rm(f.root, { recursive: true, force: true });
		}
	} finally {
		for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
		Object.assign(process.env, prior);
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('branchCompatibility computes all verdicts, bypasses password/LAN guards on switch, and keeps them on ordinary updates', async () => {
	const f = await fixture(),
		prior = { ...process.env };
	Object.assign(process.env, f.env);
	try {
		const config = getInstallation();
		const { DatabaseSync } = await import('node:sqlite');
		const checkVerdict = async (pkgOverrides) =>
			branchCompatibility({
				ref: 'dev',
				config,
				request: async (path) => {
					if (path === '/commits/dev') return { sha };
					if (path === `/contents/package.json?ref=${sha}`) return packageResponse(pkgOverrides);
					throw new Error(`unexpected ${path}`);
				}
			});

		// 1. Equal -> compatible.
		const compat = await checkVerdict({});
		assert.equal(compat.purpose, 'branch-switch');
		assert.equal(compat.compatibility.verdict, 'compatible');
		assert.equal(compat.compatibility.live.database.version, 1);
		assert.equal(compat.compatibility.live.manifest.version, 1);

		// 2. Target current higher -> candidate_newer.
		assert.equal(
			(
				await checkVerdict({
					saturday: { storage: { database: { minimumVersion: 1, currentVersion: 2 } } }
				})
			).compatibility.verdict,
			'candidate_newer'
		);

		// 3. Target minimum higher -> candidate_newer.
		assert.equal(
			(
				await checkVerdict({
					saturday: { storage: { manifest: { minimumVersion: 2, version: 2 } } }
				})
			).compatibility.verdict,
			'candidate_newer'
		);

		// 4. Live higher -> data_newer, and mixed dimensions choose data_newer.
		const db = new DatabaseSync(config.database);
		db.prepare(
			"INSERT INTO schema_migrations(version, name, applied_at) VALUES (2, 'test', ?)"
		).run(new Date().toISOString());
		db.close();
		assert.equal((await checkVerdict({})).compatibility.verdict, 'data_newer');
		assert.equal(
			(
				await checkVerdict({
					saturday: { storage: { manifest: { minimumVersion: 1, version: 2 } } }
				})
			).compatibility.verdict,
			'data_newer',
			'mixed older/newer dimensions choose data_newer'
		);

		// Restore live DB version to 1; test format mismatch (via manifest format) -> data_newer.
		const dbRestore = new DatabaseSync(config.database);
		dbRestore.prepare('DELETE FROM schema_migrations WHERE version = 2').run();
		dbRestore.close();
		const manifestPath = join(config.files, 'manifest.json');
		const originalManifest = await fs.readFile(manifestPath, 'utf8');
		await fs.writeFile(
			manifestPath,
			JSON.stringify({ ...JSON.parse(originalManifest), format: 'other.files' })
		);
		assert.equal((await checkVerdict({})).compatibility.verdict, 'data_newer');
		await fs.writeFile(manifestPath, originalManifest);

		// 5. Invalid candidate package/runtime -> CANDIDATE_METADATA.
		await assert.rejects(checkVerdict({ name: 'not-saturday' }), { code: 'CANDIDATE_METADATA' });
		await assert.rejects(
			checkVerdict({ engines: { node: '>=99.0.0' }, saturday: { node_minimum: '99.0.0' } }),
			{ code: 'CANDIDATE_METADATA' }
		);

		// 6. Password & LAN guards bypassed for branchCompatibility, preserved for ordinary checkUpdates.
		await fs.writeFile(
			join(config.data_root, 'access.json'),
			JSON.stringify({
				format: 'saturday.access',
				version: 1,
				allow_lan: true,
				idle_timeout_seconds: 3600,
				password: {
					algorithm: 'scrypt',
					N: 131072,
					r: 8,
					p: 1,
					salt: 'a'.repeat(32),
					hash: 'b'.repeat(128)
				}
			})
		);
		const bypass = await checkVerdict({ saturday: { access_api: 0, lan_api: 0 } });
		assert.equal(bypass.compatibility.verdict, 'compatible');
		await assert.rejects(
			checkUpdates({
				request: async (path) => {
					if (path.startsWith('/releases')) return [];
					if (path === '/commits/main') return { sha };
					if (path === `/contents/package.json?ref=${sha}`)
						return packageResponse({ saturday: { access_api: 0, lan_api: 0 } });
					throw new Error(`unexpected ${path}`);
				}
			}),
			/LAN preferences/
		);

		// 7. Unreadable/missing live manifest -> STORAGE_UNAVAILABLE.
		await fs.rm(join(config.files, 'manifest.json'));
		await assert.rejects(checkVerdict({}), { code: 'STORAGE_UNAVAILABLE' });
	} finally {
		for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
		Object.assign(process.env, prior);
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test('switch export receipt lifecycle survives restart, enforces bindings, prevents stale overwrites, and blocks ordinary bypass', async () => {
	const f = await fixture(),
		prior = { ...process.env };
	Object.assign(process.env, f.env);
	try {
		const config = getInstallation();
		const paths = operationPaths(config);
		const compatReq = async (path) => {
			if (path === '/commits/dev') return { sha };
			if (path === `/contents/package.json?ref=${sha}`) return packageResponse();
			throw new Error(`unexpected ${path}`);
		};
		const review = await branchCompatibility({ ref: 'dev', config, request: compatReq });

		// Direct ordinary queueOperation cannot use a branch-switch check.
		await assert.rejects(queueOperation('update', { check_id: review.id, confirm: true }), {
			code: 'CHECK_PURPOSE'
		});

		// Absent export refuses.
		await assert.rejects(
			queueBranchSwitch(
				{
					ref: 'dev',
					commit: sha,
					check_id: review.id,
					export_id: randomUUID(),
					backup_id: 'b1',
					confirm: true
				},
				{ config, request: compatReq, spawnWorker: async () => process.pid }
			),
			{ code: 'EXPORT_REQUIRED' }
		);

		// Pending export refuses; supersede old export so delayed old completion/clear cannot touch new one.
		const oldPending = await beginSwitchExport({ check_id: review.id, backup_id: 'b-old' }, config);
		const newPending = await beginSwitchExport({ check_id: review.id, backup_id: 'b-new' }, config);
		assert.equal(
			await completeSwitchExport(
				{
					export_id: oldPending.id,
					backup_id: 'b-old',
					filename: 'old.zip',
					bytes: 100,
					sha256: '1'.repeat(64)
				},
				config
			),
			null,
			'superseded export cannot complete'
		);
		assert.deepEqual(await clearSwitchExport({ export_id: oldPending.id }, config), {
			cleared: false
		});
		assert.equal(readSwitchExport(config)?.id, newPending.id);

		// Pending marker still refuses queueBranchSwitch.
		await assert.rejects(
			queueBranchSwitch(
				{
					ref: 'dev',
					commit: sha,
					check_id: review.id,
					export_id: newPending.id,
					backup_id: 'b-new',
					confirm: true
				},
				{ config, request: compatReq, spawnWorker: async () => process.pid }
			),
			{ code: 'EXPORT_REQUIRED' }
		);

		// Complete export; verify a fresh child Node process (simulating restart) reads the same receipt.
		const completed = await completeSwitchExport(
			{
				export_id: newPending.id,
				backup_id: 'b-new',
				filename: 'saturday-test.zip',
				bytes: 4096,
				sha256: '2'.repeat(64)
			},
			config
		);
		assert.equal(completed.status, 'complete');
		// Cancelled duplicate stream must not clear an already-completed receipt.
		assert.deepEqual(await clearSwitchExport({ export_id: completed.id }, config), {
			cleared: false
		});
		assert.equal(readSwitchExport(config)?.status, 'complete');
		const freshRead = await run(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import { readSwitchExport } from ${JSON.stringify(new URL('../src/lib/server/installation-operations.js', import.meta.url).href)}; console.log(JSON.stringify(readSwitchExport()));`
			],
			{ env: f.env }
		);
		assert.deepEqual(JSON.parse(freshRead.stdout), completed);

		// Wrong backup_id refuses.
		await assert.rejects(
			queueBranchSwitch(
				{
					ref: 'dev',
					commit: sha,
					check_id: review.id,
					export_id: completed.id,
					backup_id: 'wrong-backup',
					confirm: true
				},
				{ config, request: compatReq, spawnWorker: async () => process.pid }
			),
			{ code: 'EXPORT_REQUIRED' }
		);

		// Upstream branch changed after review refuses with BRANCH_CHANGED and keeps receipt untouched.
		await assert.rejects(
			queueBranchSwitch(
				{
					ref: 'dev',
					commit: sha,
					check_id: review.id,
					export_id: completed.id,
					backup_id: 'b-new',
					confirm: true
				},
				{
					config,
					request: async () => ({ sha: other }),
					spawnWorker: async () => process.pid
				}
			),
			{ code: 'BRANCH_CHANGED' }
		);

		// Matching completed export queues once and consumes the receipt.
		const queued = await queueBranchSwitch(
			{
				ref: 'dev',
				commit: sha,
				check_id: review.id,
				export_id: completed.id,
				backup_id: 'b-new',
				confirm: true
			},
			{ config, request: compatReq, spawnWorker: async () => process.pid }
		);
		assert.equal(queued.operation, 'update');
		assert.equal(queued.reset_data, true);
		assert.equal(queued.branch_switch.filename, 'saturday-test.zip');
		assert.equal(readSwitchExport(config), null, 'receipt is consumed on accepted queue');

		// Competing active operation rejects without overwriting operation state.
		await assert.rejects(
			queueBranchSwitch(
				{
					ref: 'dev',
					commit: sha,
					check_id: review.id,
					export_id: completed.id,
					backup_id: 'b-new',
					confirm: true
				},
				{ config, request: compatReq, spawnWorker: async () => process.pid }
			),
			{ code: 'OPERATION_BUSY' }
		);
		await assert.rejects(queueOperation('repair', {}), { code: 'OPERATION_BUSY' });

		// Mark completed and test incompatible typed MOVE requirement.
		await fs.rm(paths.status, { force: true });
		const incompatReview = await branchCompatibility({
			ref: 'dev',
			config,
			request: async (path) => {
				if (path === '/commits/dev') return { sha };
				if (path === `/contents/package.json?ref=${sha}`)
					return packageResponse({
						saturday: { storage: { database: { minimumVersion: 1, currentVersion: 2 } } }
					});
				throw new Error(`unexpected ${path}`);
			}
		});
		const incompatPending = await beginSwitchExport(
			{ check_id: incompatReview.id, backup_id: 'b-incompat' },
			config
		);
		await completeSwitchExport(
			{
				export_id: incompatPending.id,
				backup_id: 'b-incompat',
				filename: 'saturday-incompat.zip',
				bytes: 512,
				sha256: '3'.repeat(64)
			},
			config
		);
		for (const wrong of ['', 'move', 'MOVE ', ' MOVE']) {
			await assert.rejects(
				queueBranchSwitch(
					{
						ref: 'dev',
						commit: sha,
						check_id: incompatReview.id,
						export_id: incompatPending.id,
						backup_id: 'b-incompat',
						confirm: true,
						confirmation: wrong
					},
					{ config, request: compatReq, spawnWorker: async () => process.pid }
				),
				{ code: 'SWITCH_TYPED_CONFIRM' }
			);
		}
		const acceptedIncompat = await queueBranchSwitch(
			{
				ref: 'dev',
				commit: sha,
				check_id: incompatReview.id,
				export_id: incompatPending.id,
				backup_id: 'b-incompat',
				confirm: true,
				confirmation: 'MOVE'
			},
			{ config, request: compatReq, spawnWorker: async () => process.pid }
		);
		assert.equal(acceptedIncompat.reset_data, true);
	} finally {
		for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
		Object.assign(process.env, prior);
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test('destructive branch switch enforces publish -> reset -> live setup ordering and blocks late leases', async () => {
	const f = await fixture(),
		prior = { ...process.env };
	Object.assign(process.env, f.env);
	try {
		const config = getInstallation();
		const paths = operationPaths(config);
		// Seed recognizable populated DB, files, extension state/code, access password/LAN.
		await run(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import {createJob} from ${JSON.stringify(join(f.app, 'src/lib/server/local/jobs.js'))};
				import {createDocument} from ${JSON.stringify(join(f.app, 'src/lib/server/files/documents.js'))};
				createJob({job_title:'PreSwitch Sentinel',company_name:'BeforeCorp'});
				await createDocument({filename:'pre-switch.md',content:'old-doc-sentinel'});`
			],
			{ env: f.env }
		);
		await fs.mkdir(config.extension_code, { recursive: true });
		await fs.writeFile(join(config.extension_code, 'old-ext.txt'), 'old-ext-code');
		await fs.mkdir(join(config.extension_state, 'sample-ext'), { recursive: true });
		await fs.writeFile(join(config.extension_state, 'sample-ext', 'state.txt'), 'old-ext-state');
		await fs.writeFile(
			join(config.data_root, 'access.json'),
			JSON.stringify({
				format: 'saturday.access',
				version: 1,
				allow_lan: true,
				idle_timeout_seconds: 3600,
				password: {
					algorithm: 'scrypt',
					N: 131072,
					r: 8,
					p: 1,
					salt: 'a'.repeat(32),
					hash: 'b'.repeat(128)
				}
			})
		);
		const { DatabaseSync } = await import('node:sqlite');
		const beforeDb = new DatabaseSync(config.database, { readOnly: true });
		const beforeDatasetId = beforeDb
			.prepare('SELECT dataset_id FROM app_metadata WHERE id=1')
			.get().dataset_id;
		beforeDb.close();

		// Create candidate source with a recognizable code marker.
		const candidateSrc = join(f.root, 'candidate-dev');
		await copySource(resolve('.'), candidateSrc);
		await fs.writeFile(join(candidateSrc, 'branch-marker.txt'), 'dev-candidate-marker');

		const devReq = async (path) => {
			if (path === '/commits/dev') return { sha };
			if (path === `/contents/package.json?ref=${sha}`) return packageResponse();
			throw new Error(`unexpected ${path}`);
		};

		// Part 1: inject an unknown lease right before final guard -> must block with data intact and no publication.
		const review1 = await branchCompatibility({ ref: 'dev', config, request: devReq });
		const exp1 = await beginSwitchExport({ check_id: review1.id, backup_id: 'b-ord-1' }, config);
		await completeSwitchExport(
			{
				export_id: exp1.id,
				backup_id: 'b-ord-1',
				filename: 'saturday-ord1.zip',
				bytes: 2048,
				sha256: '4'.repeat(64)
			},
			config
		);
		const queued1 = await queueBranchSwitch(
			{
				ref: 'dev',
				commit: sha,
				check_id: review1.id,
				export_id: exp1.id,
				backup_id: 'b-ord-1',
				confirm: true
			},
			{ config, request: devReq, spawnWorker: async () => process.pid }
		);
		const processesDir = join(config.extension_state, 'processes');
		const blockedLease = join(processesDir, 'unverified-late-lease.json');
		await executeOperation(queued1.id, {
			copySource,
			downloadSource: async () => ({ source: candidateSrc }),
			request: devReq,
			onRun: makeStubBuildRun(f),
			// Plant the unknown/unverified lease AFTER the staged-setup guard passes,
			// right before the final assertClientsStopped guard ahead of publish().
			getLoginStartupStatus: async () => {
				await fs.mkdir(processesDir, { recursive: true });
				await fs.writeFile(blockedLease, '{malformed-late-lease');
				return { available: true, enabled: false };
			}
		});
		const blockedStatus = operationStatus();
		assert.equal(blockedStatus.status, 'failed');
		assert.equal(blockedStatus.error_code, 'MCP_CONNECTED');
		assert.equal(existsSync(join(config.code_root, 'branch-marker.txt')), false, 'not published');
		assert.equal(getInstallation().tracking_ref, undefined, 'tracking_ref not written on failure');
		assert.equal(
			await fs.readFile(join(config.extension_code, 'old-ext.txt'), 'utf8'),
			'old-ext-code',
			'live data untouched'
		);
		await fs.rm(blockedLease, { force: true });

		// Part 2: successful switch — assert live data intact AT publish, and reset ALREADY complete AT entry to live setup!
		const review2 = await branchCompatibility({ ref: 'dev', config, request: devReq });
		const exp2 = await beginSwitchExport({ check_id: review2.id, backup_id: 'b-ord-2' }, config);
		await completeSwitchExport(
			{
				export_id: exp2.id,
				backup_id: 'b-ord-2',
				filename: 'saturday-ord2.zip',
				bytes: 2048,
				sha256: '5'.repeat(64)
			},
			config
		);
		const queued2 = await queueBranchSwitch(
			{
				ref: 'dev',
				commit: sha,
				check_id: review2.id,
				export_id: exp2.id,
				backup_id: 'b-ord-2',
				confirm: true
			},
			{ config, request: devReq, spawnWorker: async () => process.pid }
		);
		let observedAtPublish = false;
		let observedAtLiveSetupEntry = false;
		await executeOperation(queued2.id, {
			copySource,
			downloadSource: async () => ({ source: candidateSrc }),
			request: devReq,
			onAfterPublish: async (journal) => {
				// Immediately after publish (before reset): old data AND lease dir must STILL be intact!
				// An early reset (before publish) fails these assertions!
				observedAtPublish = true;
				assert.equal(journal.phase, 'published');
				assert.equal(journal.reset_phase, 'pending');
				assert.equal(existsSync(join(config.code_root, 'branch-marker.txt')), true);
				assert.equal(existsSync(config.database), true, 'old DB still intact at publish');
				assert.equal(
					existsSync(join(config.files, 'manifest.json')),
					true,
					'old files intact at publish'
				);
				assert.equal(existsSync(join(config.extension_code, 'old-ext.txt')), true);
				assert.equal(existsSync(processesDir), true, 'lease directory still intact at publish');
			},
			onRun: async (cmd, args, options, defaultRun) => {
				const isLiveSetup =
					typeof args[0] === 'string' &&
					args[0].endsWith('scripts/setup.mjs') &&
					!args.includes('--managed') &&
					options.cwd === config.code_root;
				if (isLiveSetup) {
					// At entry to LIVE setup: publish AND reset must ALREADY be complete!
					// A late reset (after setup) fails these assertions!
					observedAtLiveSetupEntry = true;
					const desc = JSON.parse(await fs.readFile(f.descriptor, 'utf8'));
					assert.equal(desc.tracking_ref, 'dev');
					assert.deepEqual(desc.initialized, {
						database: false,
						files: false,
						extensions: false,
						access: false
					});
					assert.equal(existsSync(join(config.code_root, 'branch-marker.txt')), true);
					assert.equal(
						existsSync(config.database),
						false,
						'old DB must be deleted before live setup'
					);
					assert.equal(
						existsSync(config.files),
						false,
						'old files must be deleted before live setup'
					);
					assert.equal(existsSync(config.extension_state), false);
					assert.equal(existsSync(config.extension_code), false);
					assert.deepEqual(await fs.readdir(config.data_root), ['server.state']);
					assert.deepEqual(await fs.readdir(join(config.data_root, 'server.state')), [
						'maintenance.json'
					]);
					// No recovery snapshot or staged user data copy anywhere in operation state.
					const stateEntries = await fs.readdir(paths.root);
					assert.equal(
						stateEntries.some((n) => n.startsWith('retained-extension-')),
						false
					);
				}
				return makeStubBuildRun(f)(cmd, args, options, defaultRun);
			}
		});
		assert.equal(observedAtPublish, true);
		assert.equal(observedAtLiveSetupEntry, true);
		const done = operationStatus();
		assert.equal(done.status, 'complete', JSON.stringify(done));
		assert.equal(done.recovery, null);
		const afterConfig = getInstallation();
		assert.equal(afterConfig.tracking_ref, 'dev');
		assert.equal(afterConfig.build.commit, sha);
		assert.equal(afterConfig.release, null);
		assert.equal(afterConfig.distribution, 'development');
		assert.deepEqual(afterConfig.initialized, {
			database: true,
			files: true,
			extensions: true,
			access: true
		});
		const afterDb = new DatabaseSync(afterConfig.database, { readOnly: true });
		const afterDatasetId = afterDb
			.prepare('SELECT dataset_id FROM app_metadata WHERE id=1')
			.get().dataset_id;
		const jobCount = afterDb.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
		afterDb.close();
		assert.notEqual(afterDatasetId, beforeDatasetId, 'fresh dataset identity after switch');
		assert.equal(jobCount, 0, 'zero jobs after switch');
		const afterAccess = JSON.parse(
			await fs.readFile(join(afterConfig.data_root, 'access.json'), 'utf8')
		);
		assert.equal(afterAccess.password, null);
		assert.equal(afterAccess.allow_lan, false);
		const rootEntries = await fs.readdir(f.root);
		assert.equal(
			rootEntries.some((n) => n.startsWith('data.pre-')),
			false,
			'no data.pre-* retained'
		);
		assert.ok(existsSync(afterConfig.logs));
		assert.ok(existsSync(f.descriptor));
		assert.ok(existsSync(paths.root));
		assert.ok((await fs.readdir(paths.root)).some((n) => n.startsWith('previous-')));
	} finally {
		for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
		Object.assign(process.env, prior);
		await fs.rm(f.root, { recursive: true, force: true });
	}
});

test('branch switch crash recovery handles pre-publish failures, mid-reset faults, no-double-reset after setup, and corrupted journals', async () => {
	const f = await fixture(),
		prior = { ...process.env };
	Object.assign(process.env, f.env);
	try {
		const config = getInstallation();
		const paths = operationPaths(config);
		const candidateSrc = join(f.root, 'candidate-rec');
		await copySource(resolve('.'), candidateSrc);
		await fs.writeFile(join(candidateSrc, 'recovered-branch.txt'), 'dev-rec');
		await fs.writeFile(join(config.data_root, 'keep-before-publish.txt'), 'intact');
		const devReq = async (path) => {
			if (path === '/commits/dev') return { sha };
			if (path === `/contents/package.json?ref=${sha}`) return packageResponse();
			throw new Error(`unexpected ${path}`);
		};

		const queueSwitch = async (backupTag) => {
			const rev = await branchCompatibility({
				ref: 'dev',
				config: getInstallation(),
				request: devReq
			});
			const exp = await beginSwitchExport(
				{ check_id: rev.id, backup_id: backupTag },
				getInstallation()
			);
			await completeSwitchExport(
				{
					export_id: exp.id,
					backup_id: backupTag,
					filename: `saturday-${backupTag}.zip`,
					bytes: 1024,
					sha256: '6'.repeat(64)
				},
				getInstallation()
			);
			return queueBranchSwitch(
				{
					ref: 'dev',
					commit: sha,
					check_id: rev.id,
					export_id: exp.id,
					backup_id: backupTag,
					confirm: true
				},
				{ config: getInstallation(), request: devReq, spawnWorker: async () => process.pid }
			);
		};

		// 1. Build failure -> status failed, data & descriptor untouched.
		const qBuild = await queueSwitch('b-build-fail');
		await executeOperation(qBuild.id, {
			copySource,
			downloadSource: async () => ({ source: candidateSrc }),
			request: devReq,
			onRun: async (cmd, args) => {
				if (args[1] === 'run' && args[2] === 'build') throw new Error('simulated build failure');
			}
		});
		assert.equal(operationStatus().status, 'failed');
		assert.equal(existsSync(paths.journal), false);
		assert.equal(existsSync(join(config.data_root, 'keep-before-publish.txt')), true);
		assert.equal(getInstallation().tracking_ref, undefined);

		// 2. Failure during second removal (extension_code) -> recovery_required, journal retained; Repair completes reset + setup.
		const maintenanceFile = join(config.data_root, 'server.state', 'maintenance.json');
		let maintenancePresentBeforeExtRemoval = false;
		const qMidReset = await queueSwitch('b-mid-reset');
		await executeOperation(qMidReset.id, {
			copySource,
			downloadSource: async () => ({ source: candidateSrc }),
			request: devReq,
			onRun: makeStubBuildRun(f),
			onRemoveRoot: async (_target, index) => {
				if (index === 1) {
					maintenancePresentBeforeExtRemoval = existsSync(maintenanceFile);
					throw new Error('simulated second removal failure');
				}
			}
		});
		assert.equal(operationStatus().status, 'recovery_required');
		assert.equal(operationStatus().reset_data, true);
		assert.equal(
			maintenancePresentBeforeExtRemoval,
			true,
			'maintenance record must be rebuilt immediately after data_root removal, before extension_code removal'
		);
		assert.equal(existsSync(paths.journal), true);
		const midJournal = JSON.parse(await fs.readFile(paths.journal, 'utf8'));
		assert.equal(midJournal.reset_phase, 'deleting');
		assert.equal(midJournal.branch_switch.filename, 'saturday-b-mid-reset.zip');
		assert.equal(existsSync(maintenanceFile), true);
		const markCrashedController = async () => {
			if (existsSync(maintenanceFile)) {
				const m = JSON.parse(await fs.readFile(maintenanceFile, 'utf8'));
				await fs.writeFile(maintenanceFile, JSON.stringify({ ...m, pid: 99999999 }));
			}
		};

		// Corrupt journal check: migrating + incomplete reset_phase refuses without erasing data!
		await markCrashedController();
		const corruptPath = join(config.data_root, 'must-survive-corrupt.txt');
		await fs.writeFile(corruptPath, 'keep');
		await fs.writeFile(
			paths.journal,
			JSON.stringify({ ...midJournal, phase: 'migrating', reset_phase: 'deleting' })
		);
		const corruptRepairId = randomUUID();
		await fs.writeFile(
			paths.status,
			JSON.stringify({
				format: 'saturday.operation',
				version: 1,
				id: corruptRepairId,
				installation_id: config.installation_id,
				pid: process.pid,
				operation: 'repair',
				status: 'queued',
				config: getInstallation(),
				log: join(paths.root, `${corruptRepairId}.log`)
			})
		);
		await executeOperation(corruptRepairId, { copySource, onRun: makeStubBuildRun(f) });
		assert.equal(operationStatus().status, 'recovery_required');
		assert.equal(
			await fs.readFile(corruptPath, 'utf8'),
			'keep',
			'corrupt journal did not erase data'
		);

		// Restore legitimate mid-reset journal (published + deleting) and inject live setup failure AFTER reset completes.
		await markCrashedController();
		await fs.writeFile(paths.journal, JSON.stringify(midJournal));
		const repairFailSetupId = randomUUID();
		await fs.writeFile(
			paths.status,
			JSON.stringify({
				format: 'saturday.operation',
				version: 1,
				id: repairFailSetupId,
				installation_id: config.installation_id,
				pid: process.pid,
				operation: 'repair',
				status: 'queued',
				config: getInstallation(),
				log: join(paths.root, `${repairFailSetupId}.log`)
			})
		);
		await executeOperation(repairFailSetupId, {
			copySource,
			onRun: async (cmd, args, options, defaultRun) => {
				if (typeof args[0] === 'string' && args[0].endsWith('scripts/setup.mjs')) {
					// Simulate partial setup creating a sentinel before failing.
					await fs.writeFile(join(config.data_root, 'setup-created-sentinel.txt'), 'keep-me');
					throw new Error('simulated live setup failure');
				}
				return makeStubBuildRun(f)(cmd, args, options, defaultRun);
			}
		});
		assert.equal(operationStatus().status, 'recovery_required');
		const afterSetupFailJournal = JSON.parse(await fs.readFile(paths.journal, 'utf8'));
		assert.equal(afterSetupFailJournal.reset_phase, 'complete');
		assert.equal(afterSetupFailJournal.phase, 'migrating');

		// Final repair retry: reset_phase is already 'complete', so setup-created-sentinel MUST survive (no second reset!).
		await markCrashedController();
		const finalRepairId = randomUUID();
		await fs.writeFile(
			paths.status,
			JSON.stringify({
				format: 'saturday.operation',
				version: 1,
				id: finalRepairId,
				installation_id: config.installation_id,
				pid: process.pid,
				operation: 'repair',
				status: 'queued',
				config: getInstallation(),
				log: join(paths.root, `${finalRepairId}.log`)
			})
		);
		await executeOperation(finalRepairId, { copySource, onRun: makeStubBuildRun(f) });
		assert.equal(operationStatus().status, 'complete', JSON.stringify(operationStatus()));
		assert.equal(existsSync(paths.journal), false);
		assert.equal(
			await fs.readFile(join(config.data_root, 'setup-created-sentinel.txt'), 'utf8'),
			'keep-me',
			'completed reset is never repeated on repair'
		);
		assert.equal(getInstallation().tracking_ref, 'dev');
		assert.equal(existsSync(join(config.code_root, 'recovered-branch.txt')), true);

		// 3. Crash strictly between journal.phase='published' write and installation.json write:
		// on-disk descriptor still says initialized.*=true, yet Repair must rewrite journal.next before reset and complete cleanly.
		const qCrashBeforeDesc = await queueSwitch('b-crash-before-desc');
		const descBeforeCrash = JSON.parse(await fs.readFile(f.descriptor, 'utf8'));
		assert.deepEqual(descBeforeCrash.initialized, {
			database: true,
			files: true,
			extensions: true,
			access: true
		});
		await executeOperation(qCrashBeforeDesc.id, {
			copySource,
			downloadSource: async () => ({ source: candidateSrc }),
			request: devReq,
			onRun: makeStubBuildRun(f),
			onJournalWrite: async (j) => {
				if (j.phase === 'published' && j.reset_phase === 'pending')
					throw new Error('simulated crash between published journal write and descriptor write');
			}
		});
		assert.equal(operationStatus().status, 'recovery_required');
		const preDescJournal = JSON.parse(await fs.readFile(paths.journal, 'utf8'));
		assert.equal(preDescJournal.phase, 'published');
		assert.equal(preDescJournal.reset_phase, 'pending');
		// Confirm on-disk descriptor was NOT yet rewritten before the simulated crash.
		const staleDesc = JSON.parse(await fs.readFile(f.descriptor, 'utf8'));
		assert.deepEqual(staleDesc.initialized, {
			database: true,
			files: true,
			extensions: true,
			access: true
		});
		await markCrashedController();
		const repairPreDescId = randomUUID();
		await fs.writeFile(
			paths.status,
			JSON.stringify({
				format: 'saturday.operation',
				version: 1,
				id: repairPreDescId,
				installation_id: config.installation_id,
				pid: process.pid,
				operation: 'repair',
				status: 'queued',
				config: getInstallation(),
				log: join(paths.root, `${repairPreDescId}.log`)
			})
		);
		await executeOperation(repairPreDescId, { copySource, onRun: makeStubBuildRun(f) });
		assert.equal(operationStatus().status, 'complete', JSON.stringify(operationStatus()));
		assert.equal(existsSync(paths.journal), false);
		const repairedAfterPreDesc = getInstallation();
		assert.equal(repairedAfterPreDesc.tracking_ref, 'dev');
		assert.deepEqual(repairedAfterPreDesc.initialized, {
			database: true,
			files: true,
			extensions: true,
			access: true
		});
	} finally {
		for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
		Object.assign(process.env, prior);
		await fs.rm(f.root, { recursive: true, force: true });
	}
});
