import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

for (const missing of ['database', 'manifest', 'access', 'descriptor'])
	test(`initialized managed storage fails closed when ${missing} is missing`, () => {
		const root = mkdtempSync(join(tmpdir(), 'saturday-missing-store-'));
		const env = {
			...process.env,
			SATURDAY_PROJECT_ROOT: resolve('.'),
			SATURDAY_INSTALLATION_PATH: '',
			SATURDAY_DB_PATH: '',
			SATURDAY_FILES_PATH: '',
			SATURDAY_EXTENSION_STATE_PATH: '',
			SATURDAY_EXTENSIONS_PATH: ''
		};
		const setup = () =>
			spawnSync(
				process.execPath,
				[
					'scripts/setup.mjs',
					'--managed',
					'--root',
					root,
					'--skip-dependencies',
					'--skip-build',
					'--skip-pdf',
					'--json'
				],
				{ env, encoding: 'utf8' }
			);
		try {
			const first = setup();
			assert.equal(first.status, 0, first.stderr + first.stdout);
			const receipt = JSON.parse(first.stdout),
				cfg = JSON.parse(readFileSync(receipt.descriptor_path));
			env.SATURDAY_INSTALLATION_PATH = receipt.descriptor_path;
			const paths = {
				database: cfg.database,
				manifest: join(cfg.files, 'manifest.json'),
				access: join(cfg.data_root, 'access.json'),
				descriptor: receipt.descriptor_path
			};
			const access = JSON.parse(readFileSync(paths.access));
			// A valid-shape unavailable credential proves a missing settings file cannot drop protection.
			access.password = {
				algorithm: 'scrypt',
				N: 131072,
				r: 8,
				p: 1,
				salt: '0'.repeat(32),
				hash: '0'.repeat(128)
			};
			writeFileSync(paths.access, JSON.stringify(access));
			const before = Object.fromEntries(
				Object.entries(paths).map(([name, path]) => [name, readFileSync(path)])
			);
			renameSync(paths[missing], paths[missing] + '.retained');
			const repeat = setup();
			assert.equal(repeat.status, 1, repeat.stdout + repeat.stderr);
			if (missing === 'descriptor') {
				env.SATURDAY_INSTALLATION_PATH = '';
				const unconfigured = setup();
				assert.equal(
					unconfigured.status,
					1,
					'existing managed data cannot be adopted without its descriptor'
				);
				env.SATURDAY_INSTALLATION_PATH = receipt.descriptor_path;
			}
			const started = spawnSync(
				process.execPath,
				['scripts/start.mjs', '--background', '--installation', receipt.descriptor_path, '--json'],
				{ env, encoding: 'utf8', timeout: 30000 }
			);
			assert.notEqual(started.status, 0, started.stdout + started.stderr);
			assert.equal(existsSync(paths[missing]), false, 'must not create replacement storage');
			for (const [name, path] of Object.entries(paths))
				if (name !== missing) assert.deepEqual(readFileSync(path), before[name], name);
			assert.deepEqual(readFileSync(paths[missing] + '.retained'), before[missing]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
