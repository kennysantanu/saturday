import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
const run = (file, args, env) =>
	new Promise((res, rej) => {
		const child = spawn(process.execPath, [file, ...args], {
			env,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let stdout = '',
			stderr = '';
		child.stdout.on('data', (v) => (stdout += v));
		child.stderr.on('data', (v) => (stderr += v));
		child.once('error', rej);
		child.once('close', (code) => res({ code, stdout, stderr }));
	});
async function waitFor(check) {
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		try {
			if (await check()) return;
		} catch {}
		await new Promise((res) => setTimeout(res, 100));
	}
	throw new Error('Transition timed out.');
}
function jar() {
	const cookies = new Map();
	return {
		get header() {
			return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
		},
		accept(response) {
			for (const cookie of response.headers.getSetCookie()) {
				const [pair] = cookie.split(';'),
					index = pair.indexOf('=');
				const name = pair.slice(0, index);
				if (/max-age=0/i.test(cookie)) cookies.delete(name);
				else cookies.set(name, pair.slice(index + 1));
			}
		},
		clone() {
			return this.header;
		}
	};
}

test('optional password UI gates private routes, supports login/logout/settings/restart, and recovers without touching career data', async () => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-auth-web-'));
	const socket = createServer();
	await new Promise((res) => socket.listen(0, '127.0.0.1', res));
	const port = socket.address().port;
	await new Promise((res) => socket.close(res));
	const env = {
		...process.env,
		SATURDAY_PROJECT_ROOT: resolve('.'),
		SATURDAY_DB_PATH: join(root, 'saturday.db'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'extension-code'),
		SATURDAY_INSTALLATION_PATH: '',
		PORT: String(port)
	};
	const base = `http://127.0.0.1:${port}`,
		password = 'private browser test password';
	const a = jar(),
		b = jar();
	const get = async (path, client = a, accept = 'text/html') => {
		const response = await fetch(base + path, {
			headers: { cookie: client.header, accept },
			redirect: 'manual'
		});
		client.accept(response);
		return response;
	};
	const post = async (path, fields, client = a, extra = {}) => {
		const response = await fetch(base + path, {
			method: 'POST',
			headers: {
				cookie: client.header,
				origin: base,
				accept: 'text/html',
				'content-type': 'application/x-www-form-urlencoded',
				...extra
			},
			body: new URLSearchParams(fields),
			redirect: 'manual'
		});
		client.accept(response);
		return response;
	};
	const stop = async () => {
		await run('scripts/start.mjs', ['stop', '--json'], env);
		await waitFor(async () => {
			const state = JSON.parse(await readFile(join(root, 'server.state/server.json')));
			try {
				process.kill(state.pid, 0);
				return false;
			} catch {
				return true;
			}
		});
	};
	let legacy;
	const stopLegacy = async () => {
		if (legacy && legacy.exitCode === null && legacy.signalCode === null) {
			const exited = new Promise((res) => legacy.once('exit', res));
			legacy.kill('SIGTERM');
			await exited;
		}
	};
	try {
		const seeded = await run(
			'--input-type=module',
			[
				'-e',
				`
			import { createJob } from './src/lib/server/services.js';
			import { createDocument } from './src/lib/server/files/documents.js';
			createJob({job_title:'Existing source record',company_name:'Preserve'});
			await createDocument({filename:'existing.txt',content:'Preserve this document.'});
		`
			],
			env
		);
		assert.equal(seeded.code, 0, seeded.stdout + seeded.stderr);
		const legacyDb = await readFile(join(root, 'saturday.db'));
		const legacyManifest = await readFile(join(root, 'files', 'manifest.json'));
		legacy = spawn(process.execPath, ['build/index.js'], {
			env: { ...env, HOST: '127.0.0.1', ORIGIN: base, SHUTDOWN_TIMEOUT: '1' },
			stdio: 'ignore'
		});
		await waitFor(async () => (await get('/settings')).status === 200);
		assert.match(await (await get('/settings')).text(), /Finish Saturday setup/);
		const beforeSetup = await post('/settings?/password', {
			operation: 'enable',
			password,
			confirm_password: password
		});
		assert.equal(beforeSetup.status, 409);
		assert.match(await beforeSetup.text(), /Finish Saturday setup/);
		await assert.rejects(access(join(root, 'access.json')), { code: 'ENOENT' });
		await stopLegacy();
		const setup = await run(
			'scripts/setup.mjs',
			['--skip-dependencies', '--skip-build', '--skip-pdf', '--json'],
			env
		);
		assert.equal(setup.code, 0, setup.stdout + setup.stderr);
		assert.deepEqual(await readFile(join(root, 'saturday.db')), legacyDb);
		assert.deepEqual(await readFile(join(root, 'files', 'manifest.json')), legacyManifest);
		env.SATURDAY_INSTALLATION_PATH = JSON.parse(setup.stdout).descriptor_path;
		const start = await run('scripts/start.mjs', ['--background', '--json'], env);
		assert.equal(start.code, 0, start.stdout + start.stderr);
		const first = JSON.parse(start.stdout);
		const settings = await get('/settings');
		assert.equal(settings.status, 200);
		assert.match(await settings.text(), /Enable password login/);
		const initialDb = await readFile(join(root, 'saturday.db'));
		const enabled = await post('/settings?/password', {
			operation: 'enable',
			password,
			confirm_password: password
		});
		assert.equal(enabled.status, 303);
		const loginCookies = enabled.headers
			.getSetCookie()
			.filter((v) => v.startsWith('saturday-login-'));
		assert.equal(loginCookies.length, 1);
		assert.match(loginCookies[0], /HttpOnly/i);
		assert.ok(!/Expires=|Max-Age=/i.test(loginCookies[0]));
		assert.equal((await get('/settings')).status, 200);
		for (const path of [
			'/jobs',
			'/jobs/__data.json',
			'/api/documents',
			'/api/files/1',
			'/settings/backups/1',
			'/settings/files/1',
			'/extensions',
			'/extensions/import',
			'/profile'
		]) {
			const denied = await get(path, b, 'application/json');
			assert.equal(denied.status, 401, path);
			assert.equal(denied.headers.get('cache-control'), 'no-store');
		}
		const nav = await get('/jobs', b);
		assert.equal(nav.status, 303);
		assert.match(nav.headers.get('location'), /^\/signin\?next=/);
		const deniedWrite = await post(
			'/jobs/new',
			{ job_title: 'Must not save', company_name: 'Anonymous' },
			b,
			{ 'x-sveltekit-action': 'true' }
		);
		assert.equal(deniedWrite.status, 401);
		assert.equal((await deniedWrite.json()).auth_required, true);
		assert.equal(
			(await post('/signin', { password }, b, { origin: 'https://elsewhere.test' })).status,
			403
		);
		assert.equal((await post('/signin', { password: 'wrong password' }, b)).status, 400);
		assert.equal((await post('/signin', { password }, b)).status, 303);
		assert.equal((await get('/settings', b)).status, 200);
		const protectedHtml = await (await get('/settings')).text();
		assert.ok(
			!protectedHtml.includes(JSON.parse(await readFile(join(root, 'access.json'))).password.hash)
		);
		assert.equal(
			(await get('/health', jar(), 'application/json')).status,
			200,
			'local identity readiness survives a cleared session'
		);
		assert.equal(
			(await post('/settings?/password', { operation: 'timeout', no_expiration: 'on' })).status,
			303
		);
		assert.equal(JSON.parse(await readFile(join(root, 'access.json'))).idle_timeout_seconds, null);
		const bCookie = b.clone();
		assert.equal((await post('/settings?/logout', {})).status, 303);
		assert.equal((await get('/jobs', a, 'application/json')).status, 401);
		assert.equal((await get('/jobs', b)).status, 200);
		assert.equal((await post('/signin', { password })).status, 303);
		assert.equal((await post('/settings?/logout', { all: 'true' })).status, 400);
		assert.equal((await post('/settings?/logout', { all: 'true', confirm: 'true' })).status, 303);
		assert.equal(
			(await fetch(base + '/jobs', { headers: { cookie: bCookie, accept: 'application/json' } }))
				.status,
			401
		);
		assert.equal((await post('/signin', { password })).status, 303);
		assert.equal((await post('/signin', { password }, b)).status, 303);
		const nextPassword = 'replacement private password';
		assert.equal(
			(
				await post('/settings?/password', {
					operation: 'change',
					current_password: password,
					password: nextPassword,
					confirm_password: nextPassword
				})
			).status,
			303
		);
		assert.equal((await get('/jobs', b, 'application/json')).status, 401);
		assert.equal((await get('/jobs')).status, 200);
		const protectedSettings = await readFile(join(root, 'access.json'), 'utf8');
		assert.equal(
			(
				await post(
					'/settings?/password',
					{
						operation: 'disable',
						current_password: nextPassword,
						confirm: 'true'
					},
					jar()
				)
			).status,
			401,
			'a signed-out browser cannot use disable as password recovery'
		);
		assert.equal(
			(
				await post(
					'/settings?/password',
					{
						operation: 'disable',
						current_password: nextPassword,
						confirm: 'true'
					},
					a,
					{ origin: 'https://elsewhere.test' }
				)
			).status,
			403
		);
		for (const fields of [
			{ current_password: 'wrong', confirm: 'true' },
			{ current_password: nextPassword }
		]) {
			const disabled = await post('/settings?/password', {
				operation: 'disable',
				...fields
			});
			assert.equal(
				disabled.status,
				400,
				'disabling requires the current password and confirmation'
			);
		}
		assert.equal(await readFile(join(root, 'access.json'), 'utf8'), protectedSettings);
		assert.equal((await get('/jobs', jar(), 'application/json')).status, 401);
		assert.ok((await (await get('/settings')).text()).includes('id="disable-password"'));
		const oldLogin = a.clone();
		assert.equal(
			(
				await post('/settings?/password', {
					operation: 'disable',
					current_password: nextPassword,
					confirm: 'true'
				})
			).status,
			303
		);
		assert.equal(JSON.parse(await readFile(join(root, 'access.json'))).password, null);
		assert.equal((await get('/jobs', jar())).status, 200);
		assert.equal(
			(
				await post('/settings?/password', {
					operation: 'enable',
					password: nextPassword,
					confirm_password: nextPassword
				})
			).status,
			303
		);
		assert.equal(
			(await fetch(base + '/jobs', { headers: { cookie: oldLogin, accept: 'application/json' } }))
				.status,
			401,
			'old sessions remain revoked after re-enabling protection'
		);
		await get('/settings');
		const beforeRestart = a.clone();
		assert.equal((await post('/settings?/serverControl', { operation: 'restart' })).status, 200);
		await waitFor(
			async () =>
				(await (await fetch(base + '/health')).json()).server_generation !== first.generation
		);
		assert.equal(
			(
				await fetch(base + '/jobs', {
					headers: { cookie: beforeRestart, accept: 'application/json' }
				})
			).status,
			401
		);
		assert.equal((await post('/signin', { password: nextPassword })).status, 303);
		const timeout = await run('scripts/access.mjs', ['timeout', '--hours', '2'], env);
		assert.equal(timeout.code, 0, timeout.stdout + timeout.stderr);
		assert.equal(JSON.parse(timeout.stdout).server_stopped, true);
		assert.equal(JSON.parse(await readFile(join(root, 'access.json'))).idle_timeout_seconds, 7200);
		const independentWeb = join(root, 'extensions', 'processes', `${process.pid}.json`);
		await writeFile(independentWeb, JSON.stringify({ pid: process.pid, role: 'web' }));
		const refused = await run('scripts/access.mjs', ['timeout', '--hours', '3'], env);
		assert.equal(refused.code, 1);
		assert.match(refused.stdout, /independently launched/);
		assert.equal(JSON.parse(await readFile(join(root, 'access.json'))).idle_timeout_seconds, 7200);
		await rm(independentWeb);
		assert.equal((await run('scripts/start.mjs', ['--background', '--json'], env)).code, 0);
		const beforeUnconfirmed = await readFile(join(root, 'access.json'), 'utf8');
		const unconfirmed = await run('scripts/access.mjs', ['disable'], env);
		assert.equal(unconfirmed.code, 1);
		assert.equal(await readFile(join(root, 'access.json'), 'utf8'), beforeUnconfirmed);
		const disabled = await run('scripts/access.mjs', ['disable', '--confirm'], env);
		assert.equal(disabled.code, 0, disabled.stdout + disabled.stderr);
		assert.equal(JSON.parse(disabled.stdout).server_stopped, true);
		assert.equal(JSON.parse(disabled.stdout).password_enabled, false);
		assert.equal((await run('scripts/start.mjs', ['--background', '--json'], env)).code, 0);
		assert.equal((await get('/jobs', jar())).status, 200);
		assert.equal(
			(
				await post('/settings?/password', {
					operation: 'enable',
					password,
					confirm_password: password
				})
			).status,
			303
		);
		const recovered = await run('scripts/access.mjs', ['recover', '--confirm'], env);
		assert.equal(recovered.code, 0, recovered.stdout + recovered.stderr);
		assert.equal(JSON.parse(recovered.stdout).password_enabled, false);
		assert.ok(!recovered.stdout.includes(password));
		assert.deepEqual(
			await readFile(join(root, 'saturday.db')),
			initialDb,
			'authentication/recovery do not mutate the career database'
		);
	} catch (error) {
		console.error(
			await readFile(join(root, 'logs/server.log'), 'utf8').catch(() => 'No server log')
		);
		throw error;
	} finally {
		await stopLegacy();
		await stop().catch(() => {});
		await rm(root, { recursive: true, force: true });
	}
});
