import yazl from 'yazl';
import yauzl from 'yauzl';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { buildInfo, storageCompatibility } from '../compatibility.js';
import { databaseIdentity } from '../database.js';
import {
	filePaths,
	fs,
	withFileLock,
	validateWholeStore,
	validateManifest,
	migrateManifest,
	atomicJson,
	digest,
	validKey,
	commitManifest,
	checkToken,
	reject,
	regularPath,
	ensureDiskSpace,
	acquireDirectoryLock,
	manifestHash
} from './store.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function syncFile(path) {
	const handle = await fs.open(path, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}
function managed(id) {
	if (!uuid.test(id)) reject('VALIDATION', 'Invalid managed backup ID.');
	return id;
}
async function backupDirectory() {
	const p = filePaths();
	await fs.mkdir(p.backups, { recursive: true, mode: 0o700 });
	return p.backups;
}
export async function captureFiles(m) {
	await validateWholeStore(m);
	await ensureDiskSpace(
		m.documents.reduce((n, d) => n + d.size, 0) * 2 + Buffer.byteLength(JSON.stringify(m)) * 2
	);
	const dir = await fs.mkdtemp(join(filePaths().state, 'capture-'));
	try {
		await atomicJson(join(dir, 'manifest.json'), {
			...m,
			backup_metadata: { creator_build: buildInfo.id, created_at: new Date().toISOString() }
		});
		for (const d of m.documents) {
			const out = join(dir, d.key);
			await fs.mkdir(join(out, '..'), { recursive: true, mode: 0o700 });
			await fs.copyFile(await regularPath(filePaths().root, d.key), out);
		}
		return dir;
	} catch (e) {
		await fs.rm(dir, { recursive: true, force: true });
		throw e;
	}
}
export async function publishCapture(dir, kind = 'manual', extra = {}) {
	const root = await backupDirectory();
	const id = randomUUID();
	const path = join(root, `${id}.zip`);
	const temp = `${path}.tmp`;
	const m = validateManifest(JSON.parse(await fs.readFile(join(dir, 'manifest.json'), 'utf8')));
	const zip = new yazl.ZipFile();
	const result = pipeline(zip.outputStream, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
	try {
		zip.addFile(join(dir, 'manifest.json'), 'manifest.json');
		for (const d of m.documents) zip.addFile(join(dir, d.key), d.key);
		zip.end({ forceZip64Format: true });
		await result;
		const hash = await digest(temp);
		await syncFile(temp);
		await fs.rename(temp, path);
		const record = {
			format: m.format,
			format_version: m.format_version,
			dataset_id: m.dataset_id,
			creator_build: buildInfo.id,
			backup_id: id,
			filename: `saturday-files-${id}.zip`,
			kind,
			created_at: new Date().toISOString(),
			bytes: hash.size,
			sha256: hash.sha256,
			file_count: m.documents.length,
			...extra
		};
		await atomicJson(join(root, `${id}.json`), record);
		return record;
	} catch (e) {
		zip.outputStream.destroy();
		await result.catch(() => {});
		await fs.rm(temp, { force: true });
		await fs.rm(path, { force: true });
		throw e;
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}
export async function createFileBackup(kind = 'manual') {
	const dir = await withFileLock(captureFiles);
	return publishCapture(dir, kind);
}
export async function listFileBackups({ limit = 50, offset = 0 } = {}) {
	if (
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 100 ||
		!Number.isInteger(offset) ||
		offset < 0
	)
		reject('VALIDATION', 'Invalid backup pagination.');
	const root = await backupDirectory();
	const all = [];
	for (const name of await fs.readdir(root)) {
		if (!uuid.test(name.replace(/\.json$/, '')) || !name.endsWith('.json')) continue;
		const meta = JSON.parse(await fs.readFile(join(root, name), 'utf8'));
		all.push(meta);
	}
	all.sort(
		(a, b) => b.created_at.localeCompare(a.created_at) || a.backup_id.localeCompare(b.backup_id)
	);
	return {
		backups: all.slice(offset, offset + limit),
		total: all.length,
		next_offset: all.length > offset + limit ? offset + limit : null
	};
}
export async function getFileBackup(id) {
	const root = await backupDirectory();
	managed(id);
	const metadata = JSON.parse(await fs.readFile(join(root, `${id}.json`), 'utf8'));
	if (
		metadata.format !== storageCompatibility.manifest.format ||
		!Number.isInteger(metadata.format_version) ||
		metadata.format_version < storageCompatibility.manifest.minimumVersion ||
		metadata.format_version > storageCompatibility.manifest.version
	)
		reject('FORMAT', 'Unsupported file backup format. Use a compatible build.');
	const path = await regularPath(root, `${id}.zip`);
	return { path, metadata };
}
export async function extractArchive(path) {
	const stage = await fs.mkdtemp(join(filePaths().state, 'restore-'));
	let zip;
	try {
		zip = await new Promise((res, rej) =>
			yauzl.open(
				path,
				{ lazyEntries: true, validateEntrySizes: true, decodeStrings: true },
				(e, z) => (e ? rej(e) : res(z))
			)
		);
		const seen = new Set();
		await new Promise((res, rej) => {
			zip.on('error', rej);
			zip.on('end', res);
			zip.on('entry', (entry) => {
				(async () => {
					const key = entry.fileName;
					if (key !== 'manifest.json') validKey(key);
					if (seen.has(key.toLowerCase())) reject('FORMAT', 'Duplicate archive entry.');
					seen.add(key.toLowerCase());
					const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
					if (mode && mode !== 0o100000) reject('FORMAT', 'Archive contains a nonregular file.');
					if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0)
						reject('FORMAT', 'Invalid archive size.');
					if (key === 'manifest.json' && entry.uncompressedSize > 16 * 1024 * 1024)
						reject('FORMAT', 'Manifest exceeds the metadata processing bound.');
					const out = join(stage, key);
					await fs.mkdir(join(out, '..'), { recursive: true, mode: 0o700 });
					const stream = await new Promise((r, j) =>
						zip.openReadStream(entry, (e, s) => (e ? j(e) : r(s)))
					);
					let size = 0;
					await pipeline(
						stream,
						new Transform({
							transform(c, _, cb) {
								size += c.length;
								cb(size > entry.uncompressedSize ? new Error('Archive size mismatch') : null, c);
							}
						}),
						createWriteStream(out, { flags: 'wx', mode: 0o600 })
					);
					if (size !== entry.uncompressedSize) reject('FORMAT', 'Archive size mismatch.');
					zip.readEntry();
				})().catch(rej);
			});
			zip.readEntry();
		});
		const m = migrateManifest(JSON.parse(await fs.readFile(join(stage, 'manifest.json'), 'utf8')));
		if (seen.size !== m.documents.length + 1)
			reject('FORMAT', 'Backup entries do not match manifest.');
		for (const d of m.documents) {
			const h = await digest(join(stage, d.key));
			if (h.size !== d.size || h.sha256 !== d.sha256)
				reject('INTEGRITY', 'Backup content does not match manifest.');
		}
		return { stage, manifest: m };
	} catch (e) {
		zip?.close();
		await fs.rm(stage, { recursive: true, force: true });
		throw e;
	}
}
export async function importFileBackup(stream) {
	const root = await backupDirectory();
	await fs.mkdir(filePaths().state, { recursive: true, mode: 0o700 });
	const temp = join(filePaths().state, `import-${randomUUID()}`);
	let stage;
	try {
		await pipeline(stream, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
		const extracted = await extractArchive(temp);
		stage = extracted.stage;
		const id = randomUUID(),
			hash = await digest(temp);
		await syncFile(temp);
		await fs.rename(temp, join(root, `${id}.zip`));
		const meta = {
			format: extracted.manifest.format,
			format_version: extracted.manifest.format_version,
			dataset_id: extracted.manifest.dataset_id,
			creator_build: extracted.manifest.backup_metadata?.creator_build ?? null,
			backup_id: id,
			filename: `saturday-files-${id}.zip`,
			kind: 'imported',
			created_at: new Date().toISOString(),
			bytes: hash.size,
			sha256: hash.sha256,
			file_count: extracted.manifest.documents.length
		};
		await atomicJson(join(root, `${id}.json`), meta);
		return meta;
	} finally {
		await fs.rm(temp, { force: true });
		if (stage) await fs.rm(stage, { recursive: true, force: true });
	}
}
function mergeManifest(current, incoming, mode) {
	if (mode === 'replace') return structuredClone(incoming);
	if (current.dataset_id !== incoming.dataset_id) {
		if (!current.documents.length && !Object.keys(current.designations).length)
			return structuredClone(incoming);
		reject(
			'DATASET_MISMATCH',
			'Add missing cannot merge different datasets. Use a reviewed Replace restore or recover files explicitly.'
		);
	}
	const m = structuredClone(current);
	for (const d of incoming.documents) {
		const same = m.documents.find(
			(x) => x.id === d.id || x.key.toLowerCase() === d.key.toLowerCase()
		);
		if (same) {
			if (same.id !== d.id || same.key !== d.key || same.sha256 !== d.sha256)
				reject(
					'CONFLICT',
					'Add missing found conflicting content or identity. Use a reviewed Replace restore instead.'
				);
		} else m.documents.push({ ...d, token: randomUUID() });
	}
	for (const [key, id] of Object.entries(incoming.designations)) {
		if (m.designations[key] && m.designations[key] !== id)
			reject('CONFLICT', 'Document assignments conflict.');
		m.designations[key] = id;
	}

	return m;
}
export async function prepareFileRestore({ backup_id, mode = 'add' }) {
	if (!['add', 'replace'].includes(mode)) reject('VALIDATION', 'Choose add or replace.');
	const source = await getFileBackup(backup_id);
	const h = await digest(source.path);
	if (h.sha256 !== source.metadata.sha256) reject('INTEGRITY', 'Managed backup changed.');
	const { stage, manifest } = await extractArchive(source.path);
	try {
		if (manifest.dataset_id !== source.metadata.dataset_id)
			reject('INTEGRITY', 'File backup dataset metadata does not match its archive.');
		return await withFileLock(async (current) => {
			await cleanupPreviews();
			await validateWholeStore(current);
			const result = mergeManifest(current, manifest, mode);
			const id = randomUUID();
			const preview = {
				current_dataset_id: current.dataset_id,
				incoming_dataset_id: manifest.dataset_id,
				database_dataset_id: databaseIdentity()?.dataset_id ?? null,
				files_match_database: databaseIdentity()?.dataset_id === result.dataset_id,
				restore_id: id,
				backup_id,
				mode,
				expires_at: new Date(Date.now() + 600000).toISOString(),
				current_count: current.documents.length,
				incoming_count: manifest.documents.length,
				result_count: result.documents.length,
				removed:
					mode === 'replace'
						? current.documents.filter((d) => !manifest.documents.some((x) => x.id === d.id)).length
						: 0,
				designations_before: current.designations,
				designations_after: result.designations,
				master_cv_before: current.designations.master_cv ?? null,
				master_cv_after: result.designations.master_cv ?? null,
				warning:
					(mode === 'replace'
						? 'Replace the entire file collection. A complete recovery backup is created first.'
						: 'Add missing files; existing files are preserved. Conflicts block restore.') +
					(databaseIdentity()?.dataset_id !== result.dataset_id
						? ' Job files will be unavailable until a database from the same dataset is restored. User documents remain accessible.'
						: '')
			};
			await atomicJson(join(filePaths().state, `${id}.restore.json`), {
				...preview,
				catalog_token: current.token,
				catalog_fingerprint: manifestHash(current),
				stage,
				manifest
			});
			return preview;
		});
	} catch (e) {
		await fs.rm(stage, { recursive: true, force: true });
		throw e;
	}
}
export async function applyFileRestore(m, record) {
	checkToken(m.token, record.catalog_token);
	if (record.catalog_fingerprint && manifestHash(m) !== record.catalog_fingerprint)
		reject('CONFLICT', 'File collection identity or content changed. Prepare again.');
	if (
		record.database_dataset_id !== undefined &&
		record.database_dataset_id !== (databaseIdentity()?.dataset_id ?? null)
	)
		reject('CONFLICT', 'Database dataset changed. Prepare the file restore again.');
	await validateWholeStore(m);
	const incoming = validateManifest(record.manifest);
	for (const d of incoming.documents) {
		const h = await digest(join(record.stage, d.key));
		if (h.size !== d.size || h.sha256 !== d.sha256)
			reject('INTEGRITY', 'Prepared restore changed.');
	}
	const next = mergeManifest(m, incoming, record.mode);
	await ensureDiskSpace(
		m.documents.reduce((n, d) => n + d.size, 0) * 2 +
			next.documents.reduce((n, d) => n + d.size, 0) * 2
	);
	const recovery = await publishCapture(await captureFiles(m), 'recovery');
	const changes = [];
	for (const d of next.documents) {
		if (record.mode === 'replace' || !m.documents.some((x) => x.id === d.id)) {
			d.token = randomUUID();
			changes.push({ key: d.key, path: join(record.stage, d.key) });
		}
	}
	for (const d of m.documents)
		if (!next.documents.some((x) => x.key === d.key)) changes.push({ key: d.key, remove: true });
	await commitManifest(next, changes, { restore: true });
	return {
		restore_id: record.restore_id,
		recovery_backup_id: recovery.backup_id,
		file_count: next.documents.length,
		catalog_token: next.token
	};
}
export async function restoreFiles({ restore_id, confirm }) {
	if (confirm !== true) reject('CONFIRMATION', 'Review and confirm the restore first.');
	managed(restore_id);
	return withFileLock(async (m) => {
		const path = join(filePaths().state, `${restore_id}.restore.json`);
		const record = JSON.parse(await fs.readFile(path, 'utf8'));
		if (record.consumed)
			reject('CONSUMED', 'Prepare a new restore. This preview was already attempted.');
		if (Date.parse(record.expires_at) <= Date.now())
			reject('EXPIRED', 'Restore preview expired. Prepare again.');
		await atomicJson(path, { ...record, consumed: true });
		try {
			return await applyFileRestore(m, record);
		} finally {
			await fs.rm(record.stage, { recursive: true, force: true });
		}
	});
}
const defaults = {
	enabled: false,
	interval_hours: 24,
	keep_count: 10,
	last_success_at: null,
	next_due_at: null,
	last_error: null,
	retry_after: null
};
async function readSettings() {
	try {
		return {
			...defaults,
			...JSON.parse(await fs.readFile(join(filePaths().state, 'schedule.json'), 'utf8'))
		};
	} catch (e) {
		if (e.code === 'ENOENT') return { ...defaults };
		throw e;
	}
}
export async function getFileBackupSettings() {
	return withFileLock(async () => {
		const settings = await readSettings();
		let running = false;
		try {
			for (const name of await fs.readdir(join(filePaths().state, 'scheduled.lock'))) {
				const match = /^(\d+)-[a-f0-9-]+\.owner$/.exec(name);
				if (match) {
					try {
						process.kill(Number(match[1]), 0);
						running = true;
					} catch {}
				}
			}
		} catch (e) {
			if (e.code !== 'ENOENT') throw e;
		}
		return { ...settings, running };
	});
}
export async function setFileBackupSettings(input) {
	if (!Object.keys(input).length) reject('VALIDATION', 'Provide at least one file backup setting.');
	return withFileLock(async () => {
		for (const key of Object.keys(input))
			if (!['enabled', 'interval_hours', 'keep_count'].includes(key))
				reject('VALIDATION', 'Unknown file backup setting.');
		if (
			(input.enabled !== undefined && typeof input.enabled !== 'boolean') ||
			(input.interval_hours !== undefined &&
				(!Number.isInteger(input.interval_hours) ||
					input.interval_hours < 1 ||
					input.interval_hours > 168)) ||
			(input.keep_count !== undefined &&
				(!Number.isInteger(input.keep_count) || input.keep_count < 1 || input.keep_count > 100))
		)
			reject('VALIDATION', 'Interval must be 1–168 hours and retention 1–100 backups.');
		const old = await readSettings();
		const next = { ...old, ...input };
		if (next.enabled && (!old.enabled || next.interval_hours !== old.interval_hours))
			next.next_due_at = new Date().toISOString();
		if (!next.enabled) next.next_due_at = null;
		await atomicJson(join(filePaths().state, 'schedule.json'), next);
		return next;
	});
}
export async function runScheduledFileBackup() {
	const p = filePaths();
	await fs.mkdir(p.state, { recursive: true, mode: 0o700 });
	const release = await acquireDirectoryLock(join(p.state, 'scheduled.lock'), { attempts: 0 });
	if (!release) return;
	try {
		const settings = await getFileBackupSettings();
		if (
			!settings.enabled ||
			Date.parse(settings.next_due_at) > Date.now() ||
			Date.parse(settings.retry_after) > Date.now()
		)
			return;
		try {
			const result = await createFileBackup('automatic');
			await withFileLock(async () => {
				const current = await readSettings();
				current.last_success_at = result.created_at;
				current.next_due_at = current.enabled
					? new Date(Date.now() + current.interval_hours * 3600000).toISOString()
					: null;
				current.last_error = null;
				current.retry_after = null;
				await atomicJson(join(p.state, 'schedule.json'), current);
				let offset = 0,
					records = [];
				for (;;) {
					const page = await listFileBackups({ limit: 100, offset });
					records.push(...page.backups);
					if (page.next_offset === null) break;
					offset = page.next_offset;
				}
				const excess = records.filter((b) => b.kind === 'automatic').slice(current.keep_count);
				const protectedSources = new Set();
				const previewNames = excess.length ? await fs.readdir(p.state) : [];
				for (const name of previewNames.filter((n) => n.endsWith('.restore.json'))) {
					const record = JSON.parse(await fs.readFile(join(p.state, name), 'utf8'));
					if (!record.consumed && Date.parse(record.expires_at) > Date.now())
						protectedSources.add(record.backup_id);
				}
				for (const b of excess) {
					// Prepared sources are never pruned.
					if (!protectedSources.has(b.backup_id)) {
						await fs.rm(join(p.backups, `${b.backup_id}.zip`));
						await fs.rm(join(p.backups, `${b.backup_id}.json`));
					}
				}
			});
			return result;
		} catch (e) {
			await withFileLock(async () => {
				const current = await readSettings();
				current.last_error = { message: e.message };
				current.retry_after = new Date(Date.now() + 60000).toISOString();
				await atomicJson(join(p.state, 'schedule.json'), current);
			});
			return { error: { message: e.message } };
		}
	} finally {
		await release();
	}
}

async function cleanupPreviews() {
	const state = filePaths().state;
	for (const name of await fs.readdir(state)) {
		if (!/^[a-f0-9-]{36}\.restore\.json$/.test(name)) continue;
		const path = join(state, name),
			record = JSON.parse(await fs.readFile(path, 'utf8'));
		if (Date.parse(record.expires_at) <= Date.now()) {
			if (typeof record.stage === 'string' && record.stage.startsWith(join(state, 'restore-')))
				await fs.rm(record.stage, { recursive: true, force: true });
			await fs.rm(path, { force: true });
		}
	}
}

// Retention removes both halves of a completed automatic set. Prepared sources
// and interrupted recovery sessions keep the entire set available.
export async function removePairedFileBackup(database, now) {
	const backupId = managed(database.file_backup_id);
	return withFileLock(async () => {
		const p = filePaths();
		for (const name of await fs.readdir(p.state)) {
			if (!name.endsWith('.restore.json')) continue;
			const record = JSON.parse(await fs.readFile(join(p.state, name), 'utf8'));
			if (!record.consumed && Date.parse(record.expires_at) > now && record.backup_id === backupId)
				return false;
		}
		const { metadata } = await getFileBackup(backupId);
		if (
			metadata.database_backup_id !== database.backup_id ||
			metadata.backup_set_id !== database.backup_set_id ||
			metadata.kind !== 'scheduled'
		)
			reject('INTEGRITY', 'Automatic backup membership changed; retention stopped.');
		await fs.rm(join(p.backups, `${backupId}.zip`));
		await fs.rm(join(p.backups, `${backupId}.json`));
		await fs.rm(join(p.backups, `${managed(metadata.backup_set_id)}.pair.json`), { force: true });
		return true;
	});
}
