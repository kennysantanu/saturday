// Local UI process ownership. MCP remains client-owned; all control state is outside backups.
import { createServer } from 'node:http';
import { createServer as createSocket } from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { initializeAccessSettings, readAccessSettings } from './access-settings.js';
import { phoneAddresses } from './access-network.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
	mkdirSync,
	writeFileSync,
	readFileSync,
	existsSync,
	readdirSync,
	unlinkSync,
	appendFileSync,
	statSync,
	lstatSync
} from 'node:fs';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import {
	getInstallation,
	installationEnvironment,
	assertInstallationStorage,
	atomicJson,
	acquireDirectoryLock
} from './installation.js';
const activity = new AsyncLocalStorage();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message) => {
	throw Object.assign(new Error(message), { code: 'BUSY' });
};
export const serverPaths = () => {
	const root = join(getInstallation().data_root, 'server.state');
	return {
		root,
		record: join(root, 'server.json'),
		maintenance: join(root, 'maintenance.json'),
		activities: join(root, 'activities')
	};
};
function validateStatePaths() {
	const paths = serverPaths();
	for (const path of [paths.root, paths.activities]) {
		if (existsSync(path)) {
			const stat = lstatSync(path);
			if (stat.isSymbolicLink() || !stat.isDirectory())
				throw new Error('Unsafe server state directory. Repair without resetting data.');
		}
	}
	if (existsSync(paths.maintenance) && !lstatSync(paths.maintenance).isFile())
		throw new Error('Unsafe server maintenance state. Repair without resetting data.');
}
const alive = (pid) => {
	if (!Number.isSafeInteger(pid) || pid < 1) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === 'EPERM';
	}
};
function maintenanceActive() {
	validateStatePaths();
	const path = serverPaths().maintenance;
	if (!existsSync(path)) return false;
	const record = JSON.parse(readFileSync(path, 'utf8'));
	if (
		process.env.SATURDAY_MAINTENANCE_TOKEN &&
		record.token === process.env.SATURDAY_MAINTENANCE_TOKEN &&
		alive(record.pid)
	)
		return false;
	if (alive(record.pid)) return true;
	if (record.persistent)
		fail(
			'Interrupted installation maintenance requires repair. Run the installation repair command.'
		);
	unlinkSync(path);
	return false;
}
export function withServerActivity(operation) {
	if (activity.getStore()) return operation();
	const paths = serverPaths();
	if (!existsSync(paths.record) && !existsSync(paths.maintenance)) return operation();
	if (maintenanceActive()) fail('Saturday is stopping or restarting. Retry after it is ready.');
	mkdirSync(paths.activities, { recursive: true, mode: 0o700 });
	const marker = join(paths.activities, `${process.pid}-${randomUUID()}.json`);
	writeFileSync(marker, '', { flag: 'wx', mode: 0o600 });
	const release = () => {
		try {
			unlinkSync(marker);
		} catch (e) {
			if (e.code !== 'ENOENT') throw e;
		}
	};
	try {
		if (maintenanceActive()) fail('Saturday is stopping or restarting. Retry after it is ready.');
		const result = activity.run(true, operation);
		if (result?.then) return Promise.resolve(result).finally(release);
		release();
		return result;
	} catch (e) {
		release();
		throw e;
	}
}
export async function claimInstallationMaintenance({ persistent = false, recover = false } = {}) {
	const existing = serverPaths().maintenance;
	if (recover && existsSync(existing)) {
		const record = JSON.parse(readFileSync(existing, 'utf8'));
		if (
			!alive(record.pid) &&
			record.persistent &&
			record.installation_id === getInstallation().installation_id
		)
			await fs.rm(existing);
	}
	const paths = serverPaths();
	maintenanceActive();
	await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
	await fs.writeFile(
		paths.maintenance,
		JSON.stringify({
			pid: process.pid,
			token: randomBytes(32).toString('hex'),
			persistent,
			installation_id: getInstallation().installation_id
		}),
		{
			flag: 'wx',
			mode: 0o600
		}
	);
	try {
		const markers = existsSync(paths.activities) ? readdirSync(paths.activities) : [];
		for (const name of markers) {
			const match = /^(\d+)-[a-f0-9-]+\.json$/.exec(name);
			if (!match) fail('Unrecognized activity state requires repair.');
			if (alive(Number(match[1])))
				fail('A data operation is running. Wait for it to finish before stopping or restarting.');
			await fs.rm(join(paths.activities, name), { force: true });
		}
		// Backup streaming holds its own operation lock outside transaction/file guards.
		const lock = join(getInstallation().database_backups, 'operations.lock');
		if (existsSync(lock) && readdirSync(lock).some((n) => alive(Number(/^(\d+)-/.exec(n)?.[1]))))
			fail('A backup operation is running. Wait for it to finish.');
		return () => fs.rm(paths.maintenance, { force: true });
	} catch (e) {
		await fs.rm(paths.maintenance, { force: true });
		throw e;
	}
}
function readRecord() {
	validateStatePaths();
	const path = serverPaths().record;
	if (!existsSync(path)) return null;
	if (lstatSync(path).isSymbolicLink())
		throw new Error('Unsafe server state. Repair this installation.');
	let record;
	try {
		record = JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		throw new Error('Server state is invalid. Repair the server state without resetting data.');
	}
	if (
		record.format !== 'saturday.server' ||
		!['starting', 'running', 'restarting', 'stopping', 'stopped', 'failed'].includes(
			record.status
		) ||
		record.version !== 1 ||
		(record.allow_lan !== undefined && typeof record.allow_lan !== 'boolean') ||
		!Number.isSafeInteger(record.pid) ||
		record.pid < 1 ||
		!Number.isInteger(record.port) ||
		record.port < 1 ||
		record.port > 65535 ||
		record.url !== `http://127.0.0.1:${record.port}` ||
		(!(record.control_port === null && ['failed', 'stopped'].includes(record.status)) &&
			(!Number.isInteger(record.control_port) ||
				record.control_port < 1 ||
				record.control_port > 65535)) ||
		!/^[a-f0-9]{64}$/.test(record.token ?? '') ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.generation ?? '')
	)
		throw new Error('Unsupported or invalid server state. Repair without resetting data.');
	if (record.installation_id !== getInstallation().installation_id)
		throw new Error('Server state belongs to another installation.');
	return record;
}
export function serverSummary() {
	const record = readRecord();
	return {
		managed: Boolean(record && alive(record.pid)),
		status: record && alive(record.pid) ? record.status : 'stopped',
		url: record?.url ?? null,
		generation: record?.generation ?? null,
		allow_lan: record?.allow_lan ?? false,
		port: record?.port ?? null,
		installation_id: getInstallation().installation_id,
		logs: join(getInstallation().logs, 'server.log'),
		error: record?.error ?? null
	};
}
export function networkSummary(settings = readAccessSettings(), runtimePort = null) {
	const server = serverSummary();
	const running = server.managed && server.status === 'running';
	const direct = runtimePort && process.env.SATURDAY_RUNNING_ALLOW_LAN !== undefined;
	const effective = direct
		? process.env.SATURDAY_RUNNING_ALLOW_LAN === 'true'
		: running
			? server.allow_lan
			: null;
	const port = direct ? runtimePort : server.port;
	return {
		saved_allow_lan: settings.allow_lan,
		effective_allow_lan: effective,
		restart_required: effective !== null && settings.allow_lan !== effective,
		phone_addresses: effective === true && port ? phoneAddresses(port) : [],
		local_url: server.url,
		managed: server.managed
	};
}
export function validServerSession(token) {
	const expected = process.env.SATURDAY_SERVER_TOKEN;
	return Boolean(
		expected &&
		typeof token === 'string' &&
		Buffer.byteLength(token) === Buffer.byteLength(expected) &&
		timingSafeEqual(Buffer.from(token), Buffer.from(expected))
	);
}
async function probe(record) {
	try {
		const response = await fetch(`${record.url}/health`, { signal: AbortSignal.timeout(1000) });
		const health = await response.json();
		return (
			response.ok &&
			health.app === 'saturday' &&
			health.status === 'ready' &&
			health.installation_id === getInstallation().installation_id &&
			health.server_generation === record.generation &&
			(health.allow_lan ?? false) === (record.allow_lan ?? false) &&
			(!getInstallation().build?.id || health.build?.id === getInstallation().build.id)
		);
	} catch {
		return false;
	}
}
export async function statusServer() {
	const record = readRecord();
	if (!record || !alive(record.pid) || !(await probe(record)))
		throw new Error(
			'This Saturday server is not ready. Start it with npm run open or npm run start.'
		);
	return serverSummary();
}
export async function controlServer(operation, { defer = false } = {}) {
	if (!['stop', 'restart'].includes(operation)) throw new Error('Choose stop or restart.');
	const record = readRecord();
	if (!record || !alive(record.pid)) throw new Error('No owned Saturday supervisor is running.');
	const response = await fetch(`http://127.0.0.1:${record.control_port}/control`, {
		method: 'POST',
		headers: { authorization: `Bearer ${record.token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ operation, defer }),
		signal: AbortSignal.timeout(4000)
	});
	const result = await response.json();
	if (!response.ok) throw new Error(result.error ?? 'Server control failed.');
	return result;
}
export async function commitServerControl(generation) {
	const record = readRecord();
	if (!record || !alive(record.pid)) return;
	await fetch(`http://127.0.0.1:${record.control_port}/commit`, {
		method: 'POST',
		headers: { authorization: `Bearer ${record.token}`, 'content-type': 'application/json' },
		body: JSON.stringify({ generation }),
		signal: AbortSignal.timeout(4000)
	});
}
async function freePort(preferred, host = '127.0.0.1') {
	if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535)
		throw new Error('Choose a valid port.');
	for (const candidate of [preferred, 0]) {
		let server;
		try {
			async function check(address, port) {
				server = createSocket();
				await new Promise((res, rej) => {
					server.once('error', rej);
					server.listen(port, address, res);
				});
				const actual = server.address().port;
				await new Promise((res) => server.close(res));
				return actual;
			}
			const port = await check(host, candidate);
			if (host === '0.0.0.0') {
				// macOS can allow a wildcard listener beside an existing specific-interface listener.
				// Probe each address without our wildcard held so Windows/Linux do not conflict with us.
				for (const address of new Set([
					'127.0.0.1',
					...phoneAddresses(port).map((entry) => entry.address)
				]))
					await check(address, port);
				await check(host, port);
			}
			return port;
		} catch {
			server?.close();
		}
	}
	throw new Error('Could not reserve a port on the intended network interfaces.');
}
export async function startServer({ open = false } = {}) {
	await initializeAccessSettings();
	if (maintenanceActive())
		fail('Installation maintenance is running. Wait or repair an interrupted operation.');
	assertInstallationStorage();
	const installation = getInstallation(),
		paths = serverPaths();
	if (!existsSync(join(installation.code_root, 'build', 'index.js')))
		throw new Error('Saturday is not built. Run npm run setup first.');
	validateStatePaths();
	await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
	const release = await acquireDirectoryLock(join(paths.root, 'start.lock'));
	try {
		let record = readRecord(),
			created = false;
		if (record && alive(record.pid)) {
			if (!(await probe(record)))
				throw new Error('The owned server is not ready. Check its logs before retrying.');
		} else {
			const preferred = Number(process.env.PORT || record?.port || installation.port);
			// Do not create a second instance for an unmanaged same-installation server.
			try {
				const r = await fetch(`http://127.0.0.1:${preferred}/health`, {
					signal: AbortSignal.timeout(500)
				});
				const h = await r.json();
				if (h.app === 'saturday' && h.installation_id === installation.installation_id)
					throw Object.assign(
						new Error(
							'An unmanaged Saturday server is already running. Stop its terminal before using server controls.'
						),
						{ ownedConflict: true }
					);
			} catch (e) {
				if (e.ownedConflict) throw e;
			}
			const port = await freePort(
				preferred,
				readAccessSettings().allow_lan ? '0.0.0.0' : '127.0.0.1'
			);
			const child = spawn(
				installation.node_path,
				[join(installation.code_root, 'scripts', 'start.mjs'), '--supervise', String(port)],
				{
					cwd: installation.code_root,
					env: installationEnvironment(installation),
					detached: true,
					windowsHide: true,
					stdio: 'ignore'
				}
			);
			await new Promise((res, rej) => {
				child.once('spawn', res);
				child.once('error', rej);
			});
			child.unref();
			created = true;
			const deadline = Date.now() + 20000;
			do {
				await delay(100);
				record = readRecord();
				if (record?.pid === child.pid && record.status === 'failed') throw new Error(record.error);
				if (record?.pid === child.pid && (await probe(record))) break;
			} while (Date.now() < deadline);
			if (!record || record.pid !== child.pid || !(await probe(record)))
				throw new Error(
					`Saturday did not become ready. Check ${join(installation.logs, 'server.log')}.`
				);
		}
		if (open) await openBrowser(record.url);
		return { ...serverSummary(), created };
	} finally {
		await release();
	}
}
async function openBrowser(url) {
	const command =
		process.platform === 'darwin'
			? 'open'
			: process.platform === 'win32'
				? 'rundll32.exe'
				: 'xdg-open';
	const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
	await new Promise((res, rej) => {
		const child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore' });
		child.once('error', rej);
		child.once('close', (code) =>
			code === 0 ? res() : rej(new Error(`Browser opening failed. Open ${url} manually.`))
		);
	});
}
export async function runSupervisor(port) {
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid port.');
	const installation = getInstallation(),
		paths = serverPaths();
	validateStatePaths();
	await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
	await fs.mkdir(installation.logs, { recursive: true, mode: 0o700 });
	const release = await acquireDirectoryLock(join(paths.root, 'controller.lock'), { attempts: 0 });
	if (!release) throw new Error('Another supervisor owns this installation.');
	let child,
		closing = false,
		operation = false;
	const record = {
		format: 'saturday.server',
		version: 1,
		installation_id: installation.installation_id,
		pid: process.pid,
		port,
		url: `http://127.0.0.1:${port}`,
		token: randomBytes(32).toString('hex'),
		generation: randomUUID(),
		status: 'starting',
		control_port: null,
		error: null
	};
	const save = () => atomicJson(paths.record, record);
	const log = (value) => {
		const path = join(installation.logs, 'server.log');
		try {
			if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Unsafe log path');
			appendFileSync(path, value, { mode: 0o600 });
			if (statSync(path).size > 1024 * 1024)
				writeFileSync(path, readFileSync(path).subarray(-1024 * 1024), { mode: 0o600 });
		} catch {
			record.error = 'Server log could not be written. Check disk space and permissions.';
		}
	};
	async function launch() {
		record.allow_lan = readAccessSettings().allow_lan;
		// The prior port may now be occupied on a non-loopback interface.
		record.port = await freePort(record.port, record.allow_lan ? '0.0.0.0' : '127.0.0.1');
		record.url = `http://127.0.0.1:${record.port}`;
		record.status = 'starting';
		await save();
		child = spawn(installation.node_path, [join(installation.code_root, 'scripts', 'web.mjs')], {
			cwd: installation.code_root,
			env: {
				...installationEnvironment(installation),
				PORT: String(record.port),
				SATURDAY_LOCAL_ORIGIN: record.url,
				SATURDAY_RUNNING_ALLOW_LAN: String(record.allow_lan),
				BODY_SIZE_LIMIT: 'Infinity',
				SATURDAY_SERVER_TOKEN: record.token,
				SATURDAY_SERVER_GENERATION: record.generation
			},
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		for (const stream of [child.stdout, child.stderr]) stream.on('data', log);
		child.once('error', (e) => {
			record.error = e.message;
		});
		child.once('exit', () => {
			if (!closing && !operation && record.status === 'running') {
				record.status = 'failed';
				record.error =
					record.error ||
					'Web server exited. Start Saturday again; inspect server logs if it repeats.';
				void finish();
			}
		});
		await new Promise((res, rej) => {
			child.once('spawn', res);
			child.once('error', rej);
		});
		const deadline = Date.now() + 15000;
		while (Date.now() < deadline) {
			if (child.exitCode !== null || child.signalCode)
				throw new Error(record.error || 'Server exited during startup.');
			if (await probe(record)) {
				record.status = 'running';
				await save();
				return;
			}
			await delay(100);
		}
		throw new Error('Server startup timed out.');
	}
	async function halt() {
		if (!child || !child.pid || child.exitCode !== null || child.signalCode) return;
		const stopped = new Promise((res) => child.once('exit', res));
		child.kill('SIGTERM');
		const timer = setTimeout(() => child?.kill('SIGKILL'), 8000);
		await stopped;
		clearTimeout(timer);
	}
	let pending;
	const controller = createServer(async (request, response) => {
		try {
			if (
				request.method !== 'POST' ||
				!['/control', '/commit'].includes(request.url) ||
				request.headers.authorization !== `Bearer ${record.token}`
			) {
				response.writeHead(403);
				response.end(JSON.stringify({ error: 'Unauthorized server control.' }));
				return;
			}
			let body = '';
			for await (const chunk of request) {
				body += chunk;
				if (body.length > 1024) throw new Error('Control request is too large.');
			}
			const input = JSON.parse(body);
			if (request.url === '/commit') {
				if (!pending || input.generation !== record.generation)
					throw new Error('No matching pending operation.');
				pending.run();
				response.writeHead(202, { 'content-type': 'application/json' });
				response.end(JSON.stringify({ accepted: true }));
				return;
			}
			const action = input.operation;
			if (!['stop', 'restart'].includes(action)) throw new Error('Invalid server operation.');
			if (operation) {
				response.writeHead(409);
				response.end(JSON.stringify({ error: 'A server operation is already running.' }));
				return;
			}
			const previous = { ...record };
			const restoreAdmission = await claimInstallationMaintenance();
			try {
				operation = true;
				record.status = action === 'stop' ? 'stopping' : 'restarting';
				record.generation = randomUUID();
				await save();
			} catch (e) {
				operation = false;
				Object.assign(record, previous);
				await restoreAdmission();
				throw e;
			}
			const run = () => {
				if (!pending) return;
				clearTimeout(pending.timer);
				pending = null;
				setTimeout(async () => {
					try {
						await halt();
						if (action === 'restart') {
							await restoreAdmission();
							await launch();
							operation = false;
						} else {
							closing = true;
							record.status = 'stopped';
							await restoreAdmission();
							await finish();
						}
					} catch (e) {
						record.status = 'failed';
						record.error = e.message;
						await restoreAdmission();
						await finish();
					}
				}, 200);
			};
			pending = {
				run,
				timer: setTimeout(async () => {
					pending = null;
					operation = false;
					Object.assign(record, previous);
					await restoreAdmission();
					await save();
				}, 15000)
			};
			response.writeHead(202, { 'content-type': 'application/json', 'cache-control': 'no-store' });
			response.end(
				JSON.stringify({
					accepted: true,
					operation: action,
					generation: record.generation,
					url: record.url,
					installation_id: record.installation_id
				})
			);
			if (input.defer !== true) run();
		} catch (e) {
			response.writeHead(409, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ error: e.message }));
		}
	});
	let finishing;
	async function finish() {
		if (finishing) return finishing;
		finishing = (async () => {
			closing = true;
			if (pending) {
				clearTimeout(pending.timer);
				pending = null;
			}
			await halt();
			try {
				await save();
			} catch {
				log('Server state could not be saved during shutdown. Check disk space and permissions.\n');
			}
			try {
				await new Promise((res) => controller.close(res));
			} finally {
				await release();
			}
		})();
		return finishing;
	}
	try {
		await new Promise((res, rej) => {
			controller.once('error', rej);
			controller.listen(0, '127.0.0.1', res);
		});
		record.control_port = controller.address().port;
		await save();
		await launch();
		for (const signal of ['SIGINT', 'SIGTERM'])
			process.once(signal, () => {
				record.status = 'stopped';
				void finish();
			});
	} catch (e) {
		record.status = 'failed';
		record.error = e.message;
		log(`${e.message}\n`);
		await finish();
	}
}
