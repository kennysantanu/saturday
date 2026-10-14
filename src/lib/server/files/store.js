import { withServerActivity } from '../server-lifecycle.js';
import {
	atomicJson,
	syncDirectory,
	acquireDirectoryLock as acquireInstallationLock
} from '../installation.js';
export { atomicJson } from '../installation.js';
import { getInstallation, assertInstallationStorage } from '../installation.js';
import * as fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getProjectRoot, withDatabase, databaseIdentity } from '../database.js';
import { parseRecordId, recordIdInputSchema } from '../validation.js';
import { fileType, documentDesignations } from '../../file-types.js';
import { storageCompatibility, assertManifestCompatibility } from '../compatibility.js';

export const UPLOAD_LIMIT = 25 * 1024 * 1024;
export const TEXT_LIMIT = 1024 * 1024;
const fileSession = new AsyncLocalStorage();
export const manifestHash = (m) => createHash('sha256').update(JSON.stringify(m)).digest('hex');
export function assertDataset(m, identity = databaseIdentity()) {
	if (!m || !identity || identity.dataset_id !== m.dataset_id)
		reject(
			'DATASET_MISMATCH',
			'Job files belong to a different database dataset. Restore matching database/files backups; files have been retained.'
		);
}
export class FileError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

export function publicFileError(e) {
	if (e?.code === 'BUSY') return { code: 'BUSY', message: e.message };
	if (e?.code === 'FORMAT' || String(e?.message).includes('Unsupported database schema'))
		return { code: 'FORMAT', message: e.message };
	return e instanceof FileError
		? { code: e.code, message: e.message }
		: {
				code: 'STORAGE',
				message:
					'File operation failed. Check permissions, available disk space, and store integrity.'
			};
}

export function reject(code, message) {
	throw new FileError(code, message);
}
export function filePaths() {
	const config = getInstallation(),
		root = config.files;
	return {
		root,
		state: config.files_state,
		backups: config.file_backups,
		legacyBackups: `${root}.backups`
	};
}
export function filename(value) {
	if (typeof value !== 'string') reject('VALIDATION', 'Enter a filename.');
	const name = value.normalize('NFC');
	if (
		!name ||
		Buffer.byteLength(name) > 255 ||
		/[\/\\\x00-\x1f\x7f<>:"|?*]/.test(name) ||
		/[. ]$/.test(name) ||
		/^(\.|\.\.|con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
	)
		reject('VALIDATION', 'Use a portable filename of 1–255 UTF-8 bytes without path separators.');
	return name;
}
export function scopePrefix(scope = 'documents', checkJob = true, manifest) {
	if (scope === 'documents') return 'documents';
	const parsed = recordIdInputSchema.safeParse(scope);
	if (!parsed.success) reject('VALIDATION', 'Choose documents or a positive numeric job ID.');
	scope = parsed.data;
	if (checkJob) assertDataset(manifest ?? fileSession.getStore()?.manifest);
	if (checkJob && !withDatabase((db) => db.prepare('SELECT id FROM jobs WHERE id=?').get(scope)))
		reject('NOT_FOUND', 'Job not found. Use Settings to recover unmatched attachments.');
	return `jobs/${scope}`;
}
export function validKey(key) {
	const parts = typeof key === 'string' ? key.split('/') : [];
	if (parts.length === 2 && parts[0] === 'documents') {
		if (filename(parts[1]) !== parts[1])
			reject('VALIDATION', 'Filename must use Unicode NFC normalization.');
	} else if (
		parts.length === 3 &&
		parts[0] === 'jobs' &&
		recordIdInputSchema.safeParse(parts[1]).success
	) {
		if (filename(parts[2]) !== parts[2])
			reject('VALIDATION', 'Filename must use Unicode NFC normalization.');
	} else reject('VALIDATION', 'Invalid document key.');
	return key;
}
export async function regularPath(root, key, allowMissing = false) {
	let current = root;
	for (const part of ['', ...key.split('/')].filter((p, i) => p || i === 0)) {
		if (part) current = join(current, part);
		try {
			const st = await fs.lstat(current);
			if (st.isSymbolicLink() || (current !== join(root, key) && !st.isDirectory()))
				reject('STORAGE', 'Unsafe storage path.');
		} catch (e) {
			if (e.code === 'ENOENT' && allowMissing) break;
			throw e;
		}
	}
	return join(root, key);
}
export async function ensureDiskSpace(bytes) {
	try {
		const stat = await fs.statfs(filePaths().state);
		const available = stat.bavail * stat.bsize;
		if (Number.isFinite(available) && bytes > available)
			reject(
				'DISK_SPACE',
				'Not enough disk space for complete staging and recovery. Free space and try again.'
			);
	} catch (e) {
		if (e instanceof FileError) throw e;
		if (!['ENOSYS', 'ENOTSUP', 'EINVAL'].includes(e.code)) throw e;
	}
}
export async function digest(path) {
	const hash = createHash('sha256');
	let size = 0;
	await pipeline(
		createReadStream(path),
		new Transform({
			transform(chunk, _, cb) {
				hash.update(chunk);
				size += chunk.length;
				cb();
			}
		})
	);
	return { size, sha256: hash.digest('hex') };
}
export class LocalFileStore {
	constructor(root = filePaths().root) {
		this.root = root;
	}
	async *list(prefix) {
		const dir = await regularPath(this.root, prefix, true);
		let names;
		try {
			names = await fs.readdir(dir);
		} catch (e) {
			if (e.code === 'ENOENT') return;
			throw e;
		}
		for (const name of names) {
			const key = `${prefix}/${name}`;
			const path = await regularPath(this.root, key);
			const st = await fs.lstat(path);
			if (!st.isFile()) reject('STORAGE', 'Unexpected directory in file store.');
			yield key;
		}
	}
	async open(key, { range } = {}) {
		validKey(key);
		const path = await regularPath(this.root, key);
		const handle = await fs.open(path, 'r');
		const st = await handle.stat();
		if (!st.isFile()) {
			await handle.close();
			reject('STORAGE', 'Not a regular file.');
		}
		return {
			stream: handle.createReadStream(range ? { start: range.start, end: range.end } : {}),
			size: st.size
		};
	}
	async head(key) {
		validKey(key);
		try {
			const path = await regularPath(this.root, key);
			const st = await fs.stat(path);
			return { size: st.size };
		} catch (e) {
			if (e.code === 'ENOENT') return null;
			throw e;
		}
	}
	async put(key, stream) {
		validKey(key);
		const path = await regularPath(this.root, key, true);
		await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
		const temp = `${path}.${randomUUID()}.tmp`;
		try {
			await pipeline(stream, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
			const handle = await fs.open(temp, 'r');
			try {
				await handle.sync();
			} finally {
				await handle.close();
			}
			await fs.rename(temp, path);
			await syncDirectory(dirname(path));
		} catch (e) {
			await fs.rm(temp, { force: true });
			throw e;
		}
	}
	async delete(key) {
		validKey(key);
		const path = await regularPath(this.root, key, true);
		await fs.rm(path, { force: true });
		try {
			await syncDirectory(dirname(path));
		} catch (e) {
			if (e.code !== 'ENOENT') throw e;
		}
	}
}
export function validateManifest(m) {
	try {
		assertManifestCompatibility(m);
	} catch (e) {
		reject('FORMAT', e.message);
	}
	if (
		typeof m.token !== 'string' ||
		!Array.isArray(m.documents) ||
		!m.designations ||
		typeof m.designations !== 'object'
	)
		reject('FORMAT', 'Malformed file manifest.');
	const ids = new Set(),
		keys = new Set();
	for (const d of m.documents) {
		validKey(d.key);
		if (
			typeof d.id !== 'string' ||
			!/^[a-f0-9-]{36}$/i.test(d.id) ||
			ids.has(d.id) ||
			keys.has(d.key.toLowerCase()) ||
			!Number.isSafeInteger(d.size) ||
			d.size < 0 ||
			!/^([a-f0-9]{64})$/.test(d.sha256) ||
			typeof d.token !== 'string' ||
			!['manual', 'mcp'].includes(d.created_via) ||
			!Number.isFinite(Date.parse(d.created_at)) ||
			!Number.isFinite(Date.parse(d.updated_at))
		)
			reject('FORMAT', 'Invalid or duplicate document metadata.');
		ids.add(d.id);
		keys.add(d.key.toLowerCase());
	}
	for (const [key, id] of Object.entries(m.designations)) {
		const definition = Object.hasOwn(documentDesignations, key) ? documentDesignations[key] : null;
		const d = m.documents.find((d) => d.id === id);
		if (
			!definition ||
			(m.format_version === 1 && key !== 'master_cv') ||
			!d ||
			!d.key.startsWith('documents/') ||
			fileType(d.key).type !== definition.format ||
			d.size > TEXT_LIMIT
		)
			reject('FORMAT', 'Invalid document designation.');
	}

	return m;
}
// Version 2 adds validated Profile designations; conversions preserve document identity.
export function migrateManifest(input) {
	const m = structuredClone(validateManifest(input));
	m.format_version = storageCompatibility.manifest.version;
	return validateManifest(m);
}
async function recover() {
	const p = filePaths();
	let j;
	try {
		j = JSON.parse(await fs.readFile(join(p.state, 'journal.json'), 'utf8'));
	} catch (e) {
		if (e.code === 'ENOENT') return;
		throw e;
	}
	validateManifest(j.manifest);
	// Reject unsupported or replaced storage before replaying pending writes.
	try {
		const current = validateManifest(
			JSON.parse(await fs.readFile(join(p.root, 'manifest.json'), 'utf8'))
		);
		if (
			j.previous_hash &&
			manifestHash(current) !== j.previous_hash &&
			manifestHash(current) !== manifestHash(j.manifest)
		)
			reject(
				'CONFLICT',
				'File store changed during publication. Stop Saturday and use offline recovery.'
			);
	} catch (e) {
		if (e.code !== 'ENOENT') throw e;
	}
	databaseIdentity();
	const adapter = new LocalFileStore();
	for (let i = 0; i < j.changes.length; i++) {
		const c = j.changes[i];
		validKey(c.key);
		if (c.remove) await adapter.delete(c.key);
		else await adapter.put(c.key, createReadStream(join(p.state, 'pending', String(i))));
	}
	await atomicJson(join(p.root, 'manifest.json'), j.manifest);
	await fs.rm(join(p.state, 'journal.json'));
	await fs.rm(join(p.state, 'pending'), { recursive: true, force: true });
}
export async function acquireDirectoryLock(lock, options) {
	try {
		return await acquireInstallationLock(lock, options);
	} catch (e) {
		if (e.code === 'BUSY') reject('BUSY', e.message);
		throw e;
	}
}
export async function withFileLock(operation, { initialize = true, allowSession = false } = {}) {
	return withServerActivity(async () => {
		assertInstallationStorage({ allowFileRecovery: !initialize || allowSession });
		const p = filePaths();
		for (const path of [p.root, p.state, p.backups]) {
			try {
				const st = await fs.lstat(path);
				if (st.isSymbolicLink() || !st.isDirectory())
					reject('STORAGE', 'Storage roots must be ordinary directories, not symlinks.');
			} catch (e) {
				if (e.code !== 'ENOENT') throw e;
			}
		}
		await fs.mkdir(p.state, { recursive: true, mode: 0o700 });
		const release = await acquireDirectoryLock(join(p.state, 'lock'));
		try {
			if (!allowSession) {
				try {
					await fs.access(join(p.state, 'pair-session.json'));
					reject(
						'RECOVERY_REQUIRED',
						'An interrupted coordinated restore requires offline recovery: npm run files -- recover-pair'
					);
				} catch (e) {
					if (e.code !== 'ENOENT') throw e;
				}
			}
			await recover();
			if (!initialize) return await operation(null);
			await fs.mkdir(p.root, { recursive: true, mode: 0o700 });
			let m;
			try {
				m = JSON.parse(await fs.readFile(await regularPath(p.root, 'manifest.json'), 'utf8'));
			} catch (e) {
				if (e.code !== 'ENOENT') throw e;
				const names = await fs.readdir(p.root);
				if (names.length)
					reject('FORMAT', 'Existing files have no manifest. Use offline recovery.');
				m = {
					format: storageCompatibility.manifest.format,
					format_version: storageCompatibility.manifest.version,
					dataset_id: (
						databaseIdentity() ??
						withDatabase((db) =>
							db.prepare('SELECT format, dataset_id FROM app_metadata WHERE id=1').get()
						)
					).dataset_id,
					token: randomUUID(),
					documents: [],
					designations: {}
				};
				await atomicJson(join(p.root, 'manifest.json'), m);
			}
			validateManifest(m);
			if (m.format_version !== storageCompatibility.manifest.version) {
				await atomicJson(join(p.state, 'manifest-v1.json'), m);
				m = migrateManifest(m);
				m.token = randomUUID();
				await atomicJson(join(p.root, 'manifest.json'), m);
			}
			databaseIdentity();
			return await fileSession.run({ manifest: structuredClone(m), hash: manifestHash(m) }, () =>
				operation(m)
			);
		} finally {
			await release();
		}
	});
}

export async function commitManifest(manifest, changes = [], { restore = false } = {}) {
	const p = filePaths();
	const session = fileSession.getStore();
	if (!session) reject('BUSY', 'File writes require the file-store lock.');
	const current = validateManifest(
		JSON.parse(await fs.readFile(join(p.root, 'manifest.json'), 'utf8'))
	);
	if (manifestHash(current) !== session.hash)
		reject('CONFLICT', 'File store changed. Reload and restart Saturday before saving.');
	if (!restore && manifest.dataset_id !== current.dataset_id)
		reject('DATASET_MISMATCH', 'Normal file edits cannot change the dataset identity.');
	databaseIdentity();
	if (!restore && changes.some((c) => c.key.startsWith('jobs/'))) assertDataset(manifest);
	manifest.token = randomUUID();
	validateManifest(manifest);
	await fs.rm(join(p.state, 'pending'), { recursive: true, force: true });
	await fs.mkdir(join(p.state, 'pending'), { mode: 0o700 });
	for (let i = 0; i < changes.length; i++) {
		const c = changes[i];
		if (!c.remove) {
			const target = join(p.state, 'pending', String(i));
			if (c.path) await fs.copyFile(c.path, target);
			else await fs.writeFile(target, c.bytes, { mode: 0o600 });
		}
	}
	for (let i = 0; i < changes.length; i++)
		if (!changes[i].remove) {
			const h = await fs.open(join(p.state, 'pending', String(i)), 'r');
			try {
				await h.sync();
			} finally {
				await h.close();
			}
		}
	await syncDirectory(join(p.state, 'pending'));
	await atomicJson(join(p.state, 'journal.json'), {
		previous_hash: session.hash,
		manifest,
		changes: changes.map((c) => ({ key: c.key, remove: !!c.remove }))
	});
	await recover();
	session.hash = manifestHash(manifest);
	session.manifest = structuredClone(manifest);
}
export function entryFor(m, id, scope = 'documents') {
	const prefix = scopePrefix(scope);
	const d = m.documents.find((d) => d.id === id);
	if (!d || !d.key.startsWith(`${prefix}/`))
		reject('NOT_FOUND', 'Document not found in this scope.');
	return d;
}
export function checkToken(actual, expected) {
	if (!expected || actual !== expected)
		reject('CONFLICT', 'The document or catalog changed. Reload and review before saving.');
}
export async function verifiedPath(d) {
	const path = await regularPath(filePaths().root, d.key);
	const hash = await digest(path);
	if (hash.size !== d.size || hash.sha256 !== d.sha256)
		reject(
			'INTEGRITY',
			'File differs from its manifest. Restore a valid backup; external editing is unsupported.'
		);
	return path;
}
export async function readText(d) {
	if (!fileType(d.key).text)
		reject('UNSUPPORTED_FORMAT', 'This file supports metadata and download only.');
	if (d.size > TEXT_LIMIT) reject('SIZE_LIMIT', 'Text editing is limited to 1 MiB.');
	const bytes = await fs.readFile(await verifiedPath(d));
	try {
		return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch {
		reject('ENCODING', 'Text must be valid UTF-8.');
	}
}
export function info(d, m) {
	const kind = fileType(d.key);
	return {
		id: d.id,
		key: d.key,
		size: d.size,
		sha256: d.sha256,
		created_via: d.created_via,
		created_at: d.created_at,
		updated_at: d.updated_at,
		token: d.token,
		filename: basename(d.key),
		scope: d.key.startsWith('documents/')
			? 'documents'
			: parseRecordId(d.key.split('/')[1], 'job_id'),
		designation:
			m.designations.master_cv === d.id
				? 'master_cv'
				: (Object.entries(m.designations).find(([, id]) => id === d.id)?.[0] ?? null),
		designations: Object.entries(m.designations)
			.filter(([, id]) => id === d.id)
			.map(([key]) => key),
		format: kind.type,
		can_read_text: kind.text && d.size <= TEXT_LIMIT,
		can_edit_text: kind.text && d.size <= TEXT_LIMIT,
		can_generate_pdf: kind.type === 'html' && d.size <= TEXT_LIMIT
	};
}
export function uniqueName(m, prefix, name, duplicate = false) {
	const ext = name.includes('.') ? `.${name.split('.').at(-1)}` : '';
	const stem = ext ? name.slice(0, -ext.length) : name;
	let i = duplicate ? 1 : 0;
	for (; ; i++) {
		const suffix = i ? (duplicate ? ` copy${i === 1 ? '' : ` ${i}`}` : ` ${i + 1}`) : '';
		let base = stem;
		while (Buffer.byteLength(base + suffix + ext) > 255) {
			if (!base)
				reject(
					'VALIDATION',
					'The filename extension leaves no room for a duplicate suffix. Rename it first.'
				);
			base = Array.from(base).slice(0, -1).join('');
		}
		const candidate = filename(base + suffix + ext);
		if (!m.documents.some((d) => d.key.toLowerCase() === `${prefix}/${candidate}`.toLowerCase()))
			return candidate;
	}
}
export function bytesMetadata(bytes) {
	return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
export async function createEntry(
	m,
	{
		scope = 'documents',
		name,
		origin = 'manual',
		bytes,
		path,
		auto = false,
		designation,
		catalog_token
	}
) {
	const prefix = scopePrefix(scope);
	name = filename(name);
	if (auto) name = uniqueName(m, prefix, name);
	const key = `${prefix}/${name}`;
	if (m.documents.some((d) => d.key.toLowerCase() === key.toLowerCase()))
		reject('COLLISION', 'A file with that name already exists. Choose another name.');
	const now = new Date().toISOString();
	const d = {
		id: randomUUID(),
		key,
		created_via: origin,
		created_at: now,
		updated_at: now,
		token: randomUUID(),
		...(path ? await digest(path) : bytesMetadata(bytes))
	};
	if (designation !== undefined) {
		checkToken(m.token, catalog_token);
		const def = Object.hasOwn(documentDesignations, designation)
			? documentDesignations[designation]
			: null;
		if (scope !== 'documents' || !def || fileType(name).type !== def.format)
			reject('VALIDATION', 'Invalid document designation or format.');
		if (d.size > TEXT_LIMIT) reject('SIZE_LIMIT', 'Special documents are limited to 1 MiB.');
		if (path) {
			try {
				new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(path));
			} catch {
				reject('ENCODING', 'Text must be valid UTF-8.');
			}
		}
		m.designations[designation] = d.id;
	}
	m.documents.push(d);
	await commitManifest(m, [{ key, bytes, path }]);
	return info(d, m);
}
export async function validateWholeStore(m) {
	for (const name of await fs.readdir(filePaths().root))
		if (!['manifest.json', 'documents', 'jobs'].includes(name))
			reject('INTEGRITY', 'Unexpected file at the file-store root. Use offline recovery.');
	for (const d of m.documents) await verifiedPath(d);
	const adapter = new LocalFileStore();
	for (const key of await allKeys(adapter)) {
		if (!m.documents.some((d) => d.key === key))
			reject('INTEGRITY', 'Unregistered file found. Use offline recovery.');
	}
}
async function allKeys(adapter) {
	const keys = [];
	for await (const k of adapter.list('documents')) keys.push(k);
	let jobs = [];
	try {
		jobs = await fs.readdir(join(adapter.root, 'jobs'));
	} catch (e) {
		if (e.code !== 'ENOENT') throw e;
	}
	for (const id of jobs) for await (const k of adapter.list(`jobs/${id}`)) keys.push(validKey(k));
	return keys;
}
export { fs, Readable };
