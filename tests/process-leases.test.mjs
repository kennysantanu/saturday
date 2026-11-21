import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { existsSync, lstatSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import {
	LEASE_VERSION,
	MAX_FRAME_BYTES,
	computeLeaseHmac,
	defaultProbeEndpoint,
	defaultProbePid,
	formatLeaseDiagnostic,
	inspectProcessLeases,
	registerProcessLease,
	sweepDeadLeases
} from '../src/lib/server/process-leases.js';
import {
	connectedClients,
	resetLiveData,
	listBranches,
	readSwitchExport
} from '../src/lib/server/installation-operations.js';
import {
	claimInstallationMaintenance,
	withServerActivity,
	serverPaths
} from '../src/lib/server/server-lifecycle.js';
import {
	assertExtensionProcessesStopped,
	assertWebRuntimeStopped
} from '../src/lib/server/extensions.js';

const LEASE_FIXTURES = resolve('tests/fixtures/process-leases');

async function makeTempConfig() {
	const root = await fs.mkdtemp(join(tmpdir(), 'saturday-leases-'));
	const extension_state = join(root, 'extensions');
	const config = {
		descriptor_path: join(root, 'installation.json'),
		installation_id: randomUUID(),
		code_root: resolve('.'),
		data_root: join(root, 'data'),
		database: join(root, 'data', 'saturday.db'),
		files: join(root, 'data', 'files'),
		extension_state,
		extension_code: join(root, 'extension-code'),
		extension_backups: join(root, 'extension-backups'),
		node_path: process.execPath
	};
	return { root, config, processesDir: join(extension_state, 'processes') };
}

async function getRefusedPort() {
	const server = createServer();
	await new Promise((res) => server.listen(0, '127.0.0.1', res));
	const { port } = server.address();
	await new Promise((res) => server.close(res));
	return port;
}

function spawnSleeper() {
	const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
		stdio: 'ignore'
	});
	return new Promise((res, rej) => {
		child.once('spawn', () => res(child));
		child.once('error', rej);
	});
}

async function stopChild(child) {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	child.kill('SIGKILL');
	await new Promise((res) => child.once('exit', res));
}

function spawnRegisteredRuntime(config, role = 'mcp', mode = 'stay') {
	const moduleUrl = new URL('../src/lib/server/process-leases.js', import.meta.url).href;
	const script = `
		import { registerProcessLease } from ${JSON.stringify(moduleUrl)};
		const config = JSON.parse(process.argv[1]);
		const role = process.argv[2];
		const mode = process.argv[3];
		if (mode === 'signals') {
			process.on('SIGTERM', () => process.exit(143));
			process.on('SIGINT', () => process.exit(130));
		}
		const info = await registerProcessLease(config, role);
		process.stdout.write(JSON.stringify(info) + '\\n');
		if (mode === 'eof') {
			process.stdin.resume();
			process.stdin.on('end', () => {});
		} else if (mode === 'eof-pending') {
			process.stdin.resume();
			process.stdin.on('end', () => setTimeout(() => {}, 250));
		} else if (mode === 'fail-listener') {
			const reg = globalThis[Symbol.for('saturday.processLeases.registry.v1')];
			const entry = [...reg.entries.values()][0];
			entry.server.emit('error', new Error('simulated listener failure'));
		} else {
			setInterval(() => {}, 60000);
		}
	`;
	const child = spawn(
		process.execPath,
		['--input-type=module', '-e', script, JSON.stringify(config), role, mode],
		{ stdio: ['pipe', 'pipe', 'pipe'] }
	);
	return new Promise((res, rej) => {
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => {
			stopChild(child);
			rej(new Error(`Timed out waiting for child lease registration: ${stderr}`));
		}, 10000);
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
			const nl = stdout.indexOf('\n');
			if (nl !== -1) {
				clearTimeout(timer);
				res({ child, info: JSON.parse(stdout.slice(0, nl)), stderr: () => stderr });
			}
		});
		child.once('error', (err) => {
			clearTimeout(timer);
			rej(err);
		});
		child.once('exit', (code) => {
			if (stdout.indexOf('\n') === -1) {
				clearTimeout(timer);
				rej(new Error(`Child exited early (${code}): ${stderr}`));
			}
		});
	});
}

test('importing process-leases and installation-operations does not initialize SQLite', async () => {
	const { root, config } = await makeTempConfig();
	try {
		const res = await inspectProcessLeases(config);
		assert.deepEqual(res.entries, []);
		assert.equal(existsSync(config.database), false);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('registerProcessLease binds loopback, writes 0600 v2 lease, is idempotent, and shares Symbol.for registry across duplicate module imports', async () => {
	const { root, config, processesDir } = await makeTempConfig();
	const priorExtState = process.env.SATURDAY_EXTENSION_STATE_PATH;
	try {
		const first = await registerProcessLease(config, 'mcp');
		assert.equal(first.pid, process.pid);
		assert.equal(first.role, 'mcp');
		assert.equal(first.lease_version, LEASE_VERSION);
		assert.ok(Number.isInteger(first.identity_port) && first.identity_port > 0);
		assert.equal('secret' in first, false, 'public registration never exposes secret');

		const raw = JSON.parse(readFileSync(first.path, 'utf8'));
		assert.equal(raw.pid, process.pid);
		assert.equal(raw.role, 'mcp');
		assert.equal(raw.lease_version, 2);
		assert.equal(raw.instance_id, first.instance_id);
		assert.equal(raw.identity_port, first.identity_port);
		assert.match(raw.secret, /^[0-9a-f]{64}$/);
		if (process.platform !== 'win32') {
			assert.equal(statSync(first.path).mode & 0o777, 0o600);
		}

		// Duplicate module import shares the Symbol.for registry and exit hook.
		const duplicateModule = await import(`../src/lib/server/process-leases.js?dup=${Date.now()}`);
		const exitListenersBefore = process.listenerCount('exit');
		const second = await duplicateModule.registerProcessLease(config, 'mcp');
		assert.equal(second.instance_id, first.instance_id);
		assert.equal(second.identity_port, first.identity_port);
		assert.equal(process.listenerCount('exit'), exitListenersBefore);

		// Role update retains identity_port, instance_id, and secret.
		const updated = await duplicateModule.registerProcessLease(config, 'web');
		assert.equal(updated.role, 'web');
		assert.equal(updated.instance_id, first.instance_id);
		assert.equal(updated.identity_port, first.identity_port);
		const rawUpdated = JSON.parse(readFileSync(first.path, 'utf8'));
		assert.equal(rawUpdated.secret, raw.secret);
		assert.equal(rawUpdated.role, 'web');

		// Inspection proves genuine self lease and never leaks secret.
		const inspected = await inspectProcessLeases(config, { includeSelf: true });
		assert.equal(inspected.entries.length, 1);
		assert.equal(inspected.entries[0].status, 'genuine');
		assert.equal(inspected.entries[0].role, 'web');
		assert.equal('secret' in inspected.entries[0], false);
		assert.equal(JSON.stringify(inspected).includes(raw.secret), false);

		// Ensure processesDir has exactly one file.
		assert.deepEqual(await fs.readdir(processesDir), [`${process.pid}.json`]);
	} finally {
		const reg = globalThis[Symbol.for('saturday.processLeases.registry.v1')];
		const entry = reg?.entries.get(resolve(config.extension_state));
		if (entry) {
			entry.closing = true;
			await new Promise((res) => (entry.server ? entry.server.close(res) : res()));
			reg.entries.delete(resolve(config.extension_state));
		}
		if (priorExtState === undefined) delete process.env.SATURDAY_EXTENSION_STATE_PATH;
		else process.env.SATURDAY_EXTENSION_STATE_PATH = priorExtState;
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('startup publication failure after listen cleans up listener, clears registry, and allows healthy retry', async () => {
	const { root, config, processesDir } = await makeTempConfig();
	const stateDir = resolve(config.extension_state);
	const reg = globalThis[Symbol.for('saturday.processLeases.registry.v1')];
	try {
		// 1. Pre-listen non-directory processes path still rejects before binding.
		await fs.mkdir(config.extension_state, { recursive: true });
		await fs.writeFile(processesDir, 'not a directory');
		await assert.rejects(registerProcessLease(config, 'mcp'), /Unsafe process lease directory/);
		assert.equal(reg?.entries.has(stateDir), false);
		await fs.rm(processesDir, { force: true });

		// 2. Publication failure AFTER listener bind closes listener, clears registry, and allows healthy retry.
		let capturedPort = null;
		await assert.rejects(
			registerProcessLease(config, 'mcp', {
				writeLease: async (_leasePath, record) => {
					capturedPort = record.identity_port;
					throw new Error('simulated atomic write failure');
				}
			}),
			/simulated atomic write failure/
		);
		assert.ok(
			Number.isInteger(capturedPort) && capturedPort > 0,
			'listener bound before publication'
		);
		assert.equal(reg?.entries.has(stateDir), false, 'registry entry removed on rollback');
		assert.equal(existsSync(join(processesDir, `${process.pid}.json`)), false);
		await assert.rejects(
			new Promise((res, rej) => {
				const sock = connect({ host: '127.0.0.1', port: capturedPort });
				sock.once('connect', () => {
					sock.destroy();
					res();
				});
				sock.once('error', rej);
			}),
			(err) => err.code === 'ECONNREFUSED',
			'rolled-back listener must no longer be bound'
		);

		// Healthy retry succeeds on the same stateDir.
		const recovered = await registerProcessLease(config, 'mcp');
		assert.equal(recovered.pid, process.pid);
		assert.equal(recovered.role, 'mcp');
		assert.equal(existsSync(recovered.path), true);
		const inspected = await inspectProcessLeases(config, { includeSelf: true });
		assert.equal(inspected.entries.length, 1);
		assert.equal(inspected.entries[0].status, 'genuine');
	} finally {
		const entry = reg?.entries.get(stateDir);
		if (entry) {
			entry.closing = true;
			await new Promise((res) => (entry.server ? entry.server.close(res) : res()));
			reg.entries.delete(stateDir);
		}
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('unexpected listener failure terminates runtime with nonzero exit status', async () => {
	const { root, config } = await makeTempConfig();
	let child;
	try {
		const spawned = await spawnRegisteredRuntime(config, 'mcp', 'fail-listener');
		child = spawned.child;
		const code = await new Promise((res) => child.once('exit', (c) => res(c)));
		assert.notEqual(code, 0);
	} finally {
		await stopChild(child);
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('classifications: unrelated live PID, dead PID, genuine runtime, web role, endpoint reuse, and protocol errors', async () => {
	const { root, config, processesDir } = await makeTempConfig();
	const children = [];
	const servers = [];
	try {
		await fs.mkdir(processesDir, { recursive: true });
		const sleeper = await spawnSleeper();
		children.push(sleeper);
		const refusedPort = await getRefusedPort();

		// 1. Stale v2 lease naming an unrelated live PID with refused endpoint -> stale (not counted, not deleted)
		const stalePath = join(processesDir, `${sleeper.pid}.json`);
		await fs.writeFile(
			stalePath,
			JSON.stringify({
				pid: sleeper.pid,
				role: 'mcp',
				lease_version: 2,
				instance_id: randomUUID(),
				secret: randomBytes(32).toString('hex'),
				identity_port: refusedPort
			})
		);

		// 3. Atomic temp filename -> ignored completely
		await fs.writeFile(join(processesDir, `${sleeper.pid}.json.${randomUUID()}.tmp`), '{}');

		// 4. Genuine live assistant child -> counted
		const mcpChild = await spawnRegisteredRuntime(config, 'mcp', 'stay');
		children.push(mcpChild.child);

		// 5. Genuine live web child -> excluded from assistant count
		const webChild = await spawnRegisteredRuntime(config, 'web', 'stay');
		children.push(webChild.child);

		// 4b. Dead PID lease -> inspected as dead, and left in place by the reader.
		// Written after registration on purpose: a runtime sweeps provably dead leases when it
		// registers, so a fixture created earlier would be gone before this inspection.
		const deadPid = 99999999;
		const deadPath = join(processesDir, `${deadPid}.json`);
		await fs.writeFile(
			deadPath,
			JSON.stringify({
				pid: deadPid,
				role: 'mcp',
				lease_version: 2,
				instance_id: randomUUID(),
				secret: '0'.repeat(64),
				identity_port: refusedPort
			})
		);

		const inspected = await inspectProcessLeases(config, {
			probePid: (pid) => (pid === deadPid ? 'dead' : 'alive')
		});
		const byName = Object.fromEntries(inspected.entries.map((e) => [e.name, e]));
		assert.equal(byName[`${sleeper.pid}.json`].status, 'stale');
		assert.equal(byName[`${sleeper.pid}.json`].reason, 'connection_refused');
		assert.equal(byName[`${deadPid}.json`].status, 'dead');
		assert.equal(byName[`${mcpChild.child.pid}.json`].status, 'genuine');
		assert.equal(byName[`${mcpChild.child.pid}.json`].role, 'mcp');
		assert.equal(byName[`${webChild.child.pid}.json`].status, 'genuine');
		assert.equal(byName[`${webChild.child.pid}.json`].role, 'web');
		assert.equal(
			Object.keys(byName).some((n) => n.endsWith('.tmp')),
			false
		);

		// Repeated reads leave dead/stale files intact and never delete them.
		assert.equal(existsSync(stalePath), true);
		assert.equal(existsSync(deadPath), true);

		// Endpoint reuse: same PID/port, different instance_id or secret -> stale
		const oldRecord = JSON.parse(
			readFileSync(join(processesDir, `${mcpChild.child.pid}.json`), 'utf8')
		);
		const mismatchedInstance = await defaultProbeEndpoint({
			port: oldRecord.identity_port,
			pid: oldRecord.pid,
			instance_id: randomUUID(),
			secret: oldRecord.secret
		});
		assert.equal(mismatchedInstance.status, 'stale');
		assert.equal(mismatchedInstance.reason, 'identity_mismatch');

		const mismatchedSecret = await defaultProbeEndpoint({
			port: oldRecord.identity_port,
			pid: oldRecord.pid,
			instance_id: oldRecord.instance_id,
			secret: 'f'.repeat(64)
		});
		assert.equal(mismatchedSecret.status, 'stale');
		assert.equal(mismatchedSecret.reason, 'proof_mismatch');

		// Malformed, truncated, oversized, and timed-out TCP servers -> unknown
		for (const behavior of ['malformed', 'truncated', 'oversized', 'timeout']) {
			const srv = createServer((sock) => {
				sock.once('data', () => {
					if (behavior === 'malformed') sock.end('not-json\n');
					else if (behavior === 'truncated') sock.end('{"v":2');
					else if (behavior === 'oversized') sock.end('x'.repeat(MAX_FRAME_BYTES + 10) + '\n');
					// timeout: leave socket open without replying
				});
			});
			await new Promise((res) => srv.listen(0, '127.0.0.1', res));
			servers.push(srv);
			const port = srv.address().port;
			const probe = await defaultProbeEndpoint(
				{ port, pid: sleeper.pid, instance_id: randomUUID(), secret: 'a'.repeat(64) },
				{ timeoutMs: 60 }
			);
			assert.equal(
				probe.status,
				'unknown',
				`expected unknown for ${behavior}, got ${JSON.stringify(probe)}`
			);
		}

		// EPERM from probeEndpoint -> unknown
		const epermInspect = await inspectProcessLeases(config, {
			probePid: (pid) => (pid === deadPid ? 'dead' : 'alive'),
			probeEndpoint: async () => ({ status: 'unknown', reason: 'probe_error:EPERM' })
		});
		const sleeperEntry = epermInspect.entries.find((e) => e.pid === sleeper.pid);
		assert.equal(sleeperEntry.status, 'unknown');
		assert.equal(sleeperEntry.role, null);
		assert.match(formatLeaseDiagnostic(sleeperEntry), /EPERM/);
	} finally {
		for (const srv of servers) await new Promise((res) => srv.close(() => res()));
		for (const child of children) await stopChild(child);
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('EPERM from probePid returns unknown immediately before reading body or probing endpoint, and all readers block/count it', async () => {
	const { root, config, processesDir } = await makeTempConfig();
	const prior = { ...process.env };
	const children = [];
	try {
		Object.assign(process.env, {
			SATURDAY_INSTALLATION_PATH: '',
			SATURDAY_PROJECT_ROOT: config.code_root,
			SATURDAY_DB_PATH: config.database,
			SATURDAY_FILES_PATH: config.files,
			SATURDAY_EXTENSION_STATE_PATH: config.extension_state,
			SATURDAY_EXTENSIONS_PATH: config.extension_code
		});
		await fs.mkdir(processesDir, { recursive: true });

		// 1. Refused endpoint + probePid returning 'eperm' -> unknown (never stale), probeEndpoint never called.
		const refusedPort = await getRefusedPort();
		const refusedPid = 41001;
		const refusedPath = join(processesDir, `${refusedPid}.json`);
		await fs.writeFile(
			refusedPath,
			JSON.stringify({
				pid: refusedPid,
				role: 'mcp',
				lease_version: 2,
				instance_id: randomUUID(),
				secret: randomBytes(32).toString('hex'),
				identity_port: refusedPort
			})
		);

		let probeCalls = 0;
		const refusedInspect = await inspectProcessLeases(config, {
			probePid: () => 'eperm',
			probeEndpoint: async () => {
				probeCalls++;
				return { status: 'stale', reason: 'connection_refused' };
			}
		});
		assert.equal(probeCalls, 0, 'EPERM must return before probing endpoint');
		assert.equal(refusedInspect.entries.length, 1);
		assert.equal(refusedInspect.entries[0].status, 'unknown');
		assert.equal(refusedInspect.entries[0].reason, 'pid_permission_denied');
		assert.equal(refusedInspect.entries[0].role, null);
		assert.match(formatLeaseDiagnostic(refusedInspect.entries[0]), /permission denied probing PID/);
		assert.match(formatLeaseDiagnostic(refusedInspect.entries[0]), new RegExp(String(refusedPid)));
		assert.equal(await connectedClients(config, { probePid: () => 'eperm' }), 1);
		await assert.rejects(
			assertWebRuntimeStopped({ probePid: () => 'eperm' }),
			(err) => err.code === 'RUNNING' && err.message.includes(String(refusedPid))
		);
		await assert.rejects(
			assertExtensionProcessesStopped({ probePid: () => 'eperm' }),
			(err) => err.code === 'RUNNING' && err.message.includes(String(refusedPid))
		);

		// 2. Matching-looking live v2 'web' endpoint + probePid returning 'eperm' -> still unknown & counted, proving early return.
		await fs.rm(refusedPath);
		const webChild = await spawnRegisteredRuntime(config, 'web', 'stay');
		children.push(webChild.child);
		assert.equal(
			await connectedClients(config),
			0,
			'verified live web lease is excluded when alive'
		);

		let matchingProbeCalls = 0;
		const matchingInspect = await inspectProcessLeases(config, {
			probePid: () => 'eperm',
			probeEndpoint: async () => {
				matchingProbeCalls++;
				return { status: 'genuine', reason: 'verified' };
			}
		});
		assert.equal(matchingProbeCalls, 0, 'EPERM must return before body read or endpoint probe');
		assert.equal(matchingInspect.entries.length, 1);
		assert.equal(matchingInspect.entries[0].status, 'unknown');
		assert.equal(matchingInspect.entries[0].reason, 'pid_permission_denied');
		assert.equal(matchingInspect.entries[0].role, null);
		assert.equal(
			await connectedClients(config, { probePid: () => 'eperm' }),
			1,
			'EPERM on matching-looking web lease conservatively counts as blocking'
		);
		await assert.rejects(assertWebRuntimeStopped({ probePid: () => 'eperm' }), { code: 'RUNNING' });
		await assert.rejects(assertExtensionProcessesStopped({ probePid: () => 'eperm' }), {
			code: 'RUNNING'
		});
	} finally {
		for (const child of children) await stopChild(child);
		for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
		Object.assign(process.env, prior);
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('validation rejects invalid PID, port, unsupported version, symlinks, and unrecognized entries', async () => {
	const { root, config, processesDir } = await makeTempConfig();
	try {
		await fs.mkdir(processesDir, { recursive: true });
		const v2Sample = JSON.parse(readFileSync(join(LEASE_FIXTURES, 'v2-sample.json'), 'utf8'));
		const unsupportedSample = JSON.parse(
			readFileSync(join(LEASE_FIXTURES, 'unsupported-v99.json'), 'utf8')
		);

		// Invalid PID filenames
		await fs.writeFile(join(processesDir, '0.json'), JSON.stringify({ pid: 0, role: 'mcp' }));
		await fs.writeFile(join(processesDir, 'extra.json'), '{}');
		// Mismatched record PID
		await fs.writeFile(join(processesDir, '101.json'), JSON.stringify({ ...v2Sample, pid: 999 }));
		// Invalid port
		await fs.writeFile(
			join(processesDir, '102.json'),
			JSON.stringify({ ...v2Sample, pid: 102, identity_port: 70000 })
		);
		// Unsupported version (even with role: 'web', role must NOT be trusted!)
		await fs.writeFile(
			join(processesDir, '103.json'),
			JSON.stringify({ ...unsupportedSample, pid: 103 })
		);
		// Symlink lease file
		const target = join(root, 'outside.json');
		await fs.writeFile(target, JSON.stringify({ pid: 104, role: 'mcp' }));
		await fs.symlink(target, join(processesDir, '104.json'));

		const result = await inspectProcessLeases(config, {
			probePid: () => 'alive',
			probeEndpoint: async () => ({ status: 'genuine', reason: 'verified' })
		});
		const byName = Object.fromEntries(result.entries.map((e) => [e.name, e]));
		assert.equal(byName['0.json'].status, 'unknown');
		assert.equal(byName['0.json'].reason, 'unrecognized_entry');
		assert.equal(byName['extra.json'].status, 'unknown');
		assert.equal(byName['extra.json'].reason, 'unrecognized_entry');
		assert.equal(byName['101.json'].status, 'unknown');
		assert.equal(byName['101.json'].reason, 'invalid_v2_record');
		assert.equal(byName['102.json'].status, 'unknown');
		assert.equal(byName['102.json'].reason, 'invalid_v2_record');
		assert.equal(byName['103.json'].status, 'unknown');
		assert.equal(byName['103.json'].reason, 'unsupported_version');
		assert.equal(byName['103.json'].role, null);
		assert.equal(byName['104.json'].status, 'unknown');
		assert.equal(byName['104.json'].reason, 'unsafe_lease_file');
		assert.equal(result.entries.length, 6);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('ENOENT during mid-read deterministically skips vanishing lease entry and returns exact expected count', async () => {
	const { root, config, processesDir } = await makeTempConfig();
	try {
		await fs.mkdir(processesDir, { recursive: true });
		const vanishingPath = join(processesDir, '105.json');
		const stablePath = join(processesDir, '106.json');
		await fs.writeFile(vanishingPath, JSON.stringify({ pid: 105, role: 'mcp' }));
		await fs.writeFile(stablePath, JSON.stringify({ pid: 106, role: 'mcp' }));

		// 1. Synchronous unlink during probePid forces real ENOENT in fs.readFile.
		const unlinkedRes = await inspectProcessLeases(config, {
			probePid: (pid) => {
				if (pid === 105) unlinkSync(vanishingPath);
				return 'alive';
			}
		});
		assert.equal(unlinkedRes.entries.length, 1);
		assert.equal(
			unlinkedRes.entries.some((e) => e.name === '105.json'),
			false,
			'vanished entry must not appear'
		);
		assert.equal(unlinkedRes.entries[0].name, '106.json');
		assert.equal(unlinkedRes.entries[0].status, 'legacy');

		// 2. Injected readFile ENOENT seam deterministically skips the vanished entry.
		await fs.writeFile(vanishingPath, JSON.stringify({ pid: 105, role: 'mcp' }));
		const injectedRes = await inspectProcessLeases(config, {
			probePid: () => 'alive',
			readFile: async (targetPath, encoding) => {
				if (targetPath === vanishingPath) {
					throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
				}
				return fs.readFile(targetPath, encoding);
			}
		});
		assert.equal(injectedRes.entries.length, 1);
		assert.equal(
			injectedRes.entries.some((e) => e.name === '105.json'),
			false,
			'injected ENOENT entry must not appear'
		);
		assert.equal(injectedRes.entries[0].name, '106.json');
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('compatibility fixtures preserve conservative legacy role behavior without upgrading files', async () => {
	const { root, config, processesDir } = await makeTempConfig();
	const prior = { ...process.env };
	const children = [];
	try {
		Object.assign(process.env, {
			SATURDAY_INSTALLATION_PATH: '',
			SATURDAY_PROJECT_ROOT: config.code_root,
			SATURDAY_DB_PATH: config.database,
			SATURDAY_FILES_PATH: config.files,
			SATURDAY_EXTENSION_STATE_PATH: config.extension_state,
			SATURDAY_EXTENSIONS_PATH: config.extension_code
		});
		await fs.mkdir(processesDir, { recursive: true });
		const legacyMcp = JSON.parse(readFileSync(join(LEASE_FIXTURES, 'legacy-mcp.json'), 'utf8'));
		const legacyWeb = JSON.parse(readFileSync(join(LEASE_FIXTURES, 'legacy-web.json'), 'utf8'));
		const legacyUnclassified = JSON.parse(
			readFileSync(join(LEASE_FIXTURES, 'legacy-unclassified.json'), 'utf8')
		);

		const mcpSleeper = await spawnSleeper();
		const webSleeper = await spawnSleeper();
		const unclassSleeper = await spawnSleeper();
		children.push(mcpSleeper, webSleeper, unclassSleeper);

		const mcpPath = join(processesDir, `${mcpSleeper.pid}.json`);
		await fs.writeFile(mcpPath, JSON.stringify({ ...legacyMcp, pid: mcpSleeper.pid }));
		const beforeBytes = readFileSync(mcpPath, 'utf8');

		// Legacy MCP counts as client, blocks assertExtensionProcessesStopped, allowed by assertWebRuntimeStopped
		assert.equal(await connectedClients(config), 1);
		await assertWebRuntimeStopped();
		await assert.rejects(assertExtensionProcessesStopped(), { code: 'RUNNING' });
		assert.equal(readFileSync(mcpPath, 'utf8'), beforeBytes, 'legacy file is never rewritten');

		// Legacy web excluded from connectedClients, blocks assertWebRuntimeStopped and assertExtensionProcessesStopped
		await fs.rm(mcpPath);
		const webPath = join(processesDir, `${webSleeper.pid}.json`);
		await fs.writeFile(webPath, JSON.stringify({ ...legacyWeb, pid: webSleeper.pid }));
		assert.equal(await connectedClients(config), 0);
		await assert.rejects(assertWebRuntimeStopped(), /independently launched/);
		await assert.rejects(assertExtensionProcessesStopped(), { code: 'RUNNING' });

		// Legacy unclassified {pid} blocks all readers and emits PID/path diagnostic
		await fs.rm(webPath);
		const unclassPath = join(processesDir, `${unclassSleeper.pid}.json`);
		await fs.writeFile(
			unclassPath,
			JSON.stringify({ ...legacyUnclassified, pid: unclassSleeper.pid })
		);
		assert.equal(await connectedClients(config), 1);
		await assert.rejects(
			assertWebRuntimeStopped(),
			(err) => err.code === 'RUNNING' && err.message.includes(String(unclassSleeper.pid))
		);
		await assert.rejects(assertExtensionProcessesStopped(), { code: 'RUNNING' });
	} finally {
		for (const child of children) await stopChild(child);
		for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
		Object.assign(process.env, prior);
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('exit cleanup removes own lease on EOF/SIGTERM/SIGINT, preserves replaced files, and survives denied unlink', async () => {
	const { root, config, processesDir } = await makeTempConfig();
	const children = [];
	try {
		// 1. Natural EOF exit
		const eof = await spawnRegisteredRuntime(config, 'mcp', 'eof');
		children.push(eof.child);
		const eofLease = join(processesDir, `${eof.child.pid}.json`);
		assert.equal(existsSync(eofLease), true);
		eof.child.stdin.end();
		const eofCode = await new Promise((res) => eof.child.once('exit', res));
		assert.equal(eofCode, 0);
		assert.equal(existsSync(eofLease), false, 'EOF exit removes own lease');

		// 1b. EOF with pending async work retains lease protection until work drains and process exits
		const eofPending = await spawnRegisteredRuntime(config, 'mcp', 'eof-pending');
		children.push(eofPending.child);
		const pendingLease = join(processesDir, `${eofPending.child.pid}.json`);
		eofPending.child.stdin.end();
		await new Promise((res) => setTimeout(res, 60));
		assert.equal(
			existsSync(pendingLease),
			true,
			'lease retained while pending work executes after EOF'
		);
		assert.equal(await connectedClients(config), 1, 'pending work after EOF still proves identity');
		const pendingCode = await new Promise((res) => eofPending.child.once('exit', res));
		assert.equal(pendingCode, 0);
		assert.equal(
			existsSync(pendingLease),
			false,
			'lease removed once pending work finishes and process exits'
		);

		// 2. SIGTERM and SIGINT exits
		for (const [sig, expectedCode] of [
			['SIGTERM', 143],
			['SIGINT', 130]
		]) {
			const sigChild = await spawnRegisteredRuntime(config, 'mcp', 'signals');
			children.push(sigChild.child);
			const sigLease = join(processesDir, `${sigChild.child.pid}.json`);
			assert.equal(existsSync(sigLease), true);
			sigChild.child.kill(sig);
			const code = await new Promise((res) => sigChild.child.once('exit', res));
			assert.equal(code, expectedCode);
			assert.equal(existsSync(sigLease), false, `${sig} exit removes own lease`);
		}

		// 3. Wrong-token replacement survives exit cleanup
		const replaced = await spawnRegisteredRuntime(config, 'mcp', 'signals');
		children.push(replaced.child);
		const replacedLease = join(processesDir, `${replaced.child.pid}.json`);
		const foreignContent = JSON.stringify({
			pid: replaced.child.pid,
			role: 'mcp',
			lease_version: 2,
			instance_id: randomUUID(),
			secret: 'b'.repeat(64),
			identity_port: 49999
		});
		await fs.writeFile(replacedLease, foreignContent);
		replaced.child.kill('SIGTERM');
		await new Promise((res) => replaced.child.once('exit', res));
		assert.equal(readFileSync(replacedLease, 'utf8'), foreignContent);

		// 4. Denied cleanup (read-only processes dir) does not hang or fail exit
		if (process.platform !== 'win32' && process.getuid?.() !== 0) {
			const denied = await spawnRegisteredRuntime(config, 'mcp', 'signals');
			children.push(denied.child);
			await fs.chmod(processesDir, 0o500);
			try {
				denied.child.kill('SIGTERM');
				const code = await new Promise((res) => denied.child.once('exit', res));
				assert.equal(code, 143);
			} finally {
				await fs.chmod(processesDir, 0o700);
			}
		}
	} finally {
		for (const child of children) await stopChild(child);
		await fs.chmod(processesDir, 0o700).catch(() => {});
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('concurrent readers never modify or delete lease files and respect concurrency limit of 8', async () => {
	const { root, config, processesDir } = await makeTempConfig();
	const children = [];
	try {
		const mcpChild = await spawnRegisteredRuntime(config, 'mcp', 'stay');
		children.push(mcpChild.child);
		const sleeper = await spawnSleeper();
		children.push(sleeper);
		const refusedPort = await getRefusedPort();
		const stalePath = join(processesDir, `${sleeper.pid}.json`);
		await fs.writeFile(
			stalePath,
			JSON.stringify({
				pid: sleeper.pid,
				role: 'mcp',
				lease_version: 2,
				instance_id: randomUUID(),
				secret: 'c'.repeat(64),
				identity_port: refusedPort
			})
		);

		const livePath = join(processesDir, `${mcpChild.child.pid}.json`);
		const beforeLive = readFileSync(livePath);
		const beforeStale = readFileSync(stalePath);
		const beforeLiveStat = lstatSync(livePath);
		const beforeStaleStat = lstatSync(stalePath);

		const results = await Promise.all(Array.from({ length: 12 }, () => connectedClients(config)));
		assert.deepEqual(results, Array(12).fill(1));
		assert.deepEqual(readFileSync(livePath), beforeLive);
		assert.deepEqual(readFileSync(stalePath), beforeStale);
		assert.equal(lstatSync(livePath).ino, beforeLiveStat.ino);
		assert.equal(lstatSync(stalePath).ino, beforeStaleStat.ino);

		// Concurrency cap of 8 across 20 v2 records
		for (let i = 0; i < 20; i++) {
			const pid = 20000 + i;
			await fs.writeFile(
				join(processesDir, `${pid}.json`),
				JSON.stringify({
					pid,
					role: 'mcp',
					lease_version: 2,
					instance_id: randomUUID(),
					secret: 'd'.repeat(64),
					identity_port: 40000 + i
				})
			);
		}
		let active = 0;
		let peak = 0;
		await inspectProcessLeases(config, {
			probePid: () => 'alive',
			probeEndpoint: async () => {
				active++;
				peak = Math.max(peak, active);
				await new Promise((res) => setTimeout(res, 20));
				active--;
				return { status: 'stale', reason: 'connection_refused' };
			}
		});
		assert.ok(peak <= 8 && peak >= 1, `expected peak concurrency <= 8, got ${peak}`);
	} finally {
		for (const child of children) await stopChild(child);
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('a startup sweep removes only leases whose process is provably gone', async () => {
	const { root, config, processesDir } = await makeTempConfig();
	const children = [];
	try {
		await fs.mkdir(processesDir, { recursive: true });
		const live = await spawnSleeper();
		children.push(live);
		const dead = await spawnSleeper();
		const record = (pid, port) =>
			JSON.stringify({
				pid,
				role: 'mcp',
				lease_version: LEASE_VERSION,
				instance_id: randomUUID(),
				secret: randomBytes(32).toString('hex'),
				identity_port: port
			});
		await fs.writeFile(join(processesDir, `${live.pid}.json`), record(live.pid, 40201));
		await fs.writeFile(join(processesDir, `${dead.pid}.json`), record(dead.pid, 40202));
		// Probes that cannot decide must never be treated as death.
		await fs.writeFile(join(processesDir, '999001.json'), record(999001, 40203));
		await fs.writeFile(join(processesDir, '999002.json'), record(999002, 40204));
		// Never a lease, so never swept.
		await fs.writeFile(join(processesDir, 'notes.txt'), 'keep');
		await fs.writeFile(join(processesDir, '0.json'), record(0, 40205));

		await stopChild(dead);

		const result = await sweepDeadLeases(config, {
			probePid: (pid) => {
				if (pid === 999001) return 'eperm';
				if (pid === 999002) return 'error';
				return defaultProbePid(pid);
			}
		});
		const remaining = (await fs.readdir(processesDir)).sort();
		assert.deepEqual(result.removed, [`${dead.pid}.json`], 'only the dead lease is removed');
		assert.ok(!remaining.includes(`${dead.pid}.json`), 'dead lease file is gone');
		assert.ok(remaining.includes(`${live.pid}.json`), 'live lease survives');
		assert.ok(remaining.includes('999001.json'), 'a PID we may not probe survives');
		assert.ok(remaining.includes('999002.json'), 'a PID whose probe failed survives');
		assert.ok(remaining.includes('notes.txt'), 'non-lease files are untouched');
		assert.ok(remaining.includes('0.json'), 'an invalid PID is left alone');
	} finally {
		for (const child of children) await stopChild(child);
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('branch reset deletes lease evidence, proving the final guard must precede reset, while reconstructed maintenance blocks admitted writers', async () => {
	const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'saturday-lease-reset-')));
	const prior = { ...process.env };
	const children = [];
	try {
		const config = {
			format: 'saturday.installation',
			version: 1,
			installation_id: randomUUID(),
			mode: 'managed',
			descriptor_path: join(root, 'installation.json'),
			code_root: join(root, 'app'),
			node_path: process.execPath,
			runtime_root: join(root, 'runtime', 'node-v24.21.0-darwin-arm64'),
			runtime_owned: false,
			code_owned: true,
			data_root: join(root, 'data'),
			database: join(root, 'data', 'saturday.db'),
			files: join(root, 'data', 'files'),
			files_state: join(root, 'data', 'files.state'),
			database_backups: join(root, 'data', 'backups', 'database'),
			database_restore: join(root, 'data', 'saturday.db.restore'),
			file_backups: join(root, 'data', 'backups', 'files'),
			extension_state: join(root, 'data', 'extensions'),
			extension_code: join(root, 'extensions'),
			extension_backups: join(root, 'data', 'extensions.backups'),
			logs: join(root, 'logs'),
			port: 3000,
			initialized: { database: false, files: false, extensions: false, access: false },
			setup: {}
		};
		await fs.mkdir(config.data_root, { recursive: true });
		await fs.mkdir(config.extension_state, { recursive: true });
		await fs.mkdir(config.extension_code, { recursive: true });
		await fs.writeFile(config.descriptor_path, JSON.stringify(config));
		for (const key of [
			'SATURDAY_PROJECT_ROOT',
			'SATURDAY_DB_PATH',
			'SATURDAY_FILES_PATH',
			'SATURDAY_EXTENSION_STATE_PATH',
			'SATURDAY_EXTENSIONS_PATH'
		])
			delete process.env[key];
		process.env.SATURDAY_INSTALLATION_PATH = config.descriptor_path;

		// Calling reset/branch helpers does not initialize SQLite.
		assert.equal(readSwitchExport(config), null);
		assert.equal(existsSync(config.database), false);
		assert.equal(typeof listBranches, 'function');

		// Genuine live MCP lease blocks before reset.
		const mcpChild = await spawnRegisteredRuntime(config, 'mcp', 'stay');
		children.push(mcpChild.child);
		assert.equal(await connectedClients(config), 1);

		// Once data_root is removed by resetLiveData, processes/ is gone and inspectProcessLeases reports empty
		// even though the child is still alive: proving why the final lease guard must run before reset.
		await resetLiveData(config);
		assert.deepEqual((await inspectProcessLeases(config)).entries, []);
		assert.equal(await connectedClients(config), 0);
		assert.equal(existsSync(config.database), false);

		// Operational assumption check: in the gap after reset and before maintenance reconstruction,
		// a newly starting runtime is NOT prevented by a missing maintenance file.
		const gapRuntime = await spawnRegisteredRuntime(config, 'mcp', 'stay');
		children.push(gapRuntime.child);
		assert.equal(
			await connectedClients(config),
			1,
			'gap runtime can register before maintenance is restored'
		);
		await stopChild(gapRuntime.child);
		await stopChild(mcpChild.child);
		await resetLiveData(config);

		// Once maintenance is claimed/reconstructed, admitted writers using withServerActivity are blocked.
		const release = await claimInstallationMaintenance({ persistent: true });
		try {
			const record = JSON.parse(readFileSync(serverPaths().maintenance, 'utf8'));
			assert.throws(
				() => withServerActivity(() => 'should-not-run'),
				(err) => err.code === 'BUSY'
			);
			// Reconstructing the same maintenance record after reset continues blocking writers.
			await resetLiveData(config);
			await fs.mkdir(join(config.data_root, 'server.state'), { recursive: true, mode: 0o700 });
			await fs.writeFile(serverPaths().maintenance, JSON.stringify(record), { mode: 0o600 });
			assert.throws(
				() => withServerActivity(() => 'should-not-run'),
				(err) => err.code === 'BUSY'
			);
		} finally {
			await release();
		}
	} finally {
		for (const child of children) await stopChild(child);
		for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
		Object.assign(process.env, prior);
		await fs.rm(root, { recursive: true, force: true });
	}
});
