import yazl from 'yazl';
import yauzl from 'yauzl';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { openDatabase, withDatabaseRecovery } from '../database.js';
import {
	createBackup,
	completeBackupPair,
	getBackupFile,
	prepareRestore,
	restoreBackup,
	getBackupPaths,
	listBackups,
	importBackup,
	inspectBackupPath,
	MAX_BACKUP_BYTES,
	markIncompleteBackup,
	deleteBackup,
	assertBackupDeletionAllowed,
	restoreDatabaseWithFiles
} from '../backups.js';
import {
	withFileLock,
	filePaths,
	atomicJson,
	fs,
	reject,
	assertDataset,
	digest,
	regularPath,
	acquireDirectoryLock
} from './store.js';
import { buildInfo, storageCompatibility } from '../compatibility.js';
import {
	createFileBackup,
	listFileBackups,
	importFileBackup,
	deleteFileBackup,
	assertFileBackupDeletionAllowed,
	captureFiles,
	publishCapture,
	getFileBackup,
	prepareFileRestore,
	applyFileRestore,
	extractArchive
} from './backups.js';
export async function createBackupPair({
	kind = 'manual',
	now = Date.now(),
	gateHeld = false
} = {}) {
	const db = gateHeld ? null : openDatabase();
	let capture, database;
	try {
		db?.exec('BEGIN IMMEDIATE');
		const result = await withFileLock(async (m) => {
			assertDataset(m);
			database = createBackup();
			markIncompleteBackup(database.backup_id, 'File capture has not completed.');
			capture = await captureFiles(m);
			return database;
		});
		db?.exec('ROLLBACK');
		const id = randomUUID();
		const files = await publishCapture(capture, kind, {
			created_at: new Date(now).toISOString(),
			backup_set_id: id,
			database_backup_id: result.backup_id,
			database_sha256: result.sha256
		});
		const pair = {
			format: storageCompatibility.pair.format,
			format_version: storageCompatibility.pair.version,
			dataset_id: result.dataset_id,
			creator_build: buildInfo.id,
			backup_set_id: id,
			database_backup_id: result.backup_id,
			file_backup_id: files.backup_id,
			database_sha256: result.sha256,
			files_sha256: files.sha256
		};
		await atomicJson(join(filePaths().backups, `${id}.pair.json`), pair);
		completeBackupPair(result.backup_id, pair, kind, now);
		return pair;
	} catch (e) {
		try {
			db?.exec('ROLLBACK');
		} catch {}
		if (capture) await fs.rm(capture, { recursive: true, force: true });
		if (database)
			markIncompleteBackup(
				database.backup_id,
				'Database saved; file backup did not complete. Retry or download the database separately.'
			);
		throw e;
	} finally {
		db?.close();
	}
}
export async function prepareBackupPairRestore({ file_backup_id }) {
	const { metadata } = await getFileBackup(file_backup_id);
	if (!metadata.backup_set_id || !metadata.database_backup_id)
		reject('VALIDATION', 'Choose the file artifact of a coordinated pair.');
	const pair = await readPair(metadata.backup_set_id);
	if (
		pair.format !== storageCompatibility.pair.format ||
		pair.format_version !== storageCompatibility.pair.version
	)
		reject('FORMAT', 'Unsupported coordinated backup format. Use a compatible build.');
	const database = getBackupFile(metadata.database_backup_id);
	if (
		pair.dataset_id !== metadata.dataset_id ||
		pair.dataset_id !== database.metadata.dataset_id ||
		pair.backup_set_id !== metadata.backup_set_id ||
		pair.file_backup_id !== file_backup_id ||
		pair.database_backup_id !== metadata.database_backup_id ||
		pair.files_sha256 !== metadata.sha256 ||
		pair.database_sha256 !== database.metadata.sha256 ||
		metadata.database_sha256 !== database.metadata.sha256
	)
		reject(
			'INTEGRITY',
			'Coordinated backup identities or hashes do not match. Restore the artifacts independently after review.'
		);
	const db = prepareRestore(metadata.database_backup_id);
	const files = await prepareFileRestore({ backup_id: file_backup_id, mode: 'replace' });
	if (db.incoming.dataset_id !== pair.dataset_id || files.incoming_dataset_id !== pair.dataset_id)
		reject('DATASET_MISMATCH', 'Coordinated artifacts belong to different datasets.');
	const id = randomUUID();
	const result = {
		format: pair.format,
		format_version: pair.format_version,
		dataset_id: pair.dataset_id,
		restore_id: id,
		backup_set_id: metadata.backup_set_id,
		database: db,
		files,
		expires_at: files.expires_at
	};
	await atomicJson(join(filePaths().state, `${id}.pair-restore.json`), result);
	return result;
}
export async function restoreBackupPair({ restore_id, confirm }) {
	if (confirm !== true)
		reject('CONFIRMATION', 'Review and authorize the coordinated restore first.');
	if (!/^[a-f0-9-]{36}$/.test(restore_id)) reject('VALIDATION', 'Invalid restore ID.');
	const path = join(filePaths().state, `${restore_id}.pair-restore.json`);
	const record = JSON.parse(await fs.readFile(path, 'utf8'));
	if (
		record.format !== storageCompatibility.pair.format ||
		record.format_version !== storageCompatibility.pair.version
	)
		reject(
			'FORMAT',
			'Unsupported coordinated restore format. Prepare again with a compatible build.'
		);
	if (record.consumed || Date.parse(record.expires_at) <= Date.now())
		reject('EXPIRED', 'Prepare a new paired restore.');
	await atomicJson(path, { ...record, consumed: true });
	const sessionPath = join(filePaths().state, 'pair-session.json');
	let stage;
	try {
		const result = await restoreDatabaseWithFiles(
			record.database.restore_id,
			(recoveryDb, incoming) =>
				withFileLock(async (m) => {
					const fileRecordPath = join(filePaths().state, `${record.files.restore_id}.restore.json`);
					const fileRecord = JSON.parse(await fs.readFile(fileRecordPath, 'utf8'));
					if (
						incoming.dataset_id !== record.dataset_id ||
						fileRecord.manifest.dataset_id !== record.dataset_id
					)
						reject('DATASET_MISMATCH', 'Coordinated restore datasets changed. Prepare again.');
					if (fileRecord.consumed || Date.parse(fileRecord.expires_at) <= Date.now())
						reject('EXPIRED', 'Prepare both restore previews again.');
					await atomicJson(fileRecordPath, { ...fileRecord, consumed: true });
					stage = fileRecord.stage;
					const recoveryFiles = await publishCapture(await captureFiles(m), 'recovery');
					await atomicJson(sessionPath, {
						format: storageCompatibility.pair.format,
						format_version: storageCompatibility.pair.version,
						creator_build: buildInfo.id,
						recovery_database_dataset_id: recoveryDb.dataset_id,
						recovery_files_dataset_id: recoveryFiles.dataset_id,
						recovery_database_id: recoveryDb.backup_id,
						recovery_files_id: recoveryFiles.backup_id,
						restore_id
					});
					return applyFileRestore(m, fileRecord);
				})
		);
		await fs.rm(sessionPath);
		if (stage) await fs.rm(stage, { recursive: true, force: true });
		return result;
	} catch (e) {
		try {
			await fs.access(sessionPath);
		} catch {
			throw e;
		}

		try {
			await recoverBackupPair();
		} catch {
			reject(
				'RECOVERY_REQUIRED',
				'Coordinated restore and recovery were interrupted. Stop Saturday and run npm run files -- recover-pair --confirm.'
			);
		}
		reject(
			'RESTORE_FAILED',
			'Coordinated restore failed; both stores were returned to their recovery snapshots. Inspect the result before preparing another restore.'
		);
	}
}

export async function recoverBackupPair() {
	return withFileLock(
		async (m) => {
			const sessionPath = join(filePaths().state, 'pair-session.json');
			const session = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
			if (
				session.format !== storageCompatibility.pair.format ||
				session.format_version !== storageCompatibility.pair.version
			)
				reject(
					'FORMAT',
					'Unsupported interrupted-pair format. Use the matching build for offline recovery.'
				);
			const { path } = await getFileBackup(session.recovery_files_id);
			const { stage, manifest } = await extractArchive(path);
			let dbPreview = withDatabaseRecovery(() => prepareRestore(session.recovery_database_id));
			if (
				dbPreview.incoming.dataset_id !== session.recovery_database_dataset_id ||
				manifest.dataset_id !== session.recovery_files_dataset_id
			)
				reject(
					'DATASET_MISMATCH',
					'Recovery artifact datasets do not match the interrupted session.'
				);
			await applyFileRestore(m, {
				restore_id: randomUUID(),
				catalog_token: m.token,
				manifest,
				stage,
				mode: 'replace'
			});
			// A partial cross-dataset publication may have replaced only the file half.
			// Validate both artifacts before changing files, then refresh the DB preview
			// against the recovered file namespace before restoring the database.
			if (dbPreview.file_dataset_id !== manifest.dataset_id)
				dbPreview = withDatabaseRecovery(() => prepareRestore(session.recovery_database_id));
			withDatabaseRecovery(() => restoreBackup(dbPreview.restore_id, true));
			await fs.rm(sessionPath);
			await fs.rm(stage, { recursive: true, force: true });
			return { recovered: true };
		},
		{ allowSession: true }
	);
}

// One manual backup history across the independent archive formats.
export async function listBackupHistory({ limit = 50, offset = 0 } = {}) {
	if (
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > 50 ||
		!Number.isInteger(offset) ||
		offset < 0
	)
		reject('VALIDATION', 'Invalid backup pagination.');
	const databases = [],
		files = [];
	for (let next = 0; next !== null;) {
		const page = listBackups({ limit: 50, offset: next });
		databases.push(...page.backups);
		next = page.next_offset;
	}
	for (let next = 0; next !== null;) {
		const page = await listFileBackups({ limit: 100, offset: next });
		files.push(...page.backups);
		next = page.next_offset;
	}
	const byDatabase = new Map(
		files.filter((f) => f.database_backup_id).map((f) => [f.database_backup_id, f])
	);
	const used = new Set();
	const rows = databases.map((database) => {
		const file =
			files.find((f) => f.backup_id === database.file_backup_id) ??
			byDatabase.get(database.backup_id);
		if (file) used.add(file.backup_id);
		const combined = database.contents === 'all' || Boolean(database.file_backup_id || file);
		return {
			...database,
			contents: combined ? 'all' : 'database',
			files: file ?? null,
			file_backup_id: database.file_backup_id ?? file?.backup_id,
			status: combined && (!file || database.status === 'partial') ? 'partial' : 'complete'
		};
	});
	rows.push(
		...files
			.filter((f) => !used.has(f.backup_id))
			.map((f) => ({
				...f,
				contents: 'files',
				status: f.database_backup_id ? 'partial' : 'complete'
			}))
	);
	rows.sort(
		(a, b) => b.created_at.localeCompare(a.created_at) || b.backup_id.localeCompare(a.backup_id)
	);
	return {
		backups: rows.slice(offset, offset + limit),
		total: rows.length,
		next_offset: rows.length > offset + limit ? offset + limit : null
	};
}
async function historyEntry(backup_id, contents) {
	if (!['all', 'database', 'files'].includes(contents) || !/^[a-f0-9-]{36}$/.test(backup_id))
		reject('VALIDATION', 'Choose a valid backup and contents.');
	for (let offset = 0; offset !== null;) {
		const page = await listBackupHistory({ offset });
		const entry = page.backups.find((b) => b.backup_id === backup_id && b.contents === contents);
		if (entry) return entry;
		offset = page.next_offset;
	}
	reject('NOT_FOUND', 'Saved backup not found.');
}
async function operationLock() {
	const directory = getBackupPaths().backups;
	await fs.mkdir(directory, { recursive: true, mode: 0o700 });
	const release = await acquireDirectoryLock(join(directory, 'operations.lock'), { attempts: 0 });
	if (!release) reject('BUSY', 'Another backup operation is running. Try again shortly.');
	let completion;
	return () => (completion ??= release());
}
export async function createManualBackup({ contents = 'all' } = {}) {
	if (!['all', 'database', 'files'].includes(contents))
		reject('VALIDATION', 'Choose database and files, database only, or files only.');
	const release = await operationLock();
	try {
		if (contents === 'all') return { ...(await createBackupPair()), contents };
		return { ...(contents === 'files' ? await createFileBackup() : createBackup()), contents };
	} finally {
		await release();
	}
}
export async function deleteManualBackup({ backup_id, contents, confirm }) {
	if (confirm !== true)
		reject('CONFIRMATION', 'Confirm deletion of this backup and its artifacts.');
	const release = await operationLock();
	try {
		const entry = await historyEntry(backup_id, contents);
		if (
			entry.backup_set_id &&
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(entry.backup_set_id)
		)
			reject('VALIDATION', 'Invalid backup set identity; deletion stopped.');
		// Validate both halves before removal. File deletion checks active previews/recovery;
		// database deletion checks its own prepared previews. Recheck both before changing either.
		if (contents !== 'files') assertBackupDeletionAllowed(backup_id);
		if (entry.files || contents === 'files')
			await assertFileBackupDeletionAllowed(entry.files?.backup_id ?? backup_id);
		if (entry.files || contents === 'files')
			await deleteFileBackup(entry.files?.backup_id ?? backup_id, true);
		if (contents !== 'files') deleteBackup(backup_id, true);
		if (entry.backup_set_id) {
			for (const root of [filePaths().backups, filePaths().legacyBackups])
				await fs.rm(join(root, `${entry.backup_set_id}.pair.json`), { force: true });
		}
		return { deleted: true, backup_id, contents };
	} finally {
		await release();
	}
}
export async function downloadManualBackup({ backup_id, contents }) {
	const release = await operationLock();
	try {
		const entry =
			contents === 'database'
				? { ...getBackupFile(backup_id).metadata, contents: 'database', status: 'complete' }
				: await historyEntry(backup_id, contents);
		let stream, filename;
		if (contents === 'all' && entry.status === 'complete') {
			const database = getBackupFile(backup_id),
				files = await getFileBackup(entry.file_backup_id);
			const pair = await readPair(files.metadata.backup_set_id);
			const hash = await digest(files.path);
			if (
				hash.sha256 !== files.metadata.sha256 ||
				pair.database_sha256 !== database.metadata.sha256 ||
				pair.files_sha256 !== hash.sha256
			)
				reject('INTEGRITY', 'Backup artifacts changed; download stopped.');
			const zip = new yazl.ZipFile();
			zip.addBuffer(Buffer.from(JSON.stringify(pair)), 'pair.json');
			zip.addFile(database.path, 'database.sqlite');
			zip.addFile(files.path, 'files.zip');
			zip.end({ forceZip64Format: true });
			stream = zip.outputStream;
			filename = `saturday-${entry.backup_set_id}.zip`;
		} else {
			const file = contents === 'files' ? await getFileBackup(backup_id) : getBackupFile(backup_id);
			stream = createReadStream(file.path);
			filename = file.metadata.filename;
		}
		stream.once('close', () => void release().catch(() => {}));
		stream.once('end', () => void release().catch(() => {}));
		stream.once('error', () => void release().catch(() => {}));
		return {
			stream,
			filename,
			release,
			contents: contents === 'all' && entry.status === 'partial' ? 'database' : contents
		};
	} catch (e) {
		await release();
		throw e;
	}
}
async function readPair(id) {
	if (!/^[a-f0-9-]{36}$/.test(id)) reject('VALIDATION', 'Invalid pair ID.');
	for (const root of [filePaths().backups, filePaths().legacyBackups]) {
		try {
			return JSON.parse(await fs.readFile(await regularPath(root, `${id}.pair.json`), 'utf8'));
		} catch (e) {
			if (e.code !== 'ENOENT') throw e;
		}
	}
	reject('NOT_FOUND', 'Pair metadata not found. Restore the artifacts independently.');
}
export async function exportManualBackup(input, destination) {
	destination = resolve(destination);
	const database = getBackupPaths(),
		files = filePaths();
	const protectedPaths = [
		database.database,
		database.backups,
		database.legacyBackups,
		database.restore,
		files.root,
		files.state,
		files.backups,
		files.legacyBackups
	];
	if (
		protectedPaths.some((p) => destination === p || destination.startsWith(p + sep)) ||
		destination.startsWith(database.database + '-')
	)
		reject('VALIDATION', 'Choose a new export destination outside managed storage.');

	const result = await downloadManualBackup(input);
	const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
	let created = false;
	output.once('open', () => {
		created = true;
	});
	try {
		await pipeline(result.stream, output);
	} catch (e) {
		result.stream.destroy();
		if (created) await fs.rm(destination, { force: true });
		throw e;
	} finally {
		await result.release();
	}
	return { exported: true, path: destination };
}
// A fixed three-entry transport wrapper; never extract user-selected paths.
export async function importBackupBundle(stream) {
	const release = await operationLock();
	let directory, archive;
	try {
		await fs.mkdir(filePaths().state, { recursive: true, mode: 0o700 });
		directory = await fs.mkdtemp(join(filePaths().state, 'bundle-'));
		const source = join(directory, 'download.zip');
		await pipeline(stream, createWriteStream(source, { flags: 'wx', mode: 0o600 }));
		archive = await new Promise((resolve, reject) =>
			yauzl.open(source, { lazyEntries: true }, (e, z) => (e ? reject(e) : resolve(z)))
		);
		const seen = new Set();
		await new Promise((resolve, rejectPromise) => {
			archive.on('error', rejectPromise);
			archive.on('end', resolve);
			archive.on('entry', (entry) => {
				(async () => {
					if (
						!['pair.json', 'database.sqlite', 'files.zip'].includes(entry.fileName) ||
						seen.has(entry.fileName) ||
						((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
					)
						reject('VALIDATION', 'Invalid combined backup entries.');
					seen.add(entry.fileName);
					const maximum =
						entry.fileName === 'pair.json'
							? 1024 * 1024
							: entry.fileName === 'database.sqlite'
								? MAX_BACKUP_BYTES
								: Infinity;
					if (entry.uncompressedSize > maximum)
						reject('VALIDATION', 'Combined backup metadata or database is too large.');
					const input = await new Promise((res, rej) =>
						archive.openReadStream(entry, (e, r) => (e ? rej(e) : res(r)))
					);
					let bytes = 0;
					await pipeline(
						input,
						new Transform({
							transform(chunk, encoding, callback) {
								bytes += chunk.length;
								callback(
									bytes > maximum ? new Error('Backup entry exceeds its size limit.') : null,
									chunk
								);
							}
						}),
						createWriteStream(join(directory, entry.fileName), { flags: 'wx', mode: 0o600 })
					);
					archive.readEntry();
				})().catch(rejectPromise);
			});
			archive.readEntry();
		});
		if (seen.size !== 3) reject('VALIDATION', 'Choose a complete database and files backup ZIP.');
		const pair = JSON.parse(await fs.readFile(join(directory, 'pair.json'), 'utf8'));
		if (
			pair.format !== storageCompatibility.pair.format ||
			pair.format_version !== storageCompatibility.pair.version
		)
			reject('FORMAT', 'Unsupported combined backup format.');
		const databaseHash = await digest(join(directory, 'database.sqlite')),
			fileHash = await digest(join(directory, 'files.zip'));
		if (databaseHash.sha256 !== pair.database_sha256 || fileHash.sha256 !== pair.files_sha256)
			reject('INTEGRITY', 'Combined backup hashes do not match.');
		const incoming = inspectBackupPath(join(directory, 'database.sqlite'));
		const extracted = await extractArchive(join(directory, 'files.zip'));
		try {
			if (
				incoming.dataset_id !== pair.dataset_id ||
				extracted.manifest.dataset_id !== pair.dataset_id
			)
				reject('DATASET_MISMATCH', 'Combined artifacts do not share a dataset.');
		} finally {
			await fs.rm(extracted.stage, { recursive: true, force: true });
		}
		const database = importBackup(join(directory, 'database.sqlite'));
		markIncompleteBackup(
			database.backup_id,
			'Combined import is incomplete; database artifact is available separately.'
		);
		let files;
		try {
			files = await importFileBackup(createReadStream(join(directory, 'files.zip')));
			const remapped = {
				...pair,
				backup_set_id: randomUUID(),
				database_backup_id: database.backup_id,
				file_backup_id: files.backup_id
			};
			await atomicJson(join(filePaths().backups, `${files.backup_id}.json`), {
				...files,
				backup_set_id: remapped.backup_set_id,
				database_backup_id: database.backup_id,
				database_sha256: database.sha256
			});
			await atomicJson(join(filePaths().backups, `${remapped.backup_set_id}.pair.json`), remapped);
			completeBackupPair(database.backup_id, remapped, 'imported', Date.now());
			return { ...remapped, contents: 'all' };
		} catch (e) {
			markIncompleteBackup(
				database.backup_id,
				'Combined import did not complete; the database artifact is available separately.'
			);
			throw e;
		}
	} finally {
		archive?.close();
		if (directory) await fs.rm(directory, { recursive: true, force: true });
		await release();
	}
}
