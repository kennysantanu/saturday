import { getInstallation, assertInstallationStorage } from './installation.js';
// Shared extension lifecycle, database, and recovery. Extension code is trusted, not sandboxed.
import * as fs from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { getProjectRoot, getDatabasePath, databaseIdentity } from './database.js';
import { acquireDirectoryLock, atomicJson } from './files/store.js';
import { getJob, searchJobs } from './services.js';
import { getNetwork, listNetworks } from './networks.js';
import { getDocument, listDocuments } from './files/documents.js';

export class ExtensionError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}
export const rejectExtension = (code, message) => {
	throw new ExtensionError(code, message);
};
export const extensionError = (e) =>
	e?.name === 'ZodError'
		? { code: 'VALIDATION', message: e.issues.map((i) => i.message).join(' ') }
		: e instanceof ExtensionError
			? { code: e.code, message: e.message }
			: {
					code: 'EXTENSION_FAILED',
					message: 'The extension failed. Check its compatibility and diagnostics.'
				};
export function extensionPaths() {
	assertInstallationStorage();
	const config = getInstallation(),
		state = config.extension_state;
	return {
		state,
		catalog: join(state, 'catalog.json'),
		code: config.extension_code,
		backups: config.extension_backups
	};
}
export function extensionId(id) {
	if (typeof id !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) || id.length > 40)
		rejectExtension(
			'VALIDATION',
			'Use a lowercase extension ID of at most 40 letters, digits and hyphens.'
		);
	return id;
}
export function validateExtensionManifest(m) {
	extensionId(m?.id);
	if (
		m.manifestVersion !== 1 ||
		m.apiVersion !== 1 ||
		!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version ?? '') ||
		typeof m.name !== 'string' ||
		!m.name.trim() ||
		typeof m.description !== 'string'
	)
		rejectExtension('COMPATIBILITY', 'Unsupported or incomplete extension manifest.');
	const tools = m.mcp ?? [];
	if (
		!Array.isArray(tools) ||
		new Set(tools).size !== tools.length ||
		tools.some((n) => typeof n !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(n))
	)
		rejectExtension('VALIDATION', 'MCP names must be unique lowercase local names.');
	for (const key of ['page', 'server'])
		if (
			(key === 'page' || m[key] !== undefined) &&
			(typeof m[key] !== 'string' ||
				!/^[a-zA-Z0-9_./-]+$/.test(m[key]) ||
				m[key].startsWith('/') ||
				m[key].split('/').some((p) => !p || p === '..' || p === '.'))
		)
			rejectExtension('VALIDATION', 'Entry points must be relative files within the extension.');
	if (
		!m.page.endsWith('.svelte') ||
		(m.database !== undefined && typeof m.database !== 'boolean') ||
		((m.database || tools.length) && !m.server)
	)
		rejectExtension('VALIDATION', 'A database or MCP tools require a server entry point.');
	if (
		Object.keys(m).some(
			(k) =>
				![
					'manifestVersion',
					'id',
					'name',
					'description',
					'version',
					'apiVersion',
					'page',
					'server',
					'database',
					'mcp'
				].includes(k)
		)
	)
		rejectExtension('VALIDATION', 'Unknown extension manifest field.');
	return { ...m, database: m.database ?? false, mcp: tools };
}
export async function inspectExtension(folder) {
	const files = [];
	async function walk(path, prefix = '') {
		for (const entry of (await fs.readdir(path, { withFileTypes: true })).sort((a, b) =>
			a.name.localeCompare(b.name)
		)) {
			if (['.git', 'node_modules'].includes(entry.name)) continue;
			const rel = prefix + entry.name;
			if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
				rejectExtension(
					'VALIDATION',
					'Extension packages cannot contain symlinks or special files.'
				);
			if (entry.isDirectory()) await walk(join(path, entry.name), `${rel}/`);
			else {
				const bytes = await fs.readFile(join(path, entry.name));
				if (/\.(svelte|[cm]?[jt]s)$/.test(rel)) {
					const source = bytes.toString('utf8');
					// A supported import boundary, not a security sandbox for trusted JavaScript.
					for (const match of source.matchAll(
						/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g
					)) {
						const spec = match[1];
						if (
							spec.startsWith('.') &&
							resolve(dirname(join(folder, rel)), spec).startsWith(resolve(folder) + '/')
						)
							continue;
						if (
							['$lib/extension-ui.js', 'svelte', 'zod'].includes(spec) ||
							spec.startsWith('@lucide/svelte/icons/')
						)
							continue;
						rejectExtension(
							'VALIDATION',
							`Unsupported extension import: ${spec}. Use the documented public imports.`
						);
					}
				}
				files.push({ path: rel, bytes });
			}
		}
	}
	await walk(resolve(folder));
	const manifest = validateExtensionManifest(
		JSON.parse(
			(files.find((f) => f.path === 'saturday-extension.json') ?? {}).bytes?.toString() || '{}'
		)
	);
	for (const key of ['page', 'server'])
		if (manifest[key] && !files.some((f) => f.path === manifest[key]))
			rejectExtension('VALIDATION', `Missing ${key} entry point.`);
	const visit = (path, client, seen = new Set()) => {
		if (seen.has(path)) return;
		seen.add(path);
		if (client && (path === manifest.server || /\.server\.[cm]?[jt]s$/.test(path)))
			rejectExtension('VALIDATION', 'Client pages cannot import server modules.');
		const file = files.find((f) => f.path === path);
		if (!file) return;
		for (const m of file.bytes
			.toString('utf8')
			.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)) {
			const spec = m[1];
			if (!client && (spec === '$lib/extension-ui.js' || spec.endsWith('.svelte')))
				rejectExtension('VALIDATION', 'Server modules cannot import browser components.');
			if (spec.startsWith('.')) {
				const next = resolve(dirname(join(folder, path)), spec).slice(resolve(folder).length + 1);
				const target = [next, next + '.js', next + '.svelte'].find((n) =>
					files.some((f) => f.path === n)
				);
				if (target) visit(target, client, seen);
			}
		}
	};
	visit(manifest.page, true);
	if (manifest.server) visit(manifest.server, false);
	const hash = createHash('sha256');
	for (const f of files)
		hash.update(f.path).update('\0').update(String(f.bytes.length)).update('\0').update(f.bytes);
	return { manifest, fingerprint: hash.digest('hex'), files };
}
const session = new AsyncLocalStorage();
export async function withExtensionLock(fn) {
	if (session.getStore()) return fn();
	const p = extensionPaths();
	await fs.mkdir(p.state, { recursive: true, mode: 0o700 });
	const release = await acquireDirectoryLock(join(p.state, 'lock'));
	try {
		return await session.run(true, fn);
	} finally {
		await release();
	}
}
export function validateExtensionNamespaces(entries) {
	const names = new Set();
	for (const entry of entries)
		for (const local of entry.manifest.mcp) {
			const name = toolName(entry.id, local);
			if (names.has(name))
				rejectExtension(
					'CONFLICT',
					`Conflicting extension tool name: ${name}. Choose a distinct ID or local tool name.`
				);
			names.add(name);
		}
}
export async function extensionCatalog() {
	try {
		const c = JSON.parse(await fs.readFile(extensionPaths().catalog, 'utf8'));
		if (
			c.version !== 1 ||
			typeof c.extensions_enabled !== 'boolean' ||
			!Array.isArray(c.installed) ||
			new Set(c.installed.map((e) => e.id)).size !== c.installed.length
		)
			rejectExtension('FORMAT', 'Invalid extension catalog. Use retained recovery data.');
		for (const e of c.installed) {
			extensionId(e.id);
			validateExtensionManifest(e.manifest);
			if (
				e.id !== e.manifest.id ||
				typeof e.enabled !== 'boolean' ||
				!/^[a-f0-9]{64}$/.test(e.fingerprint)
			)
				rejectExtension('FORMAT', 'Invalid installed extension.');
		}
		validateExtensionNamespaces(c.installed);
		return c;
	} catch (e) {
		if (e.code === 'ENOENT') return { version: 1, extensions_enabled: false, installed: [] };
		throw e;
	}
}
export async function setExtensionsEnabled(enabled) {
	if (typeof enabled !== 'boolean') rejectExtension('VALIDATION', 'Invalid master setting.');
	return withExtensionLock(async () => {
		const c = await extensionCatalog();
		c.extensions_enabled = enabled;
		await atomicJson(extensionPaths().catalog, c);
		return c;
	});
}
export async function setExtensionState(id, enabled, { remove = false } = {}) {
	return withExtensionLock(async () => {
		const c = await extensionCatalog(),
			entry = c.installed.find((e) => e.id === extensionId(id));
		if (!entry) rejectExtension('NOT_FOUND', 'Extension is not installed.');
		if (entry.pending_remove && enabled)
			rejectExtension('PENDING_REMOVE', 'Finish removal before re-enabling.');
		entry.enabled = Boolean(enabled);
		if (remove) entry.pending_remove = true;
		await atomicJson(extensionPaths().catalog, c);
		return entry;
	});
}
export async function registerExtensionRuntime() {
	const p = extensionPaths();
	await fs.mkdir(join(p.state, 'processes'), { recursive: true });
	await atomicJson(join(p.state, 'processes', `${process.pid}.json`), { pid: process.pid });
}
export async function assertExtensionProcessesStopped() {
	let names = [];
	try {
		names = await fs.readdir(join(extensionPaths().state, 'processes'));
	} catch (e) {
		if (e.code !== 'ENOENT') throw e;
	}
	for (const name of names) {
		const pid = Number(name.replace('.json', ''));
		if (!Number.isSafeInteger(pid) || pid === process.pid) continue;
		try {
			process.kill(pid, 0);
			rejectExtension(
				'RUNNING',
				'Stop Saturday and all MCP processes before installing, updating, or completing removal.'
			);
		} catch (e) {
			if (e.code !== 'ESRCH') throw e;
			await fs.rm(join(extensionPaths().state, 'processes', name), { force: true });
		}
	}
}
export function toolName(id, local) {
	const name = `extension_${extensionId(id).replaceAll('-', '_')}_${local}`;
	if (name.length > 128) rejectExtension('VALIDATION', 'Tool name is too long.');
	return name;
}
const broken = new Map();
async function installedSourceMatches(entry) {
	try {
		return (
			(await inspectExtension(join(extensionPaths().code, entry.id))).fingerprint ===
			entry.fingerprint
		);
	} catch {
		return false;
	}
}
export async function extensionStatus(registry) {
	const c = await extensionCatalog(),
		pending = await pendingExtensionRecovery();
	const installed = await Promise.all(
		c.installed.map(async (e) => {
			const matches =
				registry[e.id]?.fingerprint === e.fingerprint && (await installedSourceMatches(e));
			const reason = pending
				? 'Recovery required. Stop Saturday and run npm run extension -- recover.'
				: e.pending_remove
					? 'Removal pending: stop Saturday and run the uninstall command.'
					: (broken.get(e.id) ??
						(!matches
							? 'Source/build mismatch. Use an explicit update and restart.'
							: !e.enabled
								? 'Disabled'
								: !c.extensions_enabled
									? 'Enable extensions in Settings.'
									: null));
			return {
				...e,
				available:
					!pending &&
					c.extensions_enabled &&
					e.enabled &&
					!e.pending_remove &&
					matches &&
					!broken.has(e.id),
				reason
			};
		})
	);
	return { enabled: c.extensions_enabled, installed };
}
async function extensionModule(entry, registration) {
	try {
		const mod = registration.server ? await registration.server() : {};
		if (!mod.tools || typeof mod.tools !== 'object') {
			if (entry.manifest.mcp.length) throw new Error('Missing tool exports.');
		}
		if (
			Object.keys(mod.tools ?? {})
				.sort()
				.join() !== [...entry.manifest.mcp].sort().join()
		)
			throw new Error('Manifest/tool definitions disagree.');
		for (const t of Object.values(mod.tools ?? {}))
			if (
				typeof t.handler !== 'function' ||
				typeof t.description !== 'string' ||
				!t.inputSchema?.parse ||
				typeof t.annotations?.readOnlyHint !== 'boolean'
			)
				throw new Error('Invalid tool definition.');
		if (
			entry.manifest.database &&
			(!Array.isArray(mod.migrations) ||
				!mod.migrations.length ||
				mod.migrations.some((m) => typeof m.up !== 'function' || typeof m.name !== 'string'))
		)
			throw new Error('Missing ordered database migrations.');
		return mod;
	} catch {
		broken.set(entry.id, 'Extension initialization failed. Check its exports and rebuild.');
		rejectExtension('UNAVAILABLE', broken.get(entry.id));
	}
}
export async function runExtension(id, registry, operation) {
	return withExtensionLock(async () => {
		await assertExtensionRecoveryClear(id);
		const c = await extensionCatalog(),
			entry = c.installed.find((e) => e.id === extensionId(id)),
			registration = registry[id];
		if (!c.extensions_enabled || !entry?.enabled || entry.pending_remove)
			rejectExtension('DISABLED', 'This extension is disabled. Manage extensions in Settings.');
		if (
			!registration ||
			registration.fingerprint !== entry.fingerprint ||
			!(await installedSourceMatches(entry))
		)
			rejectExtension('BUILD_MISMATCH', 'Rebuild and restart Saturday for this extension.');
		if (broken.has(id)) rejectExtension('UNAVAILABLE', broken.get(id));
		const mod = await extensionModule(entry, registration);
		try {
			return await operation(mod, extensionContext(entry, mod));
		} catch (e) {
			if (['SCHEMA', 'RECOVERY_REQUIRED'].includes(e.code)) broken.set(id, e.message);
			throw e;
		}
	});
}
export async function runExtensionTool(id, name, input, registry) {
	return runExtension(id, registry, async (mod, ctx) => {
		const tool = mod.tools?.[name];
		if (!tool) rejectExtension('NOT_FOUND', 'Extension tool is unavailable.');
		return tool.handler(tool.inputSchema.parse(input), ctx);
	});
}
export function dataPath(id) {
	return join(extensionPaths().state, extensionId(id), 'database.sqlite');
}
const metadataSchema =
	'CREATE TABLE IF NOT EXISTS extension_metadata (id INTEGER PRIMARY KEY CHECK(id=1), extension_id TEXT NOT NULL, data_id TEXT NOT NULL, schema_version INTEGER NOT NULL, generation TEXT NOT NULL); CREATE TABLE IF NOT EXISTS extension_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL);';
function verifySchema(db, mod, version) {
	const expected = new DatabaseSync(':memory:', { allowExtension: false });
	const schema = (d) =>
		JSON.stringify(
			d
				.prepare(
					"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
				)
				.all()
		);
	try {
		expected.exec('PRAGMA foreign_keys=ON;');
		expected.exec(metadataSchema);
		for (const migration of mod.migrations.slice(0, version)) migration.up(expected);
		if (schema(db) !== schema(expected))
			rejectExtension(
				'SCHEMA',
				'Extension database structure differs from its migrations. Restore compatible data.'
			);
	} finally {
		expected.close();
	}
}
function database(entry, mod, fn, { migrate = false, path = dataPath(entry.id) } = {}) {
	if (!entry.manifest.database) rejectExtension('VALIDATION', 'This extension has no database.');
	// Directory is prepared before creating a context by the async host boundary.
	if (!migrate && !existsSync(path))
		rejectExtension(
			'SCHEMA',
			'Extension database is missing. Restore its backup before proceeding.'
		);
	const db = new DatabaseSync(path, { allowExtension: false });
	db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
	try {
		if (migrate) db.exec(metadataSchema);
		let meta = db.prepare('SELECT * FROM extension_metadata WHERE id=1').get();
		if (!meta && migrate) {
			db.prepare('INSERT INTO extension_metadata VALUES (1,?,?,0,?)').run(
				entry.id,
				randomUUID(),
				randomUUID()
			);
			meta = db.prepare('SELECT * FROM extension_metadata WHERE id=1').get();
		}
		if (
			!meta ||
			(!migrate && meta.schema_version !== mod.migrations.length) ||
			meta.extension_id !== entry.id ||
			meta.schema_version > mod.migrations.length
		)
			rejectExtension(
				'SCHEMA',
				'Extension database is incompatible; install matching code or restore recovery data.'
			);
		const applied = db.prepare('SELECT * FROM extension_migrations ORDER BY version').all();
		if (
			applied.length !== meta.schema_version ||
			applied.some((m, i) => m.version !== i + 1 || mod.migrations[i]?.name !== m.name)
		)
			rejectExtension('SCHEMA', 'Extension migration history is incompatible.');
		if (migrate) verifySchema(db, mod, meta.schema_version);
		if (migrate && meta.schema_version < mod.migrations.length) {
			db.exec('BEGIN IMMEDIATE');
			try {
				for (let i = meta.schema_version; i < mod.migrations.length; i++) {
					mod.migrations[i].up(db);
					db.prepare('INSERT INTO extension_migrations VALUES (?,?)').run(
						i + 1,
						mod.migrations[i].name
					);
				}
				db.prepare('UPDATE extension_metadata SET schema_version=? WHERE id=1').run(
					mod.migrations.length
				);
				db.exec('COMMIT');
			} catch (e) {
				db.exec('ROLLBACK');
				throw e;
			}
		}
		if (migrate) verifySchema(db, mod, mod.migrations.length);
		const result = fn(db);
		if (result?.then) rejectExtension('VALIDATION', 'Database callbacks must be synchronous.');
		return result;
	} finally {
		db.close();
	}
}
function extensionContext(entry, mod) {
	const reference = (record) => ({ dataset_id: databaseIdentity()?.dataset_id, id: record.id });
	const resolveReference = (ref, read) => {
		if (!ref?.dataset_id || ref.dataset_id !== databaseIdentity()?.dataset_id) return null;
		try {
			return read(ref.id);
		} catch (e) {
			if (e.code === 'not_found') return null;
			throw e;
		}
	};
	return {
		id: entry.id,
		reject: rejectExtension,
		database: (fn) => database(entry, mod, fn),
		dataToken: () =>
			database(
				entry,
				mod,
				(db) => db.prepare('SELECT generation FROM extension_metadata WHERE id=1').get().generation
			),
		core: {
			jobs: {
				get: getJob,
				search: searchJobs,
				reference,
				resolve: (ref) => resolveReference(ref, getJob)
			},
			networks: {
				get: getNetwork,
				list: listNetworks,
				reference,
				resolve: (ref) => resolveReference(ref, getNetwork)
			},
			documents: { get: getDocument, list: listDocuments },
			dataset: databaseIdentity
		}
	};
}
export async function initializeExtension(entry, registration, { path = dataPath(entry.id) } = {}) {
	const mod = await extensionModule(entry, registration);
	if (entry.manifest.database) {
		await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
		database(entry, mod, () => {}, { migrate: true, path });
	}
	broken.delete(entry.id);
	return mod;
}
export async function listExtensionBackups() {
	const root = extensionPaths().backups;
	let names = [];
	try {
		names = await fs.readdir(root);
	} catch (e) {
		if (e.code !== 'ENOENT') throw e;
	}
	const records = [];
	for (const name of names.filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))) {
		const m = JSON.parse(await fs.readFile(join(root, name), 'utf8'));
		if (m.format === 'saturday.extension-backup' && m.version === 1) records.push(m);
	}
	return records.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async function archivePath(id) {
	if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))
		rejectExtension('VALIDATION', 'Invalid backup ID.');
	return join(extensionPaths().backups, `${id}.zip`);
}
export async function getExtensionBackup(id) {
	const path = await archivePath(id);
	const metadata = JSON.parse(await fs.readFile(path.replace(/\.zip$/, '.json'), 'utf8'));
	if ((await fileDigest(path)) !== metadata.sha256)
		rejectExtension('INTEGRITY', 'Extension backup changed.');
	return { path, metadata };
}
async function fileDigest(path) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}
export async function createExtensionBackup(id) {
	return withExtensionLock(async () => {
		const c = await extensionCatalog(),
			entry = c.installed.find((e) => e.id === extensionId(id));
		await assertExtensionRecoveryClear();
		const path = dataPath(id);
		await fs.access(path);
		const temp = join(extensionPaths().state, `snapshot-${randomUUID()}.sqlite`);
		const db = new DatabaseSync(path, { allowExtension: false });
		let meta;
		try {
			meta = db.prepare('SELECT * FROM extension_metadata WHERE id=1').get();
			db.prepare('VACUUM INTO ?').run(temp);
		} finally {
			db.close();
		}
		try {
			const backup_id = randomUUID();
			const provenance =
				entry ?? JSON.parse(await fs.readFile(join(dirname(path), 'identity.json'), 'utf8'));
			const manifest = {
				format: 'saturday.extension-backup',
				version: 1,
				backup_id,
				extension_id: id,
				extension_version: provenance.manifest.version,
				api_version: provenance.manifest.apiVersion,
				schema_version: meta.schema_version,
				data_id: meta.data_id,
				source: provenance.source,
				fingerprint: provenance.fingerprint,
				created_at: new Date().toISOString(),
				database_sha256: await fileDigest(temp),
				core_dataset_id: databaseIdentity()?.dataset_id ?? null
			};
			await fs.mkdir(extensionPaths().backups, { recursive: true, mode: 0o700 });
			const target = await archivePath(backup_id),
				pending = `${target}.pending`;
			const zip = new yazl.ZipFile();
			zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
			zip.addFile(temp, 'database.sqlite');
			const output = pipeline(
				zip.outputStream,
				createWriteStream(pending, { flags: 'wx', mode: 0o600 })
			);
			zip.end();
			await output;
			await syncExtensionPath(pending);
			await fs.rename(pending, target);
			const result = {
				...manifest,
				sha256: await fileDigest(target),
				bytes: (await fs.stat(target)).size
			};
			await atomicJson(target.replace(/\.zip$/, '.json'), result);
			return result;
		} finally {
			await fs.rm(temp, { force: true });
		}
	});
}
async function extractBackup(path) {
	const root = await fs.mkdtemp(join(extensionPaths().state, 'import-'));
	let zip;
	try {
		zip = await new Promise((res, rej) =>
			yauzl.open(path, { lazyEntries: true }, (e, z) => (e ? rej(e) : res(z)))
		);
		const seen = new Set();
		await new Promise((res, rej) => {
			zip.on('error', rej);
			zip.on('end', res);
			zip.on('entry', (entry) => {
				(async () => {
					const name = entry.fileName,
						mode = (entry.externalFileAttributes >>> 16) & 0o170000;
					if (
						!['manifest.json', 'database.sqlite'].includes(name) ||
						seen.has(name) ||
						(mode && mode !== 0o100000) ||
						!Number.isSafeInteger(entry.uncompressedSize) ||
						entry.uncompressedSize < 0 ||
						(name === 'manifest.json' && entry.uncompressedSize > 65536)
					)
						rejectExtension('FORMAT', 'Invalid extension archive entries.');
					seen.add(name);
					const stream = await new Promise((r, j) =>
						zip.openReadStream(entry, (e, s) => (e ? j(e) : r(s)))
					);
					await pipeline(stream, createWriteStream(join(root, name), { flags: 'wx', mode: 0o600 }));
					zip.readEntry();
				})().catch(rej);
			});
			zip.readEntry();
		});
		if (seen.size !== 2) rejectExtension('FORMAT', 'Extension archive is incomplete.');
		const m = JSON.parse(await fs.readFile(join(root, 'manifest.json'), 'utf8'));
		extensionId(m.extension_id);
		if (
			m.format !== 'saturday.extension-backup' ||
			m.version !== 1 ||
			m.api_version !== 1 ||
			!Number.isInteger(m.schema_version) ||
			m.schema_version < 1 ||
			!/^[a-f0-9]{64}$/.test(m.fingerprint ?? '') ||
			(await fileDigest(join(root, 'database.sqlite'))) !== m.database_sha256
		)
			rejectExtension('FORMAT', 'Unsupported or corrupt extension backup.');
		const db = new DatabaseSync(join(root, 'database.sqlite'), {
			readOnly: true,
			allowExtension: false
		});
		try {
			const meta = db.prepare('SELECT * FROM extension_metadata WHERE id=1').get();
			if (
				db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' ||
				db.prepare('PRAGMA foreign_key_check').all().length !== 0 ||
				meta.extension_id !== m.extension_id ||
				meta.schema_version !== m.schema_version ||
				meta.data_id !== m.data_id
			)
				rejectExtension('INTEGRITY', 'Extension database identity does not match backup.');
		} finally {
			db.close();
		}
		return { root, manifest: m };
	} catch (e) {
		zip?.close();
		await fs.rm(root, { recursive: true, force: true });
		throw e;
	}
}
export async function importExtensionBackup(stream) {
	return withExtensionLock(async () => {
		const temp = join(extensionPaths().state, `upload-${randomUUID()}`);
		let extracted;
		try {
			await pipeline(stream, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
			extracted = await extractBackup(temp);
			const id = randomUUID();
			await fs.mkdir(extensionPaths().backups, { recursive: true });
			const target = await archivePath(id);
			await syncExtensionPath(temp);
			await fs.rename(temp, target);
			const m = {
				...extracted.manifest,
				backup_id: id,
				sha256: await fileDigest(target),
				bytes: (await fs.stat(target)).size
			};
			await atomicJson(target.replace(/\.zip$/, '.json'), m);
			return m;
		} finally {
			await fs.rm(temp, { force: true });
			if (extracted) await fs.rm(extracted.root, { recursive: true, force: true });
		}
	});
}
export async function prepareExtensionRestore(id, backupId, registry) {
	return withExtensionLock(async () => {
		await assertExtensionRecoveryClear();
		const c = await extensionCatalog(),
			entry = c.installed.find((e) => e.id === extensionId(id)),
			reg = registry[id];
		if (
			!entry ||
			!entry.manifest.database ||
			entry.pending_remove ||
			reg?.fingerprint !== entry.fingerprint
		)
			rejectExtension(
				'UNAVAILABLE',
				'Install and rebuild compatible extension code before restoring.'
			);
		const source = await getExtensionBackup(backupId),
			extracted = await extractBackup(source.path);
		try {
			const mod = await extensionModule(entry, reg),
				m = extracted.manifest;
			if (m.extension_id !== id || m.schema_version > mod.migrations.length)
				rejectExtension('SCHEMA', 'This backup needs compatible extension code.');
			database(entry, mod, () => {}, {
				migrate: true,
				path: join(extracted.root, 'database.sqlite')
			});
			const restore_id = randomUUID(),
				current = await fileDigest(dataPath(id));
			const counts = (path) => {
				const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
				try {
					return Object.fromEntries(
						db
							.prepare(
								"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'extension_%' ORDER BY name"
							)
							.all()
							.map((t) => [
								t.name,
								db
									.prepare('SELECT count(*) AS total FROM "' + t.name.replaceAll('"', '""') + '"')
									.get().total
							])
					);
				} finally {
					db.close();
				}
			};
			const preview = {
				current_counts: counts(dataPath(id)),
				incoming_counts: counts(join(extracted.root, 'database.sqlite')),
				current_dataset_id: databaseIdentity()?.dataset_id ?? null,
				backup_dataset_id: m.core_dataset_id ?? null,
				restore_id,
				extension_id: id,
				backup_id: backupId,
				extension_version: m.extension_version,
				installed_version: entry.manifest.version,
				schema_version: m.schema_version,
				result_schema_version: mod.migrations.length,
				created_at: new Date().toISOString(),
				expires_at: Date.now() + 600000,
				current_hash: current,
				source_hash: source.metadata.sha256,
				fingerprint: entry.fingerprint
			};
			await atomicJson(join(extensionPaths().state, `${restore_id}.restore.json`), preview);
			return preview;
		} finally {
			await fs.rm(extracted.root, { recursive: true, force: true });
		}
	});
}
function preserveAllocations(original, candidate) {
	const current = new DatabaseSync(original, { readOnly: true, allowExtension: false }),
		incoming = new DatabaseSync(candidate, { allowExtension: false });
	try {
		if (
			current.prepare('SELECT data_id FROM extension_metadata WHERE id=1').get().data_id !==
			incoming.prepare('SELECT data_id FROM extension_metadata WHERE id=1').get().data_id
		)
			return;
		if (!current.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()) return;
		for (const row of current.prepare('SELECT name,seq FROM sqlite_sequence').all()) {
			const table = incoming
				.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
				.get(row.name);
			if (!table || !/\bAUTOINCREMENT\b/i.test(table.sql)) continue;
			const prior = incoming.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(row.name);
			if (prior)
				incoming
					.prepare('UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name=?')
					.run(row.seq, row.name);
			else
				incoming
					.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)')
					.run(row.name, row.seq);
		}
	} finally {
		current.close();
		incoming.close();
	}
}
export async function restoreExtension({ restore_id, confirm }, registry) {
	if (confirm !== true)
		rejectExtension('CONFIRMATION', 'Review and confirm extension restoration.');
	return withExtensionLock(async () => {
		if (!/^[a-f0-9-]{36}$/.test(restore_id ?? ''))
			rejectExtension('VALIDATION', 'Invalid restore preview.');
		const previewPath = join(extensionPaths().state, `${restore_id}.restore.json`),
			p = JSON.parse(await fs.readFile(previewPath, 'utf8'));
		if (p.expires_at < Date.now()) rejectExtension('EXPIRED', 'Prepare a new restore preview.');
		const entry = (await extensionCatalog()).installed.find((e) => e.id === p.extension_id),
			reg = registry[p.extension_id];
		if (
			!entry ||
			entry.pending_remove ||
			entry.fingerprint !== p.fingerprint ||
			reg?.fingerprint !== p.fingerprint
		)
			rejectExtension('CONFLICT', 'Extension code changed; prepare a new preview.');
		const path = dataPath(p.extension_id);
		if ((await fileDigest(path)) !== p.current_hash)
			rejectExtension('CONFLICT', 'Extension data changed; prepare a new preview.');
		const source = await getExtensionBackup(p.backup_id);
		if (source.metadata.sha256 !== p.source_hash) rejectExtension('CONFLICT', 'Backup changed.');
		const extracted = await extractBackup(source.path);
		const candidate = `${path}.candidate`,
			recovery = `${path}.recovery-${randomUUID()}`;
		try {
			const mod = await extensionModule(entry, reg);
			await fs.copyFile(join(extracted.root, 'database.sqlite'), candidate);
			database(
				entry,
				mod,
				(db) =>
					db.prepare('UPDATE extension_metadata SET generation=? WHERE id=1').run(randomUUID()),
				{ migrate: true, path: candidate }
			);
			preserveAllocations(path, candidate);
			const old = await createExtensionBackup(p.extension_id);
			await fs.copyFile(path, recovery);
			await syncExtensionPath(recovery);
			await syncExtensionPath(candidate);
			await syncExtensionPath(dirname(path), { recursive: false });
			await atomicJson(join(extensionPaths().state, 'recovery.json'), {
				version: 1,
				replacements: [{ target: path, previous: recovery }],
				kind: 'restore'
			});
			await fs.rename(candidate, path);
			await syncExtensionPath(dirname(path), { recursive: false });
			await fs.rm(previewPath);
			broken.delete(entry.id);
			await fs.rm(join(extensionPaths().state, 'recovery.json'));
			await syncExtensionPath(extensionPaths().state, { recursive: false });
			await fs.rm(recovery, { force: true });
			return { restored: true, extension_id: p.extension_id, recovery_backup: old.backup_id };
		} finally {
			await fs.rm(candidate, { force: true });
			await fs.rm(extracted.root, { recursive: true, force: true });
		}
	});
}

// A durable journal gates extensions after an interrupted publication. Recovery is explicit and offline.
export async function pendingExtensionRecovery() {
	try {
		return JSON.parse(await fs.readFile(join(extensionPaths().state, 'recovery.json'), 'utf8'));
	} catch (e) {
		if (e.code === 'ENOENT') return null;
		throw e;
	}
}
export async function assertExtensionRecoveryClear() {
	if (await pendingExtensionRecovery())
		rejectExtension(
			'RECOVERY_REQUIRED',
			'Extension recovery is required. Stop Saturday and run npm run extension -- recover.'
		);
}
export async function recoverExtensions() {
	return withExtensionLock(async () => {
		await assertExtensionProcessesStopped();
		const journal = await pendingExtensionRecovery();
		if (!journal) return { recovered: false };
		if (journal.version !== 1 || !Array.isArray(journal.replacements))
			rejectExtension(
				'FORMAT',
				'Unsupported recovery journal. Preserve recovery files for manual review.'
			);
		for (const r of [...journal.replacements].reverse()) {
			if (r.previous) {
				await fs.access(r.previous);
				const temp = `${r.target}.recover-${randomUUID()}`;
				await fs.cp(r.previous, temp, { recursive: true });
				await fs.rm(r.target, { recursive: true, force: true });
				await syncExtensionPath(temp);
				await fs.rename(temp, r.target);
				await syncExtensionPath(dirname(r.target), { recursive: false });
			} else await fs.rm(r.target, { recursive: true, force: true });
		}
		await fs.rm(join(extensionPaths().state, 'recovery.json'));
		await syncExtensionPath(extensionPaths().state, { recursive: false });
		for (const r of journal.replacements)
			if (r.previous) await fs.rm(r.previous, { recursive: true, force: true });
		broken.clear();
		return { recovered: true };
	});
}

// Flush retained/published objects before clearing their recovery journal.
export async function syncExtensionPath(path, { recursive = true } = {}) {
	const stat = await fs.lstat(path);
	if (stat.isSymbolicLink()) return;
	if (stat.isDirectory() && recursive)
		for (const name of await fs.readdir(path)) await syncExtensionPath(join(path, name));
	const handle = await fs.open(path, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}
