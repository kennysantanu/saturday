import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import { importBackup } from '../src/lib/server/backups.js';
import { importBackupBundle } from '../src/lib/server/files/pairs.js';
const fixture = new URL('./fixtures/release-0.1.0/', import.meta.url);
const expected = JSON.parse(await readFile(new URL('expected.json', fixture)));
const file = (path) => new URL(path, fixture);
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
	test(`previous-baseline ${mode} backups are rejected without changing the fresh workspace or originals`, async () => {
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
			const before = withDatabase((db) => ({
				metadata: db.prepare('SELECT * FROM app_metadata').all(),
				stages: db.prepare('SELECT * FROM workflow_stages ORDER BY id').all()
			}));
			if (mode === 'combined') {
				await assert.rejects(
					importBackupBundle(createReadStream(file('backups/combined.zip'))),
					(error) => error.code === 'unsupported_schema'
				);
			} else {
				assert.throws(
					() => importBackup(file('backups/database.sqlite').pathname),
					(error) => error.code === 'unsupported_schema'
				);
			}
			withDatabase((db) => {
				assert.deepEqual(db.prepare('SELECT * FROM app_metadata').all(), before.metadata);
				assert.deepEqual(
					db.prepare('SELECT * FROM workflow_stages ORDER BY id').all(),
					before.stages
				);
				assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n, 0);
				assert.equal(db.prepare('SELECT COUNT(*) n FROM networks').get().n, 0);
			});
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
