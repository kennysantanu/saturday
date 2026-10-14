import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { withServerActivity } from '../src/lib/server/server-lifecycle.js';
const run = (script, args, env) =>
	new Promise((res, rej) => {
		const child = spawn(process.execPath, [script, ...args], {
			env,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let stdout = '',
			stderr = '';
		child.stdout.on('data', (v) => (stdout += v));
		child.stderr.on('data', (v) => (stderr += v));
		child.once('error', rej);
		child.once('close', (status) => res({ status, stdout, stderr }));
	});
const pause = () => new Promise((res) => setTimeout(res, 100));
async function waitFor(check) {
	const deadline = Date.now() + 25000;
	while (Date.now() < deadline) {
		try {
			if (await check()) return;
		} catch {}
		await pause();
	}
	throw new Error('Server transition timed out.');
}
test('owned background server reuses, handles collisions, protects active work and restarts/stops through authenticated UI', async () => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-server-'));
	const env = {
		...process.env,
		SATURDAY_PROJECT_ROOT: resolve('.'),
		SATURDAY_DB_PATH: join(root, 'data', 'saturday.db'),
		SATURDAY_FILES_PATH: join(root, 'data', 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'data', 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'extension-code'),
		SATURDAY_INSTALLATION_PATH: ''
	};
	const other = createServer((request, response) => {
		response.setHeader('content-type', 'application/json');
		response.end(JSON.stringify({ app: 'unrelated' }));
	});
	await new Promise((res) => other.listen(0, '127.0.0.1', res));
	env.PORT = String(other.address().port);
	const prior = { ...process.env };
	let mcp;
	try {
		const setup = await run(
			'scripts/setup.mjs',
			['--skip-dependencies', '--skip-build', '--skip-pdf', '--json'],
			env
		);
		assert.equal(setup.status, 0, setup.stderr + setup.stdout);
		env.SATURDAY_INSTALLATION_PATH = JSON.parse(setup.stdout).descriptor_path;
		Object.assign(process.env, env);
		const started = await run('scripts/start.mjs', ['--background', '--json'], env);
		assert.equal(started.status, 0, started.stderr + started.stdout);
		const first = JSON.parse(started.stdout);
		assert.equal(first.created, true);
		assert.notEqual(new URL(first.url).port, env.PORT);
		const reused = await run('scripts/start.mjs', ['--background', '--json'], env);
		assert.equal(reused.status, 0, reused.stderr + reused.stdout);
		assert.equal(JSON.parse(reused.stdout).created, false);
		assert.equal(JSON.parse(reused.stdout).generation, first.generation);
		assert.equal((await run('scripts/status.mjs', ['--json'], { ...env, PORT: '' })).status, 0);
		const activity = await withServerActivity(() =>
			run('scripts/start.mjs', ['restart', '--json'], env)
		);
		assert.equal(activity.status, 1);
		assert.match(activity.stdout, /data operation is running/);
		const settings = await fetch(`${first.url}/settings`);
		const cookie = settings.headers.get('set-cookie').split(';')[0];
		const html = await settings.text();
		assert.ok(html.includes('Restart server'));
		assert.ok(
			!html.includes(
				JSON.parse(await readFile(join(root, 'data', 'server.state', 'server.json'))).token
			)
		);
		const post = async (operation, headers = {}) =>
			fetch(`${first.url}/settings?/serverControl`, {
				method: 'POST',
				headers: {
					origin: first.url,
					'content-type': 'application/x-www-form-urlencoded',
					'x-sveltekit-action': 'true',
					...headers
				},
				body: new URLSearchParams({ operation, confirm: 'true' })
			});
		const unauthorized = await (await post('restart')).json();
		assert.equal(unauthorized.type, 'failure');
		assert.equal(unauthorized.status, 403);
		assert.equal(
			(await post('restart', { cookie, origin: 'https://unrelated.example' })).status,
			403
		);
		const startup = (cookieHeader) =>
			fetch(`${first.url}/settings?/loginStartup`, {
				method: 'POST',
				headers: {
					origin: first.url,
					'content-type': 'application/x-www-form-urlencoded',
					'x-sveltekit-action': 'true',
					...(cookieHeader ? { cookie: cookieHeader } : {})
				},
				body: ''
			});
		const deniedStartup = await (await startup()).json();
		assert.equal(deniedStartup.status, 403);
		const unchangedStartup = await (await startup(cookie)).json();
		assert.equal(unchangedStartup.type, 'success'); // Already disabled: no real login registration is created.
		assert.ok(html.includes('Check for updates'));
		assert.ok(html.includes('Uninstall Saturday'));
		const progress = await fetch(`${first.url}/settings/installation`, { headers: { cookie } });
		assert.equal(progress.status, 200);
		const unauthorizedInstall = await fetch(`${first.url}/settings?/installationOperation`, {
			method: 'POST',
			headers: {
				origin: first.url,
				'content-type': 'application/x-www-form-urlencoded',
				'x-sveltekit-action': 'true'
			},
			body: 'operation=uninstall&confirm=true'
		});
		assert.equal((await unauthorizedInstall.json()).status, 403);
		const staleInstall = await fetch(`${first.url}/settings?/installationOperation`, {
			method: 'POST',
			headers: {
				cookie,
				origin: first.url,
				'content-type': 'application/x-www-form-urlencoded',
				'x-sveltekit-action': 'true'
			},
			body: 'operation=update&confirm=true&check_id=unknown'
		});
		assert.equal((await staleInstall.json()).status, 409);
		const restarted = await post('restart', { cookie });
		assert.equal(restarted.status, 200);
		const response = await restarted.json();
		assert.equal(response.type, 'success');
		await waitFor(async () => {
			const health = await (await fetch(`${first.url}/health`)).json();
			return health.server_generation !== first.generation;
		});
		const updated = await fetch(`${first.url}/settings`);
		const newCookie = updated.headers.get('set-cookie').split(';')[0];
		await updated.text();
		const stopped = await post('stop', { cookie: newCookie });
		assert.equal(stopped.status, 200);
		assert.equal((await stopped.json()).type, 'success');
		await waitFor(async () => {
			const result = await run('scripts/status.mjs', ['--json'], { ...env, PORT: '' });
			return result.status === 1;
		});
		assert.equal(
			(await (await fetch(`http://127.0.0.1:${env.PORT}/health`)).json()).app,
			'unrelated'
		);
		// Real stdio MCP process stays available after the UI server stops.
		mcp = spawn(process.execPath, ['build/mcp/index.js'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
		let stderr = '';
		mcp.stderr.on('data', (v) => (stderr += v));
		const lines = createInterface({ input: mcp.stdout });
		const result = await new Promise((res, rej) => {
			const timeout = setTimeout(() => rej(new Error('MCP timed out: ' + stderr)), 10000);
			lines.on('line', (line) => {
				const message = JSON.parse(line);
				if (message.id === 1) {
					mcp.stdin.write(
						JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
					);
					mcp.stdin.write(
						JSON.stringify({
							jsonrpc: '2.0',
							id: 2,
							method: 'tools/call',
							params: {
								name: 'create_job',
								arguments: { job_title: 'MCP without UI', company_name: 'Example' }
							}
						}) + '\n'
					);
				}
				if (message.id === 2) {
					clearTimeout(timeout);
					res(message.result);
				}
			});
			mcp.once('error', rej);
			mcp.stdin.write(
				JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'initialize',
					params: {
						protocolVersion: '2025-11-25',
						capabilities: {},
						clientInfo: { name: 'local-test', version: '1' }
					}
				}) + '\n'
			);
		});
		assert.notEqual(result.isError, true);
		assert.ok(JSON.parse(result.content[0].text).id);
	} finally {
		if (mcp) {
			mcp.kill('SIGTERM');
			await new Promise((res) => mcp.once('close', res));
		}
		await run('scripts/start.mjs', ['stop', '--json'], env);
		await waitFor(async () => {
			try {
				const record = JSON.parse(
					await readFile(join(root, 'data', 'server.state', 'server.json'))
				);
				try {
					process.kill(record.pid, 0);
					return false;
				} catch {
					return true;
				}
			} catch {
				return true;
			}
		});
		for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
		Object.assign(process.env, prior);
		await new Promise((res) => other.close(res));
		await rm(root, { recursive: true, force: true });
	}
});
