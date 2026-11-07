import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { existsSync, readFileSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { install, run as installerRun } from '../scripts/install.mjs';
import { serverSummary } from '../src/lib/server/server-lifecycle.js';
import { connectMcp } from './helpers/mcp-client.mjs';
const exec = promisify(execFile);

test(
	'Settings installs checked fictional releases with preserved records, protected reopen and failed-download recovery',
	{ timeout: 240000 },
	async () => {
		const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'saturday-release-http-'))),
			source = join(root, 'source'),
			desktop = join(root, 'desktop'),
			previous = { ...process.env },
			originalFetch = globalThis.fetch;
		let config, client;
		const git = async (...args) =>
			(await exec('git', ['-C', source, ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
		const statePath = join(root, 'distribution.json'),
			state = { selected: '0.1.0', releases: {} };
		const save = () => fs.writeFile(statePath, JSON.stringify(state));
		const run = async (file, ...args) =>
			exec(process.execPath, [file, ...args], { env: process.env, maxBuffer: 4 * 1024 * 1024 });
		try {
			await fs.mkdir(source);
			await fs.mkdir(desktop);
			// A committed, secret-free snapshot makes the mocked tarball and Git blob hashes real.
			const archive = join(root, 'source.tar');
			await exec('git', ['archive', '--format=tar', '--output', archive, 'HEAD']);
			await exec('tar', ['-xf', archive, '-C', source]);
			await git('init', '--quiet');
			const originalBuild = JSON.parse(await fs.readFile(join(source, 'package.json'))).scripts
				.build;
			const originalMigrations = await fs.readFile(
				join(source, 'src/lib/server/migrations.js'),
				'utf8'
			);
			for (const version of ['0.1.0', '0.1.1', '0.1.2', '0.1.3', '0.1.4', '0.1.5', '0.1.6']) {
				for (const file of ['package.json', 'package-lock.json']) {
					const data = JSON.parse(await fs.readFile(join(source, file)));
					data.version = version;
					if (file === 'package.json') {
						data.scripts.build = originalBuild;
						data.saturday.storage.database.currentVersion = version === '0.1.4' ? 2 : 1;
						data.saturday.lan_api = version === '0.1.5' ? 0 : 1;
						data.saturday.access_api = version === '0.1.6' ? 0 : 1;
					}
					if (version === '0.1.3' && file === 'package.json')
						data.scripts.build = 'node -e "process.exit(19)"';
					if (data.packages?.['']) data.packages[''].version = version;
					await fs.writeFile(join(source, file), JSON.stringify(data, null, 2));
				}
				await fs.writeFile(join(source, 'src/lib/server/migrations.js'), originalMigrations);
				if (version === '0.1.4') {
					// This deliberately failing migration exists only in the fictional tarball.
					const path = join(source, 'src/lib/server/migrations.js');
					const sql = await fs.readFile(path, 'utf8');
					const changed = sql.replace(
						'\n];\n\nexport const schemaVersion',
						`,\n{version: 2, name: 'fictional_copy_failure', sql: 'CREATE TABLE fictional_partial(id INTEGER); SELECT * FROM fictional_missing_table;'}\n];\n\nexport const schemaVersion`
					);
					assert.notEqual(changed, sql);
					await fs.writeFile(path, changed);
				}
				await git('add', '.');
				await git(
					'-c',
					'user.name=Saturday fixture',
					'-c',
					'user.email=fixture@example.invalid',
					'commit',
					'--quiet',
					'-m',
					`Fictional ${version}`
				);
				const commit = await git('rev-parse', 'HEAD'),
					tree_sha = await git('rev-parse', 'HEAD^{tree}'),
					pkg = JSON.parse(await fs.readFile(join(source, 'package.json')));
				const tree = (await git('ls-tree', '-rt', 'HEAD')).split('\n').map((line) => {
					const [header, path] = line.split('\t'),
						[mode, type, sha] = header.split(' ');
					return { mode, type, sha, path };
				});
				const packed = join(root, `${version}.tar.gz`);
				await git(
					'archive',
					'--format=tar.gz',
					`--prefix=saturday-${commit}/`,
					'--output',
					packed,
					commit
				);
				const metadata = {
					...pkg.saturday,
					format: 'saturday.release',
					version: 1,
					release: version,
					commit,
					source: { type: 'github-source' }
				};
				state.releases[version] = {
					metadata,
					package: pkg,
					tree_sha,
					tree,
					archive: packed,
					digest: 'sha256:' + createHash('sha256').update(JSON.stringify(metadata)).digest('hex')
				};
			}
			await save();
			for (const key of Object.keys(process.env))
				if (key.startsWith('SATURDAY_')) delete process.env[key];
			const socket = createServer();
			await new Promise((r) => socket.listen(0, '127.0.0.1', r));
			const port = socket.address().port;
			await new Promise((r) => socket.close(r));
			Object.assign(process.env, {
				SATURDAY_TEST_RELEASE_FIXTURE: statePath,
				SATURDAY_INSTALLATION_PATH: '',
				npm_config_cache: join(root, 'npm-cache'),
				NODE_OPTIONS: `${previous.NODE_OPTIONS ?? ''} --import=${pathToFileURL(resolve('tests/helpers/release-fetch-fixture.mjs')).href}`,
				PORT: String(port),
				PUPPETEER_SKIP_DOWNLOAD: 'true'
			});
			await import(`./helpers/release-fetch-fixture.mjs?current-process=${Date.now()}`);
			const receipt = await install(
				{ root: join(root, 'installation'), desktop, 'skip-pdf': true, 'no-open': true },
				{
					run: async (command, args, options) => {
						if (args.includes('--managed')) {
							await fs.symlink(resolve('node_modules'), join(options.cwd, 'node_modules'), 'dir');
							args = [...args, '--skip-dependencies'];
						}
						await installerRun(command, args, options);
					}
				}
			);
			const descriptor = receipt.descriptor_path;
			config = JSON.parse(await fs.readFile(descriptor));
			assert.equal(config.release, '0.1.0');
			assert.equal(config.distribution, 'release');
			assert.equal(config.build.commit, state.releases['0.1.0'].metadata.commit);
			process.env.SATURDAY_INSTALLATION_PATH = descriptor;
			const pairs = await import('../src/lib/server/files/pairs.js');
			const incoming = await pairs.importBackupBundle(
					createReadStream(
						new URL('./fixtures/release-0.1.0-current/backups/combined.zip', import.meta.url)
					)
				),
				preview = await pairs.prepareBackupPairRestore({ file_backup_id: incoming.file_backup_id });
			await pairs.restoreBackupPair({ restore_id: preview.restore_id, confirm: true });
			const documentKeys = JSON.parse(
				await fs.readFile(join(config.files, 'manifest.json'))
			).documents.map((d) => join(config.files, d.key));
			const dataPaths = [
				config.database,
				join(config.files, 'manifest.json'),
				join(config.data_root, 'access.json'),
				...documentKeys
			];
			let baseline = await Promise.all(dataPaths.map((p) => fs.readFile(p)));
			let url = receipt.url,
				cookies = new Map();
			function remember(response) {
				for (const value of response.headers.getSetCookie()) {
					const [name, ...parts] = value.split(';')[0].split('=');
					cookies.set(name, parts.join('='));
				}
			}
			const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
			async function settings(password) {
				cookies = new Map();
				if (password) {
					const login = await fetch(url + '/signin', {
						method: 'POST',
						headers: {
							origin: url,
							accept: 'text/html',
							'content-type': 'application/x-www-form-urlencoded'
						},
						body: new URLSearchParams({ password }),
						redirect: 'manual'
					});
					assert.equal(login.status, 303);
					remember(login);
				}
				const response = await fetch(url + '/settings', {
					headers: { cookie: cookie() },
					redirect: 'manual'
				});
				assert.equal(response.status, 200);
				remember(response);
				return response.text();
			}
			async function action(name, values = {}) {
				const r = await fetch(`${url}/settings?/${name}`, {
					method: 'POST',
					headers: {
						origin: url,
						cookie: cookie(),
						'content-type': 'application/x-www-form-urlencoded',
						'x-sveltekit-action': 'true'
					},
					body: new URLSearchParams(values)
				});
				remember(r);
				return r.json();
			}
			async function terminal() {
				for (let i = 0; i < 1200; i++) {
					try {
						const value = JSON.parse(
							await fs.readFile(join(root, 'installation/installation.state/operation.json'))
						);
						if (['complete', 'failed', 'interrupted'].includes(value.status)) {
							// Terminal status is saved before the controller finishes restart and releases admission.
							if (!existsSync(join(root, 'installation/installation.state/lock'))) return value;
						}
					} catch {}
					await new Promise((r) => setTimeout(r, 100));
				}
				throw new Error('Update did not finish.');
			}
			for (const [version, password] of [
				['0.1.1', null],
				['0.1.2', 'fictional-test-password']
			]) {
				await settings();
				if (password) {
					const enabled = await action('password', {
						operation: 'enable',
						password,
						confirm_password: password
					});
					assert.notEqual(enabled.type, 'failure');
					await settings(password);
					assert.equal(
						(await action('lan', { operation: 'enable', confirm: 'true' })).type,
						'success'
					);
					baseline = await Promise.all(dataPaths.map((p) => fs.readFile(p)));
				}
				state.selected = version;
				await save();
				assert.equal((await action('checkUpdates')).type, 'success');
				const check = JSON.parse(
					await fs.readFile(join(root, 'installation/installation.state/check.json'))
				);
				assert.equal(
					(
						await action('installationOperation', {
							operation: 'update',
							confirm: 'true',
							check_id: check.id
						})
					).type,
					'success'
				);
				const completed = await terminal();
				assert.equal(completed.status, 'complete', JSON.stringify(completed));
				config = JSON.parse(await fs.readFile(descriptor));
				assert.equal(config.release, version);
				assert.equal(config.installation_id, receipt.installation_id);
				assert.equal(config.build.commit, state.releases[version].metadata.commit);
				url = completed.url ?? `http://127.0.0.1:${config.port}`;
				for (let i = 0; i < dataPaths.length; i++)
					assert.deepEqual(await fs.readFile(dataPaths[i]), baseline[i], dataPaths[i]);
				await settings(password);
				client = await connectMcp({
					entry: join(config.code_root, 'build/mcp/index.js'),
					env: process.env
				});
				const info = await client.call('get_saturday_info');
				assert.equal(info.jobs, 2);
				assert.equal(info.build.commit, config.build.commit);
				assert((await client.call('search_documentation', { query: 'phone' })).results.length);
				await client.close();
				client = null;
			}
			state.selected = '0.1.3';
			state.fail_download = true;
			await save();
			assert.equal((await action('checkUpdates')).type, 'success');
			let failedCheck = JSON.parse(
				await fs.readFile(join(root, 'installation/installation.state/check.json'))
			);
			assert.equal(
				(
					await action('installationOperation', {
						operation: 'update',
						confirm: 'true',
						check_id: failedCheck.id
					})
				).type,
				'success'
			);
			assert.equal((await terminal()).status, 'failed');
			state.fail_download = false;
			await save();
			assert.equal((await action('checkUpdates')).type, 'success');
			failedCheck = JSON.parse(
				await fs.readFile(join(root, 'installation/installation.state/check.json'))
			);
			assert.equal(
				(
					await action('installationOperation', {
						operation: 'update',
						confirm: 'true',
						check_id: failedCheck.id
					})
				).type,
				'success'
			);
			assert.equal((await terminal()).status, 'failed');
			state.selected = '0.1.4';
			await save();
			assert.equal((await action('checkUpdates')).type, 'success');
			failedCheck = JSON.parse(
				await fs.readFile(join(root, 'installation/installation.state/check.json'))
			);
			assert.equal(
				(
					await action('installationOperation', {
						operation: 'update',
						confirm: 'true',
						check_id: failedCheck.id
					})
				).type,
				'success'
			);
			const migrationFailure = await terminal();
			assert.equal(migrationFailure.status, 'failed');
			assert.match(await fs.readFile(migrationFailure.log, 'utf8'), /fictional_missing_table/);
			assert.equal(JSON.parse(await fs.readFile(descriptor)).release, '0.1.2');
			url = JSON.parse(await fs.readFile(join(config.data_root, 'server.state/server.json'))).url;
			await settings('fictional-test-password');
			for (const [version, message] of [
				['0.1.5', /LAN preferences/],
				['0.1.6', /password login/]
			]) {
				state.selected = version;
				await save();
				const incompatible = await action('checkUpdates');
				assert.equal(incompatible.type, 'failure');
				assert.match(JSON.stringify(incompatible), message);
			}
			state.selected = '0.1.2';
			await save();
			assert.equal((await action('checkUpdates')).type, 'success');
			assert.equal(
				JSON.parse(await fs.readFile(join(root, 'installation/installation.state/check.json')))
					.target.available,
				false
			);
			assert.equal(
				(
					await action('installationOperation', {
						operation: 'update',
						confirm: 'true',
						check_id: 'stale-fixture'
					})
				).type,
				'failure'
			);
			state.offline = true;
			await save();
			assert.equal((await action('checkUpdates')).type, 'failure');
			for (let i = 0; i < dataPaths.length; i++)
				assert.deepEqual(await fs.readFile(dataPaths[i]), baseline[i]);
		} finally {
			await client?.close();
			if (config) {
				const stateFile = join(config.data_root, 'server.state/server.json');
				let pid;
				try {
					pid = JSON.parse(await fs.readFile(stateFile)).pid;
				} catch {}
				await run(
					join(config.code_root, 'scripts/start.mjs'),
					'stop',
					'--installation',
					join(root, 'installation/installation.json'),
					'--json'
				).catch(() => {});
				if (pid)
					for (let i = 0; i < 150; i++) {
						try {
							process.kill(pid, 0);
						} catch {
							break;
						}
						await new Promise((r) => setTimeout(r, 100));
					}
			}
			globalThis.fetch = originalFetch;
			for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
			Object.assign(process.env, previous);
			await fs.rm(root, { recursive: true, force: true });
		}
	}
);
