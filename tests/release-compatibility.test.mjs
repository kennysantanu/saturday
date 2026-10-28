import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
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
import { getDocument } from '../src/lib/server/files/documents.js';
const fixture = new URL('./fixtures/release-0.1.0/', import.meta.url);
const expected = JSON.parse(await readFile(new URL('expected.json', fixture)));
const file = (path) => new URL(path, fixture);
async function compare() {
	withDatabase((db) => {
		for (const [table, rows] of Object.entries(expected.tables)) {
			if (table === 'schema_migrations') {
				assert(db.prepare('SELECT max(version) n FROM schema_migrations').get().n >= 1);
				continue;
			}
			const actual = db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
			if (table === 'sqlite_sequence') {
				for (const row of rows) assert(actual.some((a) => a.name === row.name && a.seq >= row.seq));
				continue;
			}
			assert.equal(actual.length, rows.length, table);
			for (let i = 0; i < rows.length; i++)
				for (const [key, value] of Object.entries(rows[i]))
					assert.deepEqual(actual[i][key], value, `${table}.${key}`);
		}
	});
	for (const entry of expected.documents) {
		const scope = entry.key.startsWith('jobs/') ? Number(entry.key.split('/')[1]) : 'documents';
		const document = await getDocument({ id: entry.id, scope, include_content: true });
		assert.equal(createHash('sha256').update(document.content).digest('hex'), entry.sha256);
	}
	for (const [designation, id] of Object.entries(expected.designations))
		assert.equal((await getDocument({ designation })).id, id);
}
test('frozen 0.1.0 artifacts retain their recorded source, schema, rows and checksums', async () => {
	assert.equal(expected.app_version, '0.1.0');
	assert.match(expected.source_commit, /^[a-f0-9]{40}$/);
	for (const [path, hash] of Object.entries(expected.hashes))
		assert.equal(
			createHash('sha256')
				.update(await readFile(file(path)))
				.digest('hex'),
			hash,
			path
		);
	const db = new DatabaseSync(file('database.sqlite'), { readOnly: true });
	try {
		assert.equal(db.prepare('SELECT max(version) version FROM schema_migrations').get().version, 1);
		assert.equal(
			db.prepare('SELECT dataset_id FROM app_metadata').get().dataset_id,
			expected.dataset_id
		);
	} finally {
		db.close();
	}
});
for (const mode of ['combined', 'independent'])
	test(`released 0.1.0 ${mode} backups restore into a fresh destination without changing originals`, async () => {
		const scratch = await mkdtemp(join(tmpdir(), 'saturday-fixed-compat-')),
			previous = { ...process.env };
		for (const key of Object.keys(process.env))
			if (key.startsWith('SATURDAY_')) delete process.env[key];
		Object.assign(process.env, {
			SATURDAY_INSTALLATION_PATH: '',
			SATURDAY_DB_PATH: join(scratch, 'db.sqlite'),
			SATURDAY_FILES_PATH: join(scratch, 'files'),
			SATURDAY_EXTENSION_STATE_PATH: join(scratch, 'extensions'),
			SATURDAY_EXTENSIONS_PATH: join(scratch, 'extension-code')
		});
		try {
			migrateDatabase();
			if (mode === 'combined') {
				const pair = await importBackupBundle(createReadStream(file('backups/combined.zip')));
				const preview = await prepareBackupPairRestore({ file_backup_id: pair.file_backup_id });
				await restoreBackupPair({ restore_id: preview.restore_id, confirm: true });
			} else {
				const database = importBackup(file('backups/database.sqlite').pathname),
					preview = prepareRestore(database.backup_id);
				restoreBackup(preview.restore_id, true);
				const files = await importFileBackup(createReadStream(file('backups/files.zip'))),
					incoming = await prepareFileRestore({ backup_id: files.backup_id, mode: 'replace' });
				await restoreFiles({ restore_id: incoming.restore_id, confirm: true });
			}
			await compare();
		} finally {
			for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
			Object.assign(process.env, previous);
			await rm(scratch, { recursive: true, force: true });
		}
		for (const [path, hash] of Object.entries(expected.hashes))
			assert.equal(
				createHash('sha256')
					.update(await readFile(file(path)))
					.digest('hex'),
				hash
			);
	});
