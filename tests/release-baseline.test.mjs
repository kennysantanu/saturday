import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, copyFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import { importBackup, prepareRestore, restoreBackup } from '../src/lib/server/backups.js';
import {
	importFileBackup,
	prepareFileRestore,
	restoreFiles
} from '../src/lib/server/files/backups.js';
import {
	importBackupBundle,
	prepareBackupPairRestore,
	restoreBackupPair
} from '../src/lib/server/files/pairs.js';

const fixture = new URL('./fixtures/release-0.1.0-current/', import.meta.url);
const file = (path) => new URL(path, fixture);
const expected = JSON.parse(await readFile(file('expected.json')));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function assertOriginalsUnchanged() {
	assert.equal(expected.app_version, '0.1.0');
	assert.match(expected.source_commit, /^[a-f0-9]{40}$/);
	for (const [path, hash] of Object.entries(expected.hashes))
		assert.equal(sha256(await readFile(file(path))), hash, path);
}

async function assertRestoredRecords() {
	withDatabase((db) => {
		for (const [table, rows] of Object.entries(expected.tables)) {
			const actual = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
			const comparable = (rows) =>
				rows.map((row) => {
					const result = { ...row };
					// The target records its own migration application time.
					if (table === 'schema_migrations') delete result.applied_at;
					return result;
				});
			const sort = (rows) =>
				table === 'sqlite_sequence' ? rows.toSorted((a, b) => a.name.localeCompare(b.name)) : rows;
			assert.deepEqual(sort(comparable(actual)), sort(comparable(rows)), table);
		}
	});
	const manifest = JSON.parse(
		await readFile(join(process.env.SATURDAY_FILES_PATH, 'manifest.json'))
	);
	assert.equal(manifest.dataset_id, expected.dataset_id);
	assert.deepEqual(manifest.designations, expected.designations);
	assert.deepEqual(
		manifest.documents.map(({ id, key, size, sha256 }) => ({ id, key, size, sha256 })),
		expected.documents
	);
	for (const document of expected.documents) {
		const bytes = await readFile(join(process.env.SATURDAY_FILES_PATH, document.key));
		assert.equal(bytes.length, document.size);
		assert.equal(sha256(bytes), document.sha256);
	}
}

for (const mode of ['stores', 'independent', 'combined'])
	test(`current 0.1.0 ${mode} preserve all records, IDs, Profile assignments and document bytes`, async () => {
		const scratch = await mkdtemp(join(tmpdir(), 'saturday-release-baseline-'));
		const previous = { ...process.env };
		for (const key of Object.keys(process.env))
			if (key.startsWith('SATURDAY_')) delete process.env[key];
		Object.assign(process.env, {
			SATURDAY_INSTALLATION_PATH: '',
			SATURDAY_PROJECT_ROOT: process.cwd(),
			SATURDAY_DB_PATH: join(scratch, 'database.sqlite'),
			SATURDAY_FILES_PATH: join(scratch, 'files'),
			SATURDAY_EXTENSION_STATE_PATH: join(scratch, 'extensions'),
			SATURDAY_EXTENSIONS_PATH: join(scratch, 'extension-code')
		});
		try {
			await assertOriginalsUnchanged();
			if (mode === 'stores') {
				await copyFile(file('database.sqlite'), process.env.SATURDAY_DB_PATH);
				await cp(file('files/'), process.env.SATURDAY_FILES_PATH, { recursive: true });
				migrateDatabase();
			} else {
				migrateDatabase();
				if (mode === 'independent') {
					const database = importBackup(fileURLToPath(file('backups/database.sqlite')));
					restoreBackup(prepareRestore(database.backup_id).restore_id, true);
					const files = await importFileBackup(createReadStream(file('backups/files.zip')));
					const preview = await prepareFileRestore({ backup_id: files.backup_id, mode: 'replace' });
					await restoreFiles({ restore_id: preview.restore_id, confirm: true });
				} else {
					const imported = await importBackupBundle(createReadStream(file('backups/combined.zip')));
					const preview = await prepareBackupPairRestore({
						file_backup_id: imported.file_backup_id
					});
					await restoreBackupPair({ restore_id: preview.restore_id, confirm: true });
				}
			}
			await assertRestoredRecords();
			await assertOriginalsUnchanged();
		} finally {
			for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
			Object.assign(process.env, previous);
			await rm(scratch, { recursive: true, force: true });
		}
	});
