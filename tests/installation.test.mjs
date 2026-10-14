import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import {
	defaultInstallationRoot,
	getInstallation,
	sourceProjectRoot
} from '../src/lib/server/installation.js';
import { readBuildInfo } from '../scripts/build-info.mjs';
const root = mkdtempSync(join(tmpdir(), 'saturday-installation-'));
test.after(() => rmSync(root, { recursive: true, force: true }));
const env = {
	...process.env,
	SATURDAY_PROJECT_ROOT: resolve('.'),
	SATURDAY_DB_PATH: join(root, 'source data ü', 'career.db'),
	SATURDAY_FILES_PATH: join(root, 'source data ü', 'files'),
	SATURDAY_EXTENSION_STATE_PATH: join(root, 'extension data'),
	SATURDAY_EXTENSIONS_PATH: join(root, 'extension code'),
	SATURDAY_INSTALLATION_PATH: ''
};
const setup = () =>
	spawnSync(
		process.execPath,
		['scripts/setup.mjs', '--skip-dependencies', '--skip-build', '--skip-pdf', '--json'],
		{ env, encoding: 'utf8' }
	);
test('default roots are explicit for all OS families without filesystem changes', () => {
	assert.equal(sourceProjectRoot(), resolve('.'));
	assert.equal(
		defaultInstallationRoot('darwin', {}, '/Users/example'),
		'/Users/example/Library/Application Support/Saturday'
	);
	assert.equal(
		defaultInstallationRoot('win32', { LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local' }),
		'C:\\Users\\Example\\AppData\\Local\\Saturday'
	);
	assert.equal(
		defaultInstallationRoot('linux', { XDG_DATA_HOME: '/custom/data' }, '/home/example'),
		'/custom/data/saturday'
	);
	assert.equal(
		defaultInstallationRoot('linux', { XDG_DATA_HOME: 'relative' }, '/home/example'),
		'/home/example/.local/share/saturday'
	);
});
test('source setup persists identity and shared paths, repeated setup preserves populated stores', () => {
	let result = setup();
	assert.equal(result.status, 0, result.stderr + result.stdout);
	const receipt = JSON.parse(result.stdout),
		descriptor = JSON.parse(readFileSync(receipt.descriptor_path));
	assert.equal(descriptor.database, env.SATURDAY_DB_PATH);
	assert.equal(descriptor.files, env.SATURDAY_FILES_PATH);
	assert.equal(descriptor.extension_state, env.SATURDAY_EXTENSION_STATE_PATH);
	const child = spawnSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			"import {createJob} from './src/lib/server/services.js';console.log(JSON.stringify(createJob({job_title:'Keep',company_name:'Example'})));"
		],
		{ env, encoding: 'utf8' }
	);
	assert.equal(child.status, 0, child.stderr);
	const before = readFileSync(descriptor.database),
		manifest = readFileSync(join(descriptor.files, 'manifest.json'));
	result = setup();
	assert.equal(result.status, 0, result.stderr + result.stdout);
	assert.equal(JSON.parse(result.stdout).installation_id, receipt.installation_id);
	assert.deepEqual(readFileSync(descriptor.database), before);
	assert.deepEqual(readFileSync(join(descriptor.files, 'manifest.json')), manifest);
	assert.ok(existsSync(join(descriptor.logs, 'setup.log')));
	assert.ok(existsSync(join(descriptor.extension_state, 'catalog.json')));
	const renamed = descriptor.database + '.saved';
	renameSync(descriptor.database, renamed);
	result = setup();
	assert.equal(result.status, 1);
	assert.match(JSON.parse(result.stdout).error.message, /missing or inaccessible/);
	assert.equal(existsSync(descriptor.database), false);
	renameSync(renamed, descriptor.database);
});
test('descriptor path overrides cannot switch an installation to another workspace', () => {
	const result = setup(),
		path = JSON.parse(result.stdout).descriptor_path;
	const child = spawnSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			"import {getInstallation} from './src/lib/server/installation.js';getInstallation();"
		],
		{
			env: { ...env, SATURDAY_INSTALLATION_PATH: path, SATURDAY_DB_PATH: join(root, 'wrong.db') },
			encoding: 'utf8'
		}
	);
	assert.equal(child.status, 1);
	assert.match(child.stderr, /conflicts/);
	assert.equal(existsSync(join(root, 'wrong.db')), false);
});
test('pinned archive builds retain their commit identity without Git', () => {
	const old = process.env.SATURDAY_BUILD_COMMIT;
	try {
		process.env.SATURDAY_BUILD_COMMIT = 'a'.repeat(40);
		assert.equal(readBuildInfo(root).commit, 'a'.repeat(40));
		process.env.SATURDAY_BUILD_COMMIT = 'invalid';
		assert.throws(() => readBuildInfo(root), /full commit SHA/);
	} finally {
		if (old === undefined) delete process.env.SATURDAY_BUILD_COMMIT;
		else process.env.SATURDAY_BUILD_COMMIT = old;
	}
});

test('status rejects an unrelated successful server response', async () => {
	const server = createServer((request, response) => {
		response.setHeader('content-type', 'application/json');
		response.end(
			JSON.stringify({
				app: 'saturday',
				status: 'ready',
				installation_id: 'another-installation',
				build: { id: 'example' }
			})
		);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		const port = server.address().port;
		const { spawn } = await import('node:child_process');
		const result = await new Promise((resolve, reject) => {
			const child = spawn(process.execPath, ['scripts/status.mjs', '--json'], {
				env: { ...env, PORT: String(port) },
				stdio: ['ignore', 'pipe', 'pipe']
			});
			let stdout = '';
			child.stdout.on('data', (data) => (stdout += data));
			child.once('error', reject);
			child.once('close', (status) => resolve({ status, stdout }));
		});
		assert.equal(result.status, 1);
		assert.equal(JSON.parse(result.stdout).error.code, 'NOT_READY');
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});

test('managed layout is separate from source data and descriptor works without legacy env paths', () => {
	const target = join(root, 'managed ü');
	const clean = {
		...process.env,
		SATURDAY_PROJECT_ROOT: resolve('.'),
		SATURDAY_DB_PATH: '',
		SATURDAY_FILES_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: '',
		SATURDAY_EXTENSIONS_PATH: '',
		SATURDAY_INSTALLATION_PATH: ''
	};
	const result = spawnSync(
		process.execPath,
		[
			'scripts/setup.mjs',
			'--managed',
			'--root',
			target,
			'--skip-dependencies',
			'--skip-build',
			'--skip-pdf',
			'--json'
		],
		{ env: clean, encoding: 'utf8' }
	);
	assert.equal(result.status, 0, result.stderr + result.stdout);
	const receipt = JSON.parse(result.stdout),
		descriptor = JSON.parse(readFileSync(receipt.descriptor_path));
	assert.equal(descriptor.database, join(target, 'data', 'saturday.db'));
	assert.equal(descriptor.runtime_owned, false);
	assert.equal(descriptor.code_owned, false);
	const probe = spawnSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			"import {getDatabasePath} from './src/lib/server/database.js';import {filePaths} from './src/lib/server/files/store.js';import {extensionPaths} from './src/lib/server/extensions.js';console.log(JSON.stringify({database:getDatabasePath(),files:filePaths().root,extensions:extensionPaths().state}));"
		],
		{ env: { ...clean, SATURDAY_INSTALLATION_PATH: receipt.descriptor_path }, encoding: 'utf8' }
	);
	assert.equal(probe.status, 0, probe.stderr);
	assert.deepEqual(JSON.parse(probe.stdout), {
		database: descriptor.database,
		files: descriptor.files,
		extensions: descriptor.extension_state
	});
});

test('platform launchers preserve literal paths and use one-shot login startup', async () => {
	const { launcherArtifacts } = await import('../src/lib/server/installation.js');
	const value = {
		installation_id: '12345678-1234-1234-1234-123456789012',
		code_root: '/tmp/code with ü $cash',
		node_path: '/tmp/private runtime/bin/node',
		descriptor_path: "/tmp/user's data/installation.json",
		logs: '/tmp/logs'
	};
	const mac = launcherArtifacts(value, { platform: 'darwin', home: '/tmp/home', env: {} });
	assert.match(mac.shell, /user'\\''s data/);
	assert.match(mac.loginContent, /<key>KeepAlive<\/key><false\/>/);
	assert.match(mac.loginContent, /<key>AbandonProcessGroup<\/key><true\/>/);
	assert.ok(mac.loginContent.includes('--background'));
	assert.ok(!mac.loginContent.includes('<string>open</string>'));
	const linux = launcherArtifacts(value, {
		platform: 'linux',
		home: '/tmp/home',
		env: { XDG_CONFIG_HOME: '/tmp/config' },
		desktop: '/tmp/redirected desktop'
	});
	assert.match(linux.desktop, /redirected desktop/);
	assert.match(linux.login, /^\/tmp\/config\/autostart/);
	assert.ok(linux.desktopContent.includes('\\\\$cash'));
	const win = launcherArtifacts(
		{
			...value,
			code_root: 'C:\\Users\\Example\\Saturday\\app',
			node_path: 'C:\\runtime\\node.exe',
			descriptor_path: 'C:\\user data\\installation.json',
			logs: 'C:\\logs'
		},
		{ platform: 'win32', home: 'C:\\Users\\Example', env: {} }
	);
	assert.equal(win.args('open')[0], 'C:\\Users\\Example\\Saturday\\app\\scripts\\start.mjs');
	assert.match(win.login, /^Saturday .*\.lnk$/);
});

test('GitHub snapshots are verified against exact Git blobs before setup', async () => {
	const { verifySource } = await import('../scripts/install.mjs');
	const { createHash } = await import('node:crypto');
	const path = join(root, 'verified-source');
	const { mkdir, writeFile } = await import('node:fs/promises');
	await mkdir(path);
	await writeFile(join(path, 'README.md'), 'source');
	const tree = {
		tree: [
			{
				path: 'README.md',
				type: 'blob',
				mode: '100644',
				sha: createHash('sha1').update('blob 6\0source').digest('hex')
			}
		]
	};
	await verifySource(path, tree);
	await writeFile(join(path, 'README.md'), 'changed');
	await assert.rejects(verifySource(path, tree), /integrity/);
	await assert.rejects(verifySource(path, { ...tree, truncated: true }), /Incomplete/);
});

test('interrupted first-install publication recovers its descriptor without resetting stores', async () => {
	const { recoverPublication } = await import('../scripts/install.mjs');
	const { mkdir, cp, writeFile } = await import('node:fs/promises');
	const { sourceInstallation } = await import('../src/lib/server/installation.js');
	const base = join(root, 'publication'),
		stage = join(base, 'install-stage-fixture'),
		candidate = join(stage, 'app'),
		app = join(base, 'app');
	await mkdir(join(candidate, 'src/lib/server'), { recursive: true });
	await cp('src/lib/server/installation.js', join(candidate, 'src/lib/server/installation.js'));
	await writeFile(join(candidate, 'package.json'), '{"type":"module"}');
	const config = {
		...sourceInstallation(),
		mode: 'managed',
		installation_id: '12345678-1234-1234-1234-123456789012',
		code_root: app,
		data_root: join(base, 'data'),
		database: join(base, 'data', 'saturday.db'),
		files: join(base, 'data', 'files'),
		files_state: join(base, 'data', 'files.state'),
		database_backups: join(base, 'data', 'backups', 'database'),
		database_restore: join(base, 'data', 'saturday.db.restore'),
		file_backups: join(base, 'data', 'backups', 'files'),
		extension_state: join(base, 'data', 'extensions'),
		extension_code: join(base, 'extensions'),
		extension_backups: join(base, 'data', 'extensions.backups'),
		logs: join(base, 'logs'),
		pdf_cache: join(base, 'runtime', 'chrome')
	};
	await writeFile(
		join(base, 'install-publication.json'),
		JSON.stringify({ format: 'saturday.install-publication', version: 1, app, candidate, config })
	);
	await recoverPublication(base);
	assert.ok(existsSync(join(base, 'installation.json')));
	assert.ok(!existsSync(stage));
	const descriptor = readFileSync(join(base, 'installation.json'));
	await recoverPublication(base);
	assert.deepEqual(readFileSync(join(base, 'installation.json')), descriptor);
});
