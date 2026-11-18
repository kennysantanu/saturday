// Process lease registration, loopback identity proof, and read-only inspection.
import { createServer, connect } from 'node:net';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, unlinkSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicJson, getInstallation } from './installation.js';

export const LEASE_VERSION = 2;
export const PROTOCOL_PREFIX = 'SATURDAY-LEASE-V2';
export const HMAC_DOMAIN = 'saturday-process-lease-v2';
export const MAX_FRAME_BYTES = 1024;
export const MAX_LEASE_FILE_BYTES = 8192;
export const PROBE_TIMEOUT_MS = 1000;
export const MAX_PROBE_CONCURRENCY = 8;

const VALID_ROLES = new Set(['mcp', 'web']);
const CANONICAL_LEASE_NAME = /^[1-9]\d*\.json$/;
const ATOMIC_TEMP_NAME =
	/^\d+\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i;
const INSTANCE_ID_PATTERN = /^[a-f0-9-]{16,64}$/i;
const HEX_256_PATTERN = /^[0-9a-f]{64}$/;
const REGISTRY_SYMBOL = Symbol.for('saturday.processLeases.registry.v1');

function getGlobalRegistry() {
	let registry = globalThis[REGISTRY_SYMBOL];
	if (!registry) {
		registry = {
			entries: new Map(),
			queues: new Map(),
			exitHookInstalled: false
		};
		globalThis[REGISTRY_SYMBOL] = registry;
	}
	return registry;
}

function isPlainObject(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function computeLeaseHmac(secretHex, nonceHex, pid, instanceId) {
	return createHmac('sha256', Buffer.from(secretHex, 'hex'))
		.update(`${HMAC_DOMAIN}\0${nonceHex}\0${pid}\0${instanceId}`)
		.digest('hex');
}

function isOwnPublishedRecordOnDisk(entry) {
	try {
		const stat = lstatSync(entry.leasePath);
		if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_LEASE_FILE_BYTES) return false;
		const parsed = JSON.parse(readFileSync(entry.leasePath, 'utf8'));
		return (
			isPlainObject(parsed) &&
			parsed.lease_version === LEASE_VERSION &&
			parsed.pid === entry.pid &&
			parsed.role === entry.role &&
			parsed.identity_port === entry.identity_port &&
			parsed.instance_id === entry.instance_id &&
			typeof parsed.secret === 'string' &&
			parsed.secret.length === entry.secret.length &&
			timingSafeEqual(Buffer.from(parsed.secret, 'utf8'), Buffer.from(entry.secret, 'utf8'))
		);
	} catch {
		return false;
	}
}

function cleanupOwnedLeasesSync() {
	const registry = globalThis[REGISTRY_SYMBOL];
	if (!registry) return;
	for (const entry of registry.entries.values()) {
		if (entry.published) {
			try {
				const stat = lstatSync(entry.leasePath);
				if (!stat.isSymbolicLink() && stat.isFile() && stat.size <= MAX_LEASE_FILE_BYTES) {
					const parsed = JSON.parse(readFileSync(entry.leasePath, 'utf8'));
					if (
						isPlainObject(parsed) &&
						parsed.lease_version === LEASE_VERSION &&
						parsed.pid === entry.pid &&
						parsed.instance_id === entry.instance_id &&
						typeof parsed.secret === 'string' &&
						parsed.secret.length === entry.secret.length &&
						timingSafeEqual(Buffer.from(parsed.secret, 'utf8'), Buffer.from(entry.secret, 'utf8'))
					) {
						unlinkSync(entry.leasePath);
					}
				}
			} catch {
				// Contain cleanup failures during process exit.
			}
		}
		try {
			entry.closing = true;
			entry.server?.close();
		} catch {
			// Ignore close errors during exit.
		}
	}
}

function installExitHook(registry) {
	if (registry.exitHookInstalled) return;
	registry.exitHookInstalled = true;
	process.on('exit', cleanupOwnedLeasesSync);
}

function createIdentityListener(entry) {
	return new Promise((resolveListen, rejectListen) => {
		const server = createServer((socket) => {
			socket.unref();
			socket.setTimeout(PROBE_TIMEOUT_MS);
			let buffer = Buffer.alloc(0);
			let handled = false;
			const failSocket = () => {
				if (!socket.destroyed) socket.destroy();
			};
			socket.on('timeout', failSocket);
			socket.on('error', failSocket);
			socket.on('data', (chunk) => {
				if (handled || buffer.length + chunk.length > MAX_FRAME_BYTES) {
					failSocket();
					return;
				}
				buffer = Buffer.concat([buffer, chunk]);
				const newlineIdx = buffer.indexOf(0x0a);
				if (newlineIdx === -1) return;
				if (newlineIdx !== buffer.length - 1) {
					failSocket();
					return;
				}
				handled = true;
				const line = buffer.subarray(0, newlineIdx).toString('utf8').replace(/\r$/, '');
				const match = /^SATURDAY-LEASE-V2 ([0-9a-f]{64})$/.exec(line);
				if (!match) {
					failSocket();
					return;
				}
				const hmac = computeLeaseHmac(entry.secret, match[1], entry.pid, entry.instance_id);
				const response =
					JSON.stringify({
						v: LEASE_VERSION,
						pid: entry.pid,
						instance_id: entry.instance_id,
						hmac
					}) + '\n';
				if (Buffer.byteLength(response, 'utf8') > MAX_FRAME_BYTES) {
					failSocket();
					return;
				}
				socket.end(response);
			});
		});

		const onStartupError = (error) => {
			rejectListen(error);
		};
		server.once('error', onStartupError);
		server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
			server.removeListener('error', onStartupError);
			server.unref();
			const address = server.address();
			if (!address || typeof address === 'string' || !Number.isInteger(address.port)) {
				entry.closing = true;
				server.close(() => rejectListen(new Error('Invalid process lease listener address.')));
				return;
			}
			entry.server = server;
			entry.identity_port = address.port;
			const failRuntime = (reason) => {
				if (entry.closing) return;
				entry.closing = true;
				console.error(`Process lease identity listener failed: ${reason}`);
				process.exit(1);
			};
			server.on('error', (error) => failRuntime(error?.message || 'listener error'));
			server.on('close', () => failRuntime('listener closed unexpectedly'));
			resolveListen(server);
		});
	});
}

function publicRegistration(entry) {
	return {
		pid: entry.pid,
		role: entry.role,
		lease_version: LEASE_VERSION,
		instance_id: entry.instance_id,
		identity_port: entry.identity_port,
		path: entry.leasePath
	};
}

function serializeForStateDir(registry, stateDir, fn) {
	const previous = registry.queues.get(stateDir) || Promise.resolve();
	const next = previous.catch(() => {}).then(fn);
	const settled = next.catch(() => {});
	registry.queues.set(stateDir, settled);
	return next.finally(() => {
		if (registry.queues.get(stateDir) === settled) registry.queues.delete(stateDir);
	});
}

function assertSafeProcessesDirectory(dir) {
	let stat;
	try {
		stat = lstatSync(dir);
	} catch (error) {
		if (error.code === 'ENOENT') return;
		throw error;
	}
	if (stat.isSymbolicLink() || !stat.isDirectory())
		throw new Error('Unsafe process lease directory.');
}

export async function registerProcessLease(config = getInstallation(), role = 'mcp', options = {}) {
	if (!VALID_ROLES.has(role)) throw new Error(`Unsupported process lease role: ${String(role)}.`);
	if (!config?.extension_state || typeof config.extension_state !== 'string')
		throw new Error('Extension state directory is required for process lease registration.');
	const { writeLease = atomicJson } = options;
	const stateDir = resolve(config.extension_state);
	const processesDir = join(stateDir, 'processes');
	const registry = getGlobalRegistry();

	return serializeForStateDir(registry, stateDir, async () => {
		installExitHook(registry);
		assertSafeProcessesDirectory(processesDir);

		const existing = registry.entries.get(stateDir);
		if (existing && !existing.closing) {
			if (existing.role === role && existing.published && isOwnPublishedRecordOnDisk(existing)) {
				return publicRegistration(existing);
			}
			const previousRole = existing.role;
			existing.role = role;
			try {
				await writeLease(existing.leasePath, {
					pid: existing.pid,
					role: existing.role,
					lease_version: LEASE_VERSION,
					instance_id: existing.instance_id,
					secret: existing.secret,
					identity_port: existing.identity_port
				});
				existing.published = true;
				return publicRegistration(existing);
			} catch (error) {
				existing.role = previousRole;
				throw error;
			}
		}

		const entry = {
			stateDir,
			leasePath: join(processesDir, `${process.pid}.json`),
			pid: process.pid,
			role,
			instance_id: randomUUID(),
			secret: randomBytes(32).toString('hex'),
			identity_port: null,
			server: null,
			published: false,
			closing: false
		};
		await createIdentityListener(entry);
		registry.entries.set(stateDir, entry);
		try {
			await writeLease(entry.leasePath, {
				pid: entry.pid,
				role: entry.role,
				lease_version: LEASE_VERSION,
				instance_id: entry.instance_id,
				secret: entry.secret,
				identity_port: entry.identity_port
			});
			entry.published = true;
			return publicRegistration(entry);
		} catch (error) {
			entry.closing = true;
			if (registry.entries.get(stateDir) === entry) registry.entries.delete(stateDir);
			await new Promise((resolveClose) => {
				try {
					entry.server?.close(() => resolveClose());
				} catch {
					resolveClose();
				}
			});
			throw error;
		}
	});
}

export function defaultProbePid(pid) {
	if (!Number.isSafeInteger(pid) || pid < 1) return 'invalid';
	try {
		process.kill(pid, 0);
		return 'alive';
	} catch (error) {
		if (error.code === 'ESRCH') return 'dead';
		if (error.code === 'EPERM') return 'eperm';
		return 'error';
	}
}

export function defaultProbeEndpoint(
	{ port, pid, instance_id, secret },
	{ nonce = randomBytes(32).toString('hex'), timeoutMs = PROBE_TIMEOUT_MS } = {}
) {
	return new Promise((resolveProbe) => {
		if (!HEX_256_PATTERN.test(nonce)) {
			resolveProbe({ status: 'unknown', reason: 'invalid_nonce' });
			return;
		}
		const socket = connect({ host: '127.0.0.1', port });
		let settled = false;
		let totalBytes = 0;
		const chunks = [];
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (!socket.destroyed) socket.destroy();
			resolveProbe(result);
		};
		const timer = setTimeout(
			() => finish({ status: 'unknown', reason: 'probe_timeout' }),
			timeoutMs
		);
		timer.unref?.();

		socket.on('connect', () => {
			socket.write(`${PROTOCOL_PREFIX} ${nonce}\n`);
		});
		socket.on('data', (chunk) => {
			totalBytes += chunk.length;
			if (totalBytes > MAX_FRAME_BYTES) {
				finish({ status: 'unknown', reason: 'response_too_large' });
				return;
			}
			chunks.push(chunk);
			const full = Buffer.concat(chunks);
			const newlineIdx = full.indexOf(0x0a);
			if (newlineIdx === -1) return;
			if (newlineIdx !== full.length - 1) {
				finish({ status: 'unknown', reason: 'malformed_response' });
				return;
			}
			let parsed;
			try {
				parsed = JSON.parse(full.subarray(0, newlineIdx).toString('utf8').replace(/\r$/, ''));
			} catch {
				finish({ status: 'unknown', reason: 'malformed_response' });
				return;
			}
			if (
				!isPlainObject(parsed) ||
				parsed.v !== LEASE_VERSION ||
				!Number.isSafeInteger(parsed.pid) ||
				parsed.pid < 1 ||
				typeof parsed.instance_id !== 'string' ||
				!INSTANCE_ID_PATTERN.test(parsed.instance_id) ||
				typeof parsed.hmac !== 'string' ||
				!HEX_256_PATTERN.test(parsed.hmac)
			) {
				finish({ status: 'unknown', reason: 'malformed_response' });
				return;
			}
			if (parsed.pid !== pid || parsed.instance_id !== instance_id) {
				finish({ status: 'stale', reason: 'identity_mismatch' });
				return;
			}
			const expectedHex = computeLeaseHmac(secret, nonce, pid, instance_id);
			const actualBuf = Buffer.from(parsed.hmac, 'hex');
			const expectedBuf = Buffer.from(expectedHex, 'hex');
			if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
				finish({ status: 'stale', reason: 'proof_mismatch' });
				return;
			}
			finish({ status: 'genuine', reason: 'verified' });
		});
		socket.on('end', () => finish({ status: 'unknown', reason: 'truncated_response' }));
		socket.on('close', () => finish({ status: 'unknown', reason: 'truncated_response' }));
		socket.on('error', (error) => {
			if (error.code === 'ECONNREFUSED') finish({ status: 'stale', reason: 'connection_refused' });
			else finish({ status: 'unknown', reason: `probe_error:${error.code || 'unknown'}` });
		});
	});
}

function describeReason(reason) {
	if (!reason) return 'unknown verification failure';
	if (reason === 'legacy_record_missing_identity')
		return 'legacy lease has no v2 identity endpoint';
	if (reason === 'probe_timeout') return 'identity probe timed out';
	if (reason === 'truncated_response') return 'truncated or empty identity response';
	if (reason === 'malformed_response') return 'malformed identity response';
	if (reason === 'response_too_large') return 'oversized identity response';
	if (reason === 'unsupported_version') return 'unsupported lease version';
	if (
		reason === 'invalid_v2_record' ||
		reason === 'invalid_legacy_record' ||
		reason === 'invalid_record'
	)
		return 'invalid lease record';
	if (reason === 'invalid_json') return 'malformed lease JSON';
	if (reason === 'oversized_record') return 'oversized lease file';
	if (reason === 'unsafe_lease_file') return 'symlink or non-regular lease file';
	if (reason === 'unsafe_lease_directory') return 'symlink or non-directory lease folder';
	if (reason === 'unrecognized_entry') return 'unrecognized entry in process lease folder';
	if (reason === 'pid_permission_denied') return 'permission denied probing PID';
	if (reason === 'invalid_pid' || reason === 'pid_probe_failed')
		return 'invalid or unprobeable PID';
	if (reason.startsWith('probe_error:')) return `identity probe error (${reason.slice(12)})`;
	if (reason.startsWith('read_error:')) return `lease read error (${reason.slice(11)})`;
	if (reason.startsWith('lstat_error:')) return `lease stat error (${reason.slice(12)})`;
	return reason;
}

export function formatLeaseDiagnostic(entry) {
	const target = entry.pid ? `${entry.path} (PID ${entry.pid})` : entry.path;
	if (entry.status === 'legacy') {
		return `Lease ${target} has no v2 identity endpoint. Stop older Saturday runtimes and retry; if PID ${entry.pid} belongs to an unrelated process, inspect its owner while all Saturday runtimes are stopped, move only ${entry.path} to a recovery folder, then reconnect assistants.`;
	}
	return `Lease ${target} could not be verified (${describeReason(entry.reason)}). Stop Saturday runtimes and retry; if the issue persists for an unrelated process, inspect ownership while all Saturday runtimes are stopped and move only ${entry.path} to a recovery folder.`;
}

function validateV2Record(record, filePid) {
	if (record.pid !== filePid) return false;
	if (!VALID_ROLES.has(record.role)) return false;
	if (typeof record.instance_id !== 'string' || !INSTANCE_ID_PATTERN.test(record.instance_id))
		return false;
	if (typeof record.secret !== 'string' || !HEX_256_PATTERN.test(record.secret)) return false;
	if (
		!Number.isInteger(record.identity_port) ||
		record.identity_port < 1 ||
		record.identity_port > 65535
	)
		return false;
	return true;
}

async function mapWithConcurrency(items, limit, worker) {
	if (!items.length) return [];
	const results = new Array(items.length);
	let nextIndex = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const index = nextIndex++;
			if (index >= items.length) return;
			results[index] = await worker(items[index], index);
		}
	});
	await Promise.all(runners);
	return results;
}

async function inspectLeaseEntry(dir, name, options) {
	const {
		includeSelf = true,
		probePid = defaultProbePid,
		probeEndpoint = defaultProbeEndpoint,
		readFile = (targetPath, encoding) => fs.readFile(targetPath, encoding),
		createNonce = () => randomBytes(32).toString('hex'),
		timeoutMs = PROBE_TIMEOUT_MS
	} = options;

	if (ATOMIC_TEMP_NAME.test(name)) return null;
	const path = join(dir, name);

	let stat;
	try {
		stat = await fs.lstat(path);
	} catch (error) {
		if (error.code === 'ENOENT') return null;
		return {
			name,
			path,
			pid: null,
			role: null,
			status: 'unknown',
			reason: `lstat_error:${error.code || 'unknown'}`
		};
	}
	if (stat.isSymbolicLink() || !stat.isFile()) {
		return {
			name,
			path,
			pid: null,
			role: null,
			status: 'unknown',
			reason: 'unsafe_lease_file'
		};
	}
	if (!CANONICAL_LEASE_NAME.test(name)) {
		return {
			name,
			path,
			pid: null,
			role: null,
			status: 'unknown',
			reason: 'unrecognized_entry'
		};
	}

	const pid = Number(name.slice(0, -5));
	if (!Number.isSafeInteger(pid) || pid < 1) {
		return { name, path, pid: null, role: null, status: 'unknown', reason: 'invalid_pid' };
	}
	if (!includeSelf && pid === process.pid) return null;

	const pidState = probePid(pid);
	if (pidState === 'dead') {
		return { name, path, pid, role: null, status: 'dead', reason: 'process_not_found' };
	}
	if (pidState === 'eperm') {
		return { name, path, pid, role: null, status: 'unknown', reason: 'pid_permission_denied' };
	}
	if (pidState !== 'alive') {
		return { name, path, pid, role: null, status: 'unknown', reason: 'pid_probe_failed' };
	}
	if (stat.size > MAX_LEASE_FILE_BYTES) {
		return { name, path, pid, role: null, status: 'unknown', reason: 'oversized_record' };
	}

	let raw;
	try {
		raw = await readFile(path, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return null;
		return {
			name,
			path,
			pid,
			role: null,
			status: 'unknown',
			reason: `read_error:${error.code || 'unknown'}`
		};
	}

	let record;
	try {
		record = JSON.parse(raw);
	} catch {
		return { name, path, pid, role: null, status: 'unknown', reason: 'invalid_json' };
	}
	if (!isPlainObject(record)) {
		return { name, path, pid, role: null, status: 'unknown', reason: 'invalid_record' };
	}

	if (record.lease_version !== undefined) {
		if (record.lease_version !== LEASE_VERSION) {
			return { name, path, pid, role: null, status: 'unknown', reason: 'unsupported_version' };
		}
		if (!validateV2Record(record, pid)) {
			return { name, path, pid, role: null, status: 'unknown', reason: 'invalid_v2_record' };
		}
		const probe = await probeEndpoint(
			{
				port: record.identity_port,
				pid,
				instance_id: record.instance_id,
				secret: record.secret
			},
			{ nonce: createNonce(), timeoutMs }
		);
		if (probe.status === 'genuine') {
			return {
				name,
				path,
				pid,
				role: record.role,
				lease_version: LEASE_VERSION,
				instance_id: record.instance_id,
				identity_port: record.identity_port,
				status: 'genuine',
				reason: probe.reason
			};
		}
		if (probe.status === 'stale') {
			return {
				name,
				path,
				pid,
				role: record.role,
				lease_version: LEASE_VERSION,
				instance_id: record.instance_id,
				identity_port: record.identity_port,
				status: 'stale',
				reason: probe.reason
			};
		}
		return {
			name,
			path,
			pid,
			role: null,
			lease_version: LEASE_VERSION,
			instance_id: record.instance_id,
			identity_port: record.identity_port,
			status: 'unknown',
			reason: probe.reason
		};
	}

	if (record.pid !== pid || (record.role !== undefined && !VALID_ROLES.has(record.role))) {
		return { name, path, pid, role: null, status: 'unknown', reason: 'invalid_legacy_record' };
	}
	return {
		name,
		path,
		pid,
		role: record.role ?? null,
		lease_version: 1,
		status: 'legacy',
		reason: 'legacy_record_missing_identity'
	};
}

export async function inspectProcessLeases(config = getInstallation(), options = {}) {
	if (!config?.extension_state || typeof config.extension_state !== 'string')
		throw new Error('Extension state directory is required for process lease inspection.');
	const dir = join(resolve(config.extension_state), 'processes');
	let dirStat;
	try {
		dirStat = await fs.lstat(dir);
	} catch (error) {
		if (error.code === 'ENOENT') return { directory: dir, entries: [] };
		return {
			directory: dir,
			entries: [
				{
					name: 'processes',
					path: dir,
					pid: null,
					role: null,
					status: 'unknown',
					reason: `lstat_error:${error.code || 'unknown'}`
				}
			]
		};
	}
	if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
		return {
			directory: dir,
			entries: [
				{
					name: 'processes',
					path: dir,
					pid: null,
					role: null,
					status: 'unknown',
					reason: 'unsafe_lease_directory'
				}
			]
		};
	}

	let names;
	try {
		names = await fs.readdir(dir);
	} catch (error) {
		if (error.code === 'ENOENT') return { directory: dir, entries: [] };
		throw error;
	}
	names.sort();
	const concurrency =
		Number.isInteger(options.concurrency) && options.concurrency > 0
			? options.concurrency
			: MAX_PROBE_CONCURRENCY;
	const inspected = await mapWithConcurrency(names, concurrency, (name) =>
		inspectLeaseEntry(dir, name, options)
	);
	return { directory: dir, entries: inspected.filter(Boolean) };
}
