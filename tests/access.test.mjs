import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, unlink, writeFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sourceInstallation, atomicJson, getInstallation } from '../src/lib/server/installation.js';
import {
	initializeAccessSettings,
	updateAccessSettings,
	readAccessSettings,
	accessPath,
	accessCookieName,
	defaultAccessSettings,
	parseIdleHours,
	safeReturnPath,
	localBrowser
} from '../src/lib/server/access-settings.js';
import {
	SessionStore,
	passwordHash,
	verifyPassword,
	checkPassword,
	authState
} from '../src/lib/server/access-auth.js';
import { withAccessChange } from '../src/lib/server/access-admin.js';
import { registerExtensionRuntime, assertWebRuntimeStopped } from '../src/lib/server/extensions.js';
import { claimInstallationMaintenance } from '../src/lib/server/server-lifecycle.js';
import {
	operationPaths,
	executeOperation,
	operationStatus
} from '../src/lib/server/installation-operations.js';

async function fixture(work) {
	const previous = { ...process.env },
		root = await mkdtemp(join(tmpdir(), 'saturday-access-'));
	process.env.SATURDAY_PROJECT_ROOT = resolve('.');
	process.env.SATURDAY_DB_PATH = join(root, 'saturday.db');
	process.env.SATURDAY_FILES_PATH = join(root, 'files');
	process.env.SATURDAY_INSTALLATION_PATH = join(root, 'installation.json');
	const config = { ...sourceInstallation(), installation_id: randomUUID() };
	await atomicJson(process.env.SATURDAY_INSTALLATION_PATH, config);
	try {
		await work(root);
	} finally {
		for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
		Object.assign(process.env, previous);
		await rm(root, { recursive: true, force: true });
	}
}

test('access initialization preserves settings and fails closed at the marker/file crash boundary', async () =>
	fixture(async () => {
		assert.deepEqual(readAccessSettings(), defaultAccessSettings());
		await initializeAccessSettings();
		assert.equal(getInstallation().initialized.access, true);
		assert.equal((await stat(accessPath())).mode & 0o777, 0o600);
		await updateAccessSettings((current) => ({ ...current, idle_timeout_seconds: null }));
		await initializeAccessSettings();
		assert.equal(readAccessSettings().idle_timeout_seconds, null);
		await unlink(accessPath());
		assert.throws(() => readAccessSettings(), /unavailable/);
		await assert.rejects(initializeAccessSettings(), /unavailable/);
		await updateAccessSettings(() => defaultAccessSettings(), { recover: true });
		assert.equal(readAccessSettings().password, null);
		await writeFile(accessPath(), '{broken');
		assert.throws(() => readAccessSettings(), /unavailable/);
		await updateAccessSettings(() => defaultAccessSettings(), { recover: true });
		const original = accessPath() + '.original';
		await writeFile(original, JSON.stringify(defaultAccessSettings()));
		await unlink(accessPath());
		await symlink(original, accessPath());
		assert.throws(() => readAccessSettings(), /unavailable/);
		await assert.rejects(
			updateAccessSettings(() => defaultAccessSettings(), { recover: true }),
			/Unsafe/
		);
	}));

test('installation operation admission blocks access changes and preserves the original file', async () =>
	fixture(async () => {
		await initializeAccessSettings();
		const before = await readFile(accessPath(), 'utf8'),
			paths = operationPaths();
		await atomicJson(paths.status, {
			format: 'saturday.operation',
			version: 1,
			installation_id: getInstallation().installation_id,
			status: 'queued',
			pid: process.pid
		});
		await assert.rejects(
			withAccessChange(() => updateAccessSettings((current) => ({ ...current, password: null }))),
			/queued or running/
		);
		assert.equal(await readFile(accessPath(), 'utf8'), before);
	}));

test('password changes before source setup return actionable 409 without running the change', async () =>
	fixture(async () => {
		await unlink(process.env.SATURDAY_INSTALLATION_PATH);
		process.env.SATURDAY_INSTALLATION_PATH = '';
		let called = false;
		await assert.rejects(
			withAccessChange(() => {
				called = true;
			}),
			(error) => error.status === 409 && /Finish Saturday setup/.test(error.message)
		);
		assert.equal(called, false);
		assert.equal(readAccessSettings().password, null);
	}));

test('access maintenance permits MCP but refuses independent web runtimes and prevents new admission', async () =>
	fixture(async () => {
		await registerExtensionRuntime();
		await assertWebRuntimeStopped();
		await registerExtensionRuntime('web');
		await assert.rejects(assertWebRuntimeStopped(), /independently launched/);
		await atomicJson(join(getInstallation().extension_state, 'processes', `${process.pid}.json`), {
			pid: process.pid
		});
		await assert.rejects(assertWebRuntimeStopped(), /unclassified runtime/);
		await registerExtensionRuntime();
		const release = await claimInstallationMaintenance();
		try {
			await assert.rejects(registerExtensionRuntime('web'), /stopping or restarting/);
		} finally {
			await release();
		}
	}));

test('inactivity settings and return paths reject invalid/unsafe inputs', () => {
	assert.equal(parseIdleHours('0.25'), 900);
	assert.equal(parseIdleHours('720'), 2592000);
	assert.equal(parseIdleHours('0.5'), 1800);
	assert.equal(parseIdleHours(null, true), null);
	for (const value of ['', ' ', '0', '-1', 'Infinity', 'NaN', '1e309', '721'])
		assert.throws(() => parseIdleHours(value));
	for (const value of [
		'https://evil.test',
		'//evil.test',
		'/\\evil.test',
		'/signin',
		'/auth/session',
		'/\nredirect'
	])
		assert.equal(safeReturnPath(value), '/');
	assert.equal(safeReturnPath('/jobs/3?edit=true#notes'), '/jobs/3?edit=true#notes');
	assert.equal(
		localBrowser({ getClientAddress: () => '192.168.1.2', url: new URL('http://127.0.0.1:3000') }),
		false
	);
});

test('sessions expire independently, do not revive, and support all timeout-mode transitions', () => {
	let now = 0;
	const store = new SessionStore(() => now);
	const first = store.create(900),
		second = store.create(900);
	now = 899000;
	assert.equal(store.valid(first, 900, true), true);
	now = 900000;
	assert.equal(store.valid(second, 900, true), false);
	assert.equal(store.valid(first, 900), true);
	store.changeTimeout(900, null);
	now = 1e10;
	assert.equal(store.valid(first, null), true);
	assert.equal(store.valid(second, null), false);
	store.changeTimeout(null, 900);
	now += 899000;
	assert.equal(store.valid(first, 900), true);
	now += 1000;
	assert.equal(store.valid(first, 900), false);
	const third = store.create(3600);
	now += 1000000;
	store.changeTimeout(3600, 900);
	assert.equal(store.valid(third, 900), false);
	const fourth = store.create(null);
	store.revoke(fourth);
	assert.equal(store.valid(fourth, null), false);
});

test('session capacity evicts oldest creation, logout-all removes every token, and tokens are stored hashed', () => {
	const store = new SessionStore();
	const first = store.create(null);
	for (let i = 1; i < 100; i++) store.create(null);
	assert.equal(store.sessions.size, 100);
	const newest = store.create(null);
	assert.equal(store.valid(first, null), false);
	assert.equal(store.valid(newest, null), true);
	assert.equal(store.sessions.has(newest), false);
	store.clear();
	assert.equal(store.valid(newest, null), false);
});

test('salted scrypt verification, bounded failures and installation cookie isolation', async () =>
	fixture(async () => {
		const verifier = await passwordHash('correct long password');
		assert.equal(await verifyPassword('correct long password', verifier), true);
		assert.equal(await verifyPassword('incorrect password', verifier), false);
		const shortVerifier = await passwordHash('7');
		assert.equal(await verifyPassword('7', shortVerifier), true);
		assert.equal(await verifyPassword('8', shortVerifier), false);
		await assert.rejects(passwordHash(''), /Enter a password/);
		await assert.rejects(passwordHash('x'.repeat(1025)), /at most 1,024 bytes/);
		await initializeAccessSettings();
		await updateAccessSettings((current) => ({ ...current, password: verifier }));
		const settings = readAccessSettings(),
			state = authState(settings);
		const token = state.store.create(settings.idle_timeout_seconds);
		await updateAccessSettings((current) => ({ ...current, allow_lan: true }));
		assert.equal(
			authState(readAccessSettings()).store.valid(token, 3600),
			true,
			'saving LAN preference must not revoke an active login'
		);
		for (let i = 0; i < 10; i++) assert.equal(await checkPassword('', 'client', settings), false);
		await assert.rejects(checkPassword('', 'client', settings), /Too many attempts/);
		assert.equal(state.store.valid(token, 3600), true, 'failed logins do not evict sessions');
		const names = [
			accessCookieName(),
			accessCookieName('control'),
			accessCookieName('login', { installation_id: randomUUID() })
		];
		assert.equal(new Set(names).size, 3);
		await updateAccessSettings((current) => ({ ...current, password: null }));
		assert.equal(authState(readAccessSettings()).store.sessions.size, 0);
	}));

test('protected installation maintenance retains access settings without creating a progress gateway', async () =>
	fixture(async (root) => {
		await initializeAccessSettings();
		const verifier = await passwordHash('protected maintenance password');
		await updateAccessSettings((current) => ({ ...current, password: verifier }));
		const config = getInstallation(),
			id = randomUUID(),
			paths = operationPaths();
		const before = await readFile(accessPath(), 'utf8');
		await atomicJson(join(root, 'server.state', 'server.json'), {
			format: 'saturday.server',
			version: 1,
			installation_id: config.installation_id,
			pid: 2147483647,
			port: 3000,
			url: 'http://127.0.0.1:3000',
			token: 'a'.repeat(64),
			generation: randomUUID(),
			status: 'stopped',
			control_port: null,
			error: null
		});
		await atomicJson(paths.status, {
			format: 'saturday.operation',
			version: 1,
			id,
			installation_id: config.installation_id,
			operation: 'uninstall',
			status: 'queued',
			config,
			delete_data: false,
			log: join(paths.root, 'operation.log'),
			pid: process.pid
		});
		await executeOperation(id, {});
		assert.equal(operationStatus().status, 'complete');
		assert.equal(
			operationStatus().poll_url,
			undefined,
			'a retained loopback address must not create a control-cookie-only progress gateway'
		);
		assert.equal(await readFile(accessPath(), 'utf8'), before);
	}));
