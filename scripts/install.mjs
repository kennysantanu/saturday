// Dependency-free bootstrap engine. Entry wrappers prepare a verified private Node runtime.
import * as fs from 'node:fs/promises';
import { existsSync, writeFileSync, lstatSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
const repo = 'kennysantanu/saturday';
export const runtimeVersion = '24.21.0';
export const runtimeHashes = {
	'darwin-arm64': 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
	'darwin-x64': '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
	'linux-x64': '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff',
	'win32-x64': '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
};
let logPath,
	logText = '';
const output = (chunk) => {
	process.stderr.write(chunk);
	if (logPath) {
		logText = (logText + String(chunk)).slice(-1024 * 1024);
		try {
			if (existsSync(logPath) && lstatSync(logPath).isSymbolicLink()) throw new Error('Unsafe log');
			writeFileSync(logPath, logText, { mode: 0o600 });
		} catch {
			/* Console retains diagnostics when log writing fails. */
		}
	}
};
const say = (s) => output(`${s}\n`);
export function run(command, args, options = {}) {
	return new Promise((res, rej) => {
		const child = spawn(command, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
			...options
		});
		for (const stream of [child.stdout, child.stderr]) stream?.on('data', output);
		child.once('error', rej);
		child.once('close', (code) =>
			code === 0 ? res() : rej(new Error(`Command failed (${code}): ${command}`))
		);
	});
}
async function request(url) {
	const response = await fetch(url, {
		headers: { 'user-agent': 'Saturday installer', accept: 'application/vnd.github+json' },
		signal: AbortSignal.timeout(120000)
	});
	if (!response.ok)
		throw new Error(
			`Download failed (${response.status}). Check network/GitHub rate limits and retry installation.`
		);
	return response;
}
export async function verifySource(root, tree) {
	if (tree.truncated || !Array.isArray(tree.tree))
		throw new Error('Incomplete GitHub source metadata. Retry later.');
	const expected = new Map(tree.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e]));
	let count = 0;
	async function walk(dir) {
		for (const name of await fs.readdir(dir)) {
			const path = join(dir, name),
				key = relative(root, path).split(sep).join('/'),
				stat = await fs.lstat(path);
			if (stat.isSymbolicLink()) throw new Error('Source snapshots cannot contain symbolic links.');
			if (stat.isDirectory()) {
				await walk(path);
				continue;
			}
			const entry = expected.get(key);
			if (!stat.isFile() || !entry || !['100644', '100755'].includes(entry.mode))
				throw new Error(`Unexpected source entry: ${key}`);
			const bytes = await fs.readFile(path);
			const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
			if (sha !== entry.sha) throw new Error(`Source integrity check failed: ${key}`);
			count++;
		}
	}
	await walk(root);
	if (count !== expected.size || tree.tree.some((e) => e.type === 'commit'))
		throw new Error('Incomplete or unsupported source snapshot.');
}
export async function copySource(source, target) {
	const excluded = new Set([
		'.git',
		'node_modules',
		'build',
		'.svelte-kit',
		'data',
		'extensions',
		'.env'
	]);
	await fs.cp(source, target, {
		recursive: true,
		filter: async (path) => {
			const key = relative(source, path).split(sep).join('/');
			if (!key) return true;
			if (
				excluded.has(key.split('/')[0]) ||
				(key.startsWith('.env.') && !['.env.example', '.env.test'].includes(key))
			)
				return false;
			if ((await fs.lstat(path)).isSymbolicLink())
				throw new Error('Local source contains a symbolic link. Use an ordinary checkout.');
			return ![
				'src/lib/extensions.generated.js',
				'src/lib/server/extensions.generated.js'
			].includes(key);
		}
	});
}
export async function downloadSource(stage, commit) {
	const selected = await (
		await request(`https://api.github.com/repos/${repo}/commits/${commit || 'main'}`)
	).json();
	if (!/^[a-f0-9]{40}$/.test(selected.sha) || !/^[a-f0-9]{40}$/.test(selected.commit?.tree?.sha))
		throw new Error('GitHub did not return an exact source identity.');
	const tree = await (
		await request(
			`https://api.github.com/repos/${repo}/git/trees/${selected.commit.tree.sha}?recursive=1`
		)
	).json();
	const archive = join(stage, 'source.tar.gz'),
		extract = join(stage, 'source');
	await fs.mkdir(extract, { recursive: true });
	const response = await request(`https://codeload.github.com/${repo}/tar.gz/${selected.sha}`);
	const handle = await fs.open(archive, 'w', 0o600);
	try {
		for await (const chunk of response.body) await handle.write(chunk);
	} finally {
		await handle.close();
	}
	// Check paths/types before extraction as well as validating file hashes before execution.
	if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete source metadata.');
	for (const entry of tree.tree) {
		if (
			!['tree', 'blob'].includes(entry.type) ||
			(entry.type === 'blob' && !['100644', '100755'].includes(entry.mode)) ||
			typeof entry.path !== 'string' ||
			/[\\\r\n]/.test(entry.path) ||
			entry.path.split('/').some((part) => ['', '.', '..'].includes(part))
		)
			throw new Error('Unsupported source archive paths or file types.');
	}
	const listing = (args) =>
		new Promise((res, rej) =>
			execFile(
				'tar',
				args,
				{ encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true },
				(e, stdout) => (e ? rej(e) : res(stdout.trim().split('\n')))
			)
		);
	const prefix = `saturday-${selected.sha}`,
		allowed = new Set([prefix, ...tree.tree.map((entry) => `${prefix}/${entry.path}`)]),
		seen = new Set();
	for (const name of await listing(['-tzf', archive])) {
		const key = name.replace(/\/$/, '');
		if (!allowed.has(key) || seen.has(key))
			throw new Error('Unexpected or duplicate source archive path.');
		seen.add(key);
	}
	if ((await listing(['-tvzf', archive])).some((line) => !['-', 'd'].includes(line[0])))
		throw new Error('Source archives cannot contain links or special files.');
	await run('tar', ['-xzf', archive, '-C', extract]);
	const entries = await fs.readdir(extract);
	if (entries.length !== 1 || entries[0] !== `saturday-${selected.sha}`)
		throw new Error('Unexpected source archive root.');
	const source = join(extract, entries[0]);
	await verifySource(source, tree);
	return { source, commit: selected.sha };
}
export async function recoverPublication(root) {
	const journal = join(root, 'install-publication.json');
	if (!existsSync(journal)) return;
	if ((await fs.lstat(journal)).isSymbolicLink()) throw new Error('Unsafe installation journal.');
	const state = JSON.parse(await fs.readFile(journal, 'utf8'));
	const stage = state.candidate && dirname(state.candidate);
	if (
		state.format !== 'saturday.install-publication' ||
		state.version !== 1 ||
		state.app !== join(root, 'app') ||
		dirname(stage || '') !== root ||
		!stage.split(sep).at(-1).startsWith('install-stage-') ||
		state.candidate !== join(stage, 'app') ||
		state.config?.code_root !== state.app ||
		state.config?.data_root !== join(root, 'data')
	)
		throw new Error('Invalid installation publication journal. Repair without resetting data.');
	for (const [key, expected] of Object.entries({
		database: join(root, 'data', 'saturday.db'),
		files: join(root, 'data', 'files'),
		files_state: join(root, 'data', 'files.state'),
		database_backups: join(root, 'data', 'backups', 'database'),
		database_restore: join(root, 'data', 'saturday.db.restore'),
		file_backups: join(root, 'data', 'backups', 'files'),
		extension_state: join(root, 'data', 'extensions'),
		extension_code: join(root, 'extensions'),
		extension_backups: join(root, 'data', 'extensions.backups'),
		logs: join(root, 'logs'),
		pdf_cache: join(root, 'runtime', 'chrome')
	}))
		if (state.config[key] !== expected)
			throw new Error(
				'Publication storage paths differ from the owned workspace. Repair without resetting data.'
			);
	if (!existsSync(state.app)) {
		if (
			!existsSync(state.candidate) ||
			!(await fs.lstat(state.candidate)).isDirectory() ||
			(await fs.lstat(state.candidate)).isSymbolicLink()
		)
			throw new Error('Installation candidate is missing. Inspect the journal before repair.');
		await fs.rename(state.candidate, state.app);
	} else if ((await fs.lstat(state.app)).isSymbolicLink())
		throw new Error('Unsafe application path.');
	const shared = await import(
		pathToFileURL(join(state.app, 'src', 'lib', 'server', 'installation.js'))
	);
	shared.validateInstallation(state.config);
	const descriptor = join(root, 'installation.json');
	if (existsSync(descriptor)) {
		if (
			JSON.parse(await fs.readFile(descriptor, 'utf8')).installation_id !==
			state.config.installation_id
		)
			throw new Error('Publication conflicts with an existing installation.');
	} else await shared.atomicJson(descriptor, state.config);
	await fs.rm(journal);
	await fs.rm(stage, { recursive: true, force: true });
}
export async function install(values, services = {}) {
	const execute = services.run || run;
	if (!runtimeHashes[`${process.platform}-${process.arch}`])
		throw new Error('This OS/CPU is outside the initial installation matrix. See README.');
	if (process.versions.node.split('.')[0] < 24)
		throw new Error('Use the pinned private Node runtime from install.sh or install.bat.');
	const root = values.root
		? resolve(values.root)
		: process.platform === 'darwin'
			? join(homedir(), 'Library', 'Application Support', 'Saturday')
			: process.platform === 'win32'
				? join(process.env.LOCALAPPDATA || '', 'Saturday')
				: join(
						process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.startsWith('/')
							? process.env.XDG_DATA_HOME
							: join(homedir(), '.local', 'share'),
						'saturday'
					);
	if (/[\r\n\0]/.test(root)) throw new Error('Installation paths cannot contain line breaks.');
	await fs.mkdir(root, { recursive: true, mode: 0o700 });
	if ((await fs.lstat(root)).isSymbolicLink())
		throw new Error('Installation root cannot be a symbolic link.');
	await fs.mkdir(join(root, 'logs'), { recursive: true, mode: 0o700 });
	logPath = join(root, 'logs', 'installer.log');
	const lock = join(root, 'bootstrap.lock');
	try {
		await fs.mkdir(lock);
	} catch (e) {
		if (e.code !== 'EEXIST') throw e;
		if ((await fs.lstat(lock)).isSymbolicLink()) throw new Error('Unsafe installer lock.');
		const ownerPath = join(lock, 'owner.json');
		if (!existsSync(ownerPath)) {
			if (Date.now() - (await fs.stat(lock)).mtimeMs < 30000)
				throw new Error('Another installer is starting. Retry shortly.');
		} else {
			if ((await fs.lstat(ownerPath)).isSymbolicLink()) throw new Error('Unsafe installer owner.');
			const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
			if (!Number.isSafeInteger(owner.pid) || owner.pid < 1)
				throw new Error('Unrecognized installer owner. Repair without resetting data.');
			try {
				process.kill(owner.pid, 0);
				throw new Error('Another installation is running. Wait for it to finish.');
			} catch (error) {
				if (error.code !== 'ESRCH') throw error;
			}
			await fs.unlink(ownerPath);
		}
		await fs.rmdir(lock); // Refuse unexpected files instead of recursively removing unknown state.
		await fs.mkdir(lock);
	}
	await fs.writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }), {
		flag: 'wx'
	});
	let stage;
	try {
		await recoverPublication(root);
		let descriptor = join(root, 'installation.json');
		if (
			!existsSync(descriptor) &&
			values.source &&
			existsSync(join(resolve(values.source), 'data', 'installation.json'))
		) {
			descriptor = join(resolve(values.source), 'data', 'installation.json');
			say('Using the existing source workspace without moving its data.');
		}
		let config = existsSync(descriptor) ? JSON.parse(await fs.readFile(descriptor, 'utf8')) : null;
		let app = config?.code_root || join(root, 'app');
		if (config?.uninstalled) {
			if (config.uninstall?.status !== 'complete')
				throw new Error(
					'Uninstall cleanup is incomplete. Finish the confirmed uninstall before reinstalling.'
				);
			stage = await fs.mkdtemp(join(root, 'install-stage-'));
			const source = values.source
				? resolve(values.source)
				: (await downloadSource(stage, config.build?.commit || undefined)).source;
			const operations = await import(
				pathToFileURL(join(source, 'src/lib/server/installation-operations.js'))
			);
			process.env.SATURDAY_INSTALLATION_PATH = descriptor;
			for (const name of [
				'SATURDAY_PROJECT_ROOT',
				'SATURDAY_DB_PATH',
				'SATURDAY_FILES_PATH',
				'SATURDAY_EXTENSION_STATE_PATH',
				'SATURDAY_EXTENSIONS_PATH'
			])
				delete process.env[name];
			let operation = await operations.queueOperation('repair', {
				source,
				retry_pdf: !values['skip-pdf']
			});
			while (
				[
					'queued',
					'staging',
					'waiting_for_disconnect',
					'backing_up',
					'publishing',
					'migrating',
					'restarting'
				].includes(operation.status) &&
				!operation.error
			) {
				await new Promise((r) => setTimeout(r, 500));
				operation = operations.operationStatus();
			}
			if (operation.status !== 'complete')
				throw new Error(`${operation.error || operation.step}. See ${operation.logs}`);
			config = JSON.parse(await fs.readFile(descriptor, 'utf8'));
			app = config.code_root;
		}
		if (!config && existsSync(app))
			throw new Error(
				'An application directory already exists without a descriptor. Inspect/repair it; installation will not overwrite it.'
			);
		if (!config && existsSync(join(root, 'data')))
			throw new Error(
				'Data exists without an installation descriptor. Inspect/recover it before installing; no replacement workspace was created.'
			);
		if (!config) {
			stage = await fs.mkdtemp(join(root, 'install-stage-'));
			say('Preparing an exact Saturday source snapshot…');
			let selected = values.source
				? { source: resolve(values.source), commit: null }
				: await downloadSource(stage, values.commit || values['bootstrap-commit']);
			if (!values.source && !values.commit) {
				const operations = await import(
					pathToFileURL(join(selected.source, 'src/lib/server/installation-operations.js'))
				);
				const target = await operations.selectTarget({ build: { commit: null } });
				if (target.commit !== selected.commit) {
					const next = join(stage, 'selected');
					await fs.mkdir(next);
					selected = await downloadSource(next, target.commit);
				}
				selected.target = target;
			}
			const candidate = join(stage, 'app');
			await copySource(selected.source, candidate);
			const operationServices = await import(
				pathToFileURL(join(candidate, 'src/lib/server/installation-operations.js'))
			);
			const packageInfo = JSON.parse(await fs.readFile(join(candidate, 'package.json'), 'utf8'));
			operationServices.validateDistribution(packageInfo.saturday);
			const baseRuntime = {
				descriptor_path: descriptor,
				installation_id: randomUUID(),
				node_path: process.execPath,
				runtime_root:
					process.platform === 'win32'
						? dirname(process.execPath)
						: dirname(dirname(process.execPath)),
				runtime_owned: process.execPath.startsWith(join(root, 'runtime') + sep)
			};
			const preparedRuntime = await (services.prepareRuntime || operationServices.prepareRuntime)(
				baseRuntime,
				packageInfo.saturday
			);
			const env = {
				...process.env,
				SATURDAY_INSTALLATION_PATH: '',
				SATURDAY_PROJECT_ROOT: candidate,
				SATURDAY_DB_PATH: '',
				SATURDAY_FILES_PATH: '',
				SATURDAY_EXTENSION_STATE_PATH: '',
				SATURDAY_EXTENSIONS_PATH: '',
				SATURDAY_SETUP_STAGING: '1',
				PUPPETEER_CACHE_DIR: join(root, 'runtime', 'chrome'),
				PATH: `${dirname(preparedRuntime.node_path)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`,
				SATURDAY_BUILD_COMMIT: selected.commit || '',
				SATURDAY_BUILD_ID: selected.commit
					? ''
					: `local.${(await operationServices.codeFingerprint(candidate)).slice(0, 12)}`,
				SATURDAY_BUILD_DIRTY: ''
			};
			say('Building Saturday before activation…');
			await execute(
				preparedRuntime.node_path,
				[
					join(candidate, 'scripts', 'setup.mjs'),
					'--managed',
					'--root',
					join(stage, 'workspace'),
					...(values['skip-pdf'] ? ['--skip-pdf'] : [])
				],
				{ cwd: candidate, env }
			);
			config = JSON.parse(await fs.readFile(join(stage, 'workspace', 'installation.json'), 'utf8'));
			config.installation_id = preparedRuntime.installation_id;
			config.code_root = app;
			config.release = selected.target?.release || null;
			config.distribution = selected.target?.kind || 'development';
			config.runtime_root = preparedRuntime.runtime_root;
			config.node_path = preparedRuntime.node_path;
			config.runtime_owned = preparedRuntime.runtime_owned;
			config.runtime_history = preparedRuntime.runtime_history;
			config.code_owned = true;
			config.pdf_cache = join(root, 'runtime', 'chrome');
			// Shared setup creates the real stores only after code has built. Candidate stores are disposable.
			const data = join(root, 'data');
			Object.assign(config, {
				data_root: data,
				database: join(data, 'saturday.db'),
				files: join(data, 'files'),
				files_state: join(data, 'files.state'),
				database_backups: join(data, 'backups', 'database'),
				database_restore: join(data, 'saturday.db.restore'),
				file_backups: join(data, 'backups', 'files'),
				extension_state: join(data, 'extensions'),
				extension_code: join(root, 'extensions'),
				extension_backups: join(data, 'extensions.backups'),
				logs: join(root, 'logs'),
				initialized: { database: false, files: false, extensions: false },
				setup: { pdf: config.setup.pdf }
			});
			const shared = await import(
				pathToFileURL(join(candidate, 'src', 'lib', 'server', 'installation.js'))
			);
			shared.validateInstallation(config);
			const journal = join(root, 'install-publication.json');
			await shared.atomicJson(journal, {
				format: 'saturday.install-publication',
				version: 1,
				candidate,
				app,
				config
			});
			await fs.rename(candidate, app);
			await shared.atomicJson(descriptor, config);
			await fs.rm(journal);
		}
		const shared = await import(
			pathToFileURL(join(app, 'src', 'lib', 'server', 'installation.js'))
		);
		shared.validateInstallation(config);
		Object.assign(
			process.env,
			shared.installationEnvironment({ ...config, descriptor_path: descriptor }),
			{
				SATURDAY_SETUP_STAGING: '',
				SATURDAY_BUILD_COMMIT: config.build?.commit || '',
				SATURDAY_BUILD_ID: config.build?.id?.startsWith('local.') ? config.build.id : '',
				SATURDAY_BUILD_DIRTY: config.build?.dirty ? '1' : '',
				...(config.pdf_cache ? { PUPPETEER_CACHE_DIR: config.pdf_cache } : {})
			}
		);
		say('Preparing your workspace…');
		await execute(
			config.node_path,
			[
				join(app, 'scripts', 'setup.mjs'),
				'--skip-dependencies',
				'--skip-build',
				...(values['retry-pdf'] ? [] : ['--skip-pdf'])
			],
			{ cwd: app, env: process.env }
		);
		let shortcut;
		try {
			shortcut = await shared.createDesktopShortcut({ desktop: values.desktop });
			say(`Desktop shortcut: ${shortcut}`);
		} catch (e) {
			say(
				`Shortcut unavailable: ${e.message}. Reopen with: "${config.node_path}" "${join(app, 'scripts', 'start.mjs')}" open --installation "${descriptor}"`
			);
		}
		const refreshed = JSON.parse(await fs.readFile(descriptor, 'utf8'));
		const operationServices = await import(
			pathToFileURL(join(app, 'src/lib/server/installation-operations.js'))
		);
		refreshed.code_fingerprint ??= await operationServices.codeFingerprint(app);
		await shared.atomicJson(descriptor, refreshed);
		// Preserve actual login registration; do not enable it on installation/reinstallation.
		const server = await import(
			pathToFileURL(join(app, 'src', 'lib', 'server', 'server-lifecycle.js'))
		);
		const ready = await server.startServer({ open: !values['no-open'] });
		return {
			ok: true,
			installation_id: config.installation_id,
			descriptor_path: descriptor,
			data_path: config.data_root,
			url: ready.url,
			shortcut: shortcut || null,
			pdf: JSON.parse(await fs.readFile(descriptor, 'utf8')).setup?.pdf?.status || 'see Settings'
		};
	} finally {
		if (stage && !existsSync(join(root, 'install-publication.json')))
			await fs.rm(stage, { recursive: true, force: true });
		await fs.unlink(join(lock, 'owner.json'));
		await fs.rmdir(lock);
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const { values, positionals } = parseArgs({
			allowPositionals: true,
			options: {
				installation: { type: 'string' },
				'check-id': { type: 'string' },
				'operation-id': { type: 'string' },
				confirm: { type: 'boolean' },
				'delete-data': { type: 'boolean' },
				background: { type: 'boolean' },
				root: { type: 'string' },
				desktop: { type: 'string' },
				source: { type: 'string' },
				commit: { type: 'string' },
				'bootstrap-commit': { type: 'string' },
				'skip-pdf': { type: 'boolean' },
				'retry-pdf': { type: 'boolean' },
				'no-open': { type: 'boolean' },
				json: { type: 'boolean' }
			}
		});
		if (values.commit && !/^[a-f0-9]{40}$/.test(values.commit))
			throw new Error('--commit must be a full GitHub commit SHA.');
		if (values.installation) {
			for (const name of [
				'SATURDAY_PROJECT_ROOT',
				'SATURDAY_DB_PATH',
				'SATURDAY_FILES_PATH',
				'SATURDAY_EXTENSION_STATE_PATH',
				'SATURDAY_EXTENSIONS_PATH'
			])
				delete process.env[name];
			process.env.SATURDAY_INSTALLATION_PATH = resolve(values.installation);
		}
		const action = positionals[0] || 'install';
		let operations = null;
		if (action !== 'install') {
			const local = new URL('../src/lib/server/installation-operations.js', import.meta.url);
			if (existsSync(local)) operations = await import(local);
			else {
				const descriptor =
					values.installation || join(resolve(values.root || '.'), 'installation.json');
				const config = JSON.parse(await fs.readFile(descriptor, 'utf8'));
				operations = await import(
					pathToFileURL(join(config.code_root, 'src/lib/server/installation-operations.js'))
				);
			}
		}
		const { checkUpdates, operationStatus, queueOperation, executeOperation } = operations || {};
		let result;
		if (action === 'check') result = await checkUpdates();
		else if (action === 'status') result = operationStatus();
		else if (action === 'execute') {
			await executeOperation(values['operation-id'], { downloadSource, copySource, run });
			result = operationStatus();
		} else if (['update', 'repair', 'uninstall'].includes(action)) {
			if (action === 'update' && !values['check-id']) {
				const check = await checkUpdates();
				say(`Selected ${check.target.release || check.target.commit}`);
				values['check-id'] = check.id;
			}
			result = await queueOperation(action, {
				check_id: values['check-id'],
				confirm: values.confirm,
				delete_data: values['delete-data'],
				source: values.source,
				retry_pdf: values['retry-pdf']
			});
			if (!values.background) {
				let step = '';
				while (
					[
						'queued',
						'staging',
						'backing_up',
						'publishing',
						'migrating',
						'restarting',
						'removing',
						'waiting_for_disconnect'
					].includes(result.status) &&
					!result.error
				) {
					if (step !== result.step) {
						step = result.step;
						say(step);
					}
					await new Promise((r) => setTimeout(r, 500));
					result = operationStatus();
				}
				if (result.status !== 'complete') process.exitCode = 1;
			}
		} else if (action === 'install') result = await install(values);
		else throw new Error('Use install/check/update/repair/uninstall/status.');
		if (values.json) console.log(JSON.stringify(result));
		else say(result?.url ? `Saturday is ready at ${result.url}.` : JSON.stringify(result));
	} catch (e) {
		if (process.argv.includes('--json'))
			console.log(
				JSON.stringify({
					ok: false,
					error: { code: 'INSTALL_FAILED', message: e.message },
					logs_path: logPath || null
				})
			);
		say(
			`Installation failed: ${e.message}\nRetry the same installer. Your existing data has not been reset.`
		);
		process.exitCode = 1;
	}
}
