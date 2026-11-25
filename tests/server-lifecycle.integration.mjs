import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { withServerActivity } from '../src/lib/server/server-lifecycle.js';
import { connectedClients } from '../src/lib/server/installation-operations.js';
import { inspectProcessLeases } from '../src/lib/server/process-leases.js';
import { getInstallation } from '../src/lib/server/installation.js';
import { waitForCondition, waitForValue } from './helpers/wait-for.mjs';
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
async function waitForConnectedClients(
	config,
	expected,
	label,
	{ timeoutMs = 10000, stableMs = 0 } = {}
) {
	const count = await waitForValue(
		label,
		() => connectedClients(config),
		(seen) => seen === expected,
		{
			timeoutMs,
			intervalMs: 100,
			describe: async (seen) => ({
				connectedClients: seen,
				leases: (await inspectProcessLeases(config, { includeSelf: false })).entries
			})
		}
	);
	assert.equal(count, expected, label);
	if (stableMs > 0) {
		assert.equal(await connectedClients(config), expected, `${label} (immediate check)`);
		await new Promise((res) => setTimeout(res, stableMs));
		assert.equal(await connectedClients(config), expected, `${label} (after ${stableMs}ms)`);
	}
}
async function waitForGenuineLease(config, pid, role, label) {
	await waitForCondition(
		label,
		async () => {
			const inspected = await inspectProcessLeases(config, { includeSelf: false });
			return inspected.entries.some(
				(e) => e.pid === pid && e.status === 'genuine' && e.role === role
			);
		},
		{
			timeoutMs: 10000,
			intervalMs: 100,
			describe: async () => (await inspectProcessLeases(config, { includeSelf: false })).entries
		}
	);
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
	const other = createHttpServer((request, response) => {
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
		const inspectedInitial = await inspectProcessLeases(getInstallation(), { includeSelf: false });
		const webLease = inspectedInitial.entries.find(
			(entry) => entry.status === 'genuine' && entry.role === 'web'
		);
		assert.ok(webLease, 'owned web server publishes v2 lease');
		assert.equal(
			await connectedClients(getInstallation()),
			0,
			'live web lease excluded from assistant count'
		);
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

		// Settings notice distinguishes unverified unknown leases from genuine MCP leases.
		const checkPath = join(
			dirname(env.SATURDAY_INSTALLATION_PATH),
			'installation.state',
			'check.json'
		);
		await mkdir(dirname(checkPath), { recursive: true });
		await writeFile(
			checkPath,
			JSON.stringify({
				format: 'saturday.update-check',
				version: 1,
				id: '11111111-1111-4111-8111-111111111111',
				installation_id: first.installation_id,
				checked_at: new Date().toISOString(),
				local: { dirty: false },
				target: {
					kind: 'development',
					commit: 'e'.repeat(40),
					available: true,
					url: 'https://example.invalid/commit'
				}
			})
		);
		const unknownSleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
			stdio: 'ignore'
		});
		await new Promise((res) => unknownSleeper.once('spawn', res));
		const unknownLeasePath = join(
			root,
			'data',
			'extensions',
			'processes',
			`${unknownSleeper.pid}.json`
		);
		await writeFile(unknownLeasePath, '{corrupt');
		try {
			const unverifiedHtml = await (await fetch(`${first.url}/settings`)).text();
			assert.ok(unverifiedHtml.includes('Assistant connection unverified'));
			assert.ok(unverifiedHtml.includes('Could not verify whether an assistant is connected'));
			assert.ok(unverifiedHtml.includes(String(unknownSleeper.pid)));
			assert.ok(unverifiedHtml.includes(unknownLeasePath));
			assert.equal(unverifiedHtml.includes('An assistant is connected to Saturday'), false);
		} finally {
			unknownSleeper.kill('SIGKILL');
			await new Promise((res) => unknownSleeper.once('exit', res));
			await rm(unknownLeasePath, { force: true });
		}
		const previewMcp = spawn(process.execPath, ['build/mcp/index.js'], {
			env,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		const previewMcpLeasePath = join(
			root,
			'data',
			'extensions',
			'processes',
			`${previewMcp.pid}.json`
		);
		try {
			await waitFor(async () => existsSync(previewMcpLeasePath));
			const connectedHtml = await (await fetch(`${first.url}/settings`)).text();
			assert.ok(connectedHtml.includes('Assistant connected'));
			assert.ok(connectedHtml.includes('An assistant is connected to Saturday'));
		} finally {
			previewMcp.kill('SIGTERM');
			await new Promise((res) => previewMcp.once('exit', res));
			await rm(checkPath, { force: true });
		}

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
		assert.equal(
			(await inspectProcessLeases(getInstallation(), { includeSelf: false })).entries.some(
				(entry) => entry.status === 'genuine' && entry.role === 'web'
			),
			false,
			'owned web stop removes its v2 lease'
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
							id: 3,
							method: 'tools/call',
							params: { name: 'get_saturday_info', arguments: {} }
						}) + '\n'
					);
				}
				if (message.id === 3) {
					try {
						assert.notEqual(message.result.isError, true);
						const info = JSON.parse(message.result.content[0].text);
						assert.equal(info.installation_id, first.installation_id);
						assert.ok(html.includes(info.dataset_id));
						assert.ok(html.includes(info.build.id));
						assert.equal(info.jobs, 0);
					} catch (error) {
						clearTimeout(timeout);
						rej(error);
						return;
					}
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
		const mcpLeasePath = join(root, 'data', 'extensions', 'processes', `${mcp.pid}.json`);
		assert.equal(existsSync(mcpLeasePath), true, 'MCP process publishes v2 lease');
		const mcpLease = JSON.parse(await readFile(mcpLeasePath, 'utf8'));
		assert.equal(mcpLease.lease_version, 2);
		assert.equal(mcpLease.role, 'mcp');
		assert.equal(await connectedClients(getInstallation()), 1);
		assert.equal(stderr.includes(mcpLease.secret), false, 'secret is never logged to stderr');
	} finally {
		if (mcp) {
			mcp.kill('SIGTERM');
			await new Promise((res) => mcp.once('close', res));
			assert.equal(
				existsSync(join(root, 'data', 'extensions', 'processes', `${mcp.pid}.json`)),
				false,
				'MCP SIGTERM removes its v2 lease'
			);
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

test('production MCP EOF/SIGINT/SIGKILL and web SIGINT/forced-timeout shutdown honor process lease lifetime', async () => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-lease-lifecycle-'));
	const env = {
		...process.env,
		SATURDAY_PROJECT_ROOT: resolve('.'),
		SATURDAY_DB_PATH: join(root, 'data', 'saturday.db'),
		SATURDAY_FILES_PATH: join(root, 'data', 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'data', 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'extension-code'),
		SATURDAY_INSTALLATION_PATH: ''
	};
	const prior = { ...process.env };
	const children = [];
	try {
		const setup = await run(
			'scripts/setup.mjs',
			['--skip-dependencies', '--skip-build', '--skip-pdf', '--json'],
			env
		);
		assert.equal(setup.status, 0, setup.stderr + setup.stdout);
		env.SATURDAY_INSTALLATION_PATH = JSON.parse(setup.stdout).descriptor_path;
		Object.assign(process.env, env);
		const config = getInstallation();
		const leasesDir = join(config.extension_state, 'processes');

		// 1. Built MCP stdin EOF triggers exit hook and removes lease without leaking secret on stdout.
		const mcpEof = spawn(process.execPath, ['build/mcp/index.js'], {
			env,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		children.push(mcpEof);
		let mcpOut = '';
		mcpEof.stdout.on('data', (d) => (mcpOut += d));
		const eofLeasePath = join(leasesDir, `${mcpEof.pid}.json`);
		await waitFor(async () => existsSync(eofLeasePath));
		const eofLease = JSON.parse(await readFile(eofLeasePath, 'utf8'));
		await waitForConnectedClients(config, 1, 'MCP EOF connected client count to be 1');
		mcpEof.stdin.end();
		const eofExit = await new Promise((res) => mcpEof.once('exit', res));
		assert.equal(eofExit, 0);
		assert.equal(existsSync(eofLeasePath), false, 'MCP EOF removes its lease');
		assert.equal(mcpOut.includes(eofLease.secret), false);

		// 1b. Built MCP SIGINT triggers exit handler (130) and removes its v2 lease.
		const mcpInt = spawn(process.execPath, ['build/mcp/index.js'], {
			env,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		children.push(mcpInt);
		const intLeasePath = join(leasesDir, `${mcpInt.pid}.json`);
		await waitFor(async () => existsSync(intLeasePath));
		await waitForConnectedClients(config, 1, 'MCP SIGINT connected client count to be 1');
		mcpInt.kill('SIGINT');
		const intExit = await new Promise((res) => mcpInt.once('exit', res));
		assert.equal(intExit, 130);
		assert.equal(existsSync(intLeasePath), false, 'MCP SIGINT removes its v2 lease');
		await waitForConnectedClients(config, 0, 'MCP SIGINT connected client count to return to 0');

		// 2. Built MCP SIGKILL leaves crash debris, which is ignored on death and synthetic PID reuse.
		const mcpKill = spawn(process.execPath, ['build/mcp/index.js'], {
			env,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		children.push(mcpKill);
		const killLeasePath = join(leasesDir, `${mcpKill.pid}.json`);
		await waitFor(async () => existsSync(killLeasePath));
		mcpKill.kill('SIGKILL');
		await new Promise((res) => mcpKill.once('exit', res));
		assert.equal(existsSync(killLeasePath), true, 'SIGKILL leaves crash lease file');
		await waitForConnectedClients(config, 0, 'dead SIGKILL lease is ignored', {
			timeoutMs: 3000,
			stableMs: 300
		});
		const killLease = JSON.parse(await readFile(killLeasePath, 'utf8'));
		const reusedSleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
			stdio: 'ignore'
		});
		children.push(reusedSleeper);
		await new Promise((res) => reusedSleeper.once('spawn', res));
		await writeFile(
			join(leasesDir, `${reusedSleeper.pid}.json`),
			JSON.stringify({ ...killLease, pid: reusedSleeper.pid })
		);
		await waitForConnectedClients(config, 0, 'synthetic PID reuse with dead endpoint is ignored', {
			timeoutMs: 3000,
			stableMs: 300
		});

		// 3. Production web forced-timeout SIGTERM branch (7s) removes its own v2 lease.
		const probePort = createHttpServer();
		await new Promise((res) => probePort.listen(0, '127.0.0.1', res));
		const webPort = probePort.address().port;
		await new Promise((res) => probePort.close(res));

		const webProc = spawn(process.execPath, ['scripts/web.mjs'], {
			env: { ...env, PORT: String(webPort) },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		children.push(webProc);
		let webOut = '';
		webProc.stdout.on('data', (d) => (webOut += d));
		await waitFor(async () => webOut.includes('Listening on'));
		const webLeasePath = join(leasesDir, `${webProc.pid}.json`);
		await waitFor(async () => existsSync(webLeasePath));
		await waitForGenuineLease(config, webProc.pid, 'web', 'web forced-timeout genuine v2 lease');
		// Hold an active (incomplete) HTTP request so server.closeIdleConnections() cannot drain it
		// and the 7s forced-timeout branch in scripts/web.mjs runs.
		const heldSocket = connect({ host: '127.0.0.1', port: webPort });
		heldSocket.on('error', () => {});
		await new Promise((res) => heldSocket.once('connect', res));
		heldSocket.write('GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n');
		await new Promise((res) => setTimeout(res, 100));
		const stopStarted = Date.now();
		webProc.kill('SIGTERM');
		const webExit = await new Promise((res) => webProc.once('exit', res));
		const elapsed = Date.now() - stopStarted;
		heldSocket.destroy();
		assert.equal(webExit, 0);
		assert.ok(elapsed >= 6500, `expected forced-timeout shutdown (>=6500ms), got ${elapsed}ms`);
		assert.equal(existsSync(webLeasePath), false, 'web forced-timeout branch removes v2 lease');

		// 4. Production web SIGINT shutdown removes its own v2 lease.
		const probeIntPort = createHttpServer();
		await new Promise((res) => probeIntPort.listen(0, '127.0.0.1', res));
		const webIntPort = probeIntPort.address().port;
		await new Promise((res) => probeIntPort.close(res));

		const webIntProc = spawn(process.execPath, ['scripts/web.mjs'], {
			env: { ...env, PORT: String(webIntPort) },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		children.push(webIntProc);
		let webIntOut = '';
		webIntProc.stdout.on('data', (d) => (webIntOut += d));
		await waitFor(async () => webIntOut.includes('Listening on'));
		const webIntLeasePath = join(leasesDir, `${webIntProc.pid}.json`);
		await waitFor(async () => existsSync(webIntLeasePath));
		await waitForGenuineLease(config, webIntProc.pid, 'web', 'web SIGINT genuine v2 lease');
		webIntProc.kill('SIGINT');
		const webIntExit = await new Promise((res) => webIntProc.once('exit', res));
		assert.equal(webIntExit, 0);
		assert.equal(existsSync(webIntLeasePath), false, 'web SIGINT shutdown removes v2 lease');
	} finally {
		for (const child of children) {
			if (child && child.exitCode === null && child.signalCode === null) {
				child.kill('SIGKILL');
				await new Promise((res) => child.once('exit', res));
			}
		}
		for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
		Object.assign(process.env, prior);
		await rm(root, { recursive: true, force: true });
	}
});
