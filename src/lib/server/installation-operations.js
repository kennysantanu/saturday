// Shared manual installation operations. No web framework or store initialization on import.
import { readAccessSettings, accessCookieName } from './access-settings.js';
import { createServer } from 'node:http';
import * as fs from 'node:fs/promises';
import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	getInstallation,
	installationEnvironment,
	atomicJson,
	acquireDirectoryLock,
	validateInstallation,
	loginStartupStatus,
	refreshLoginStartup,
	createDesktopShortcut,
	setLoginStartup,
	removeDesktopShortcut
} from './installation.js';
import {
	serverSummary,
	controlServer,
	startServer,
	claimInstallationMaintenance,
	validServerSession,
	serverPaths
} from './server-lifecycle.js';
const repository = 'kennysantanu/saturday';
const api = `https://api.github.com/repos/${repository}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const activeStates = [
	'queued',
	'staging',
	'waiting_for_disconnect',
	'backing_up',
	'publishing',
	'migrating',
	'restarting',
	'removing'
];
export function operationPaths(config = getInstallation()) {
	if (!config.descriptor_path) throw new Error('Run setup before managing installation.');
	const root = join(dirname(config.descriptor_path), 'installation.state');
	if (existsSync(root) && (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()))
		throw new Error('Installation operation state must be an owned regular directory.');
	return {
		root,
		status: join(root, 'operation.json'),
		check: join(root, 'check.json'),
		lock: join(root, 'lock'),
		journal: join(root, 'publication.json')
	};
}
function readJson(path) {
	if (!existsSync(path)) return null;
	if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
		throw new Error('Unsafe installation operation state. Repair without resetting data.');
	return JSON.parse(readFileSync(path, 'utf8'));
}
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code !== 'ESRCH';
	}
};
export function operationStatus() {
	const state = readJson(operationPaths().status);
	if (!state) return null;
	if (
		state.format !== 'saturday.operation' ||
		state.version !== 1 ||
		state.installation_id !== getInstallation().installation_id
	)
		throw new Error('Unsupported installation operation state.');
	return {
		id: state.id,
		operation: state.operation,
		status:
			activeStates.includes(state.status) && !state.error && state.pid && !alive(state.pid)
				? 'interrupted'
				: state.status,
		step: state.step,
		error: state.error,
		target: state.target,
		started_at: state.started_at,
		completed_at: state.completed_at,
		logs: state.log,
		recovery: state.recovery,
		reconnect_required: state.reconnect_required,
		configuration_changed: state.configuration_changed,
		warning: state.warning,
		poll_url: state.poll_url,
		retained_paths: state.retained_paths,
		url: state.url
	};
}
export function installedCheck() {
	return readJson(operationPaths().check);
}
export function compareVersions(a, b) {
	const parse = (v) => {
		if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v))
			throw new Error('Expected a stable release version.');
		return v.split('.').map(Number);
	};
	const x = parse(a),
		y = parse(b);
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
	return 0;
}
async function github(path) {
	const response = await fetch(`${api}${path}`, {
		headers: { accept: 'application/vnd.github+json', 'user-agent': 'Saturday updater' },
		signal: AbortSignal.timeout(15000)
	});
	if (!response.ok)
		throw new Error(
			`GitHub update check failed (${response.status}). Check your connection or rate limit and retry.`
		);
	return response.json();
}
export function validateRelease(metadata, release) {
	const version = release.tag_name?.replace(/^v/, '');
	compareVersions(version, '0.1.0');
	if (
		metadata?.format !== 'saturday.release' ||
		metadata.version !== 1 ||
		metadata.release !== version ||
		!/^[a-f0-9]{40}$/.test(metadata.commit || '') ||
		metadata.source?.type !== 'github-source' ||
		!/^\d+\.\d+\.\d+$/.test(metadata.node_minimum || '') ||
		!metadata.storage?.database ||
		!metadata.storage?.manifest
	)
		throw new Error('Release metadata is invalid or unsupported.');
	validateDistribution({ ...metadata, installation_api: metadata.installation_api });
	return metadata;
}
export function validateDistribution(metadata) {
	if (
		metadata?.installation_api !== 1 ||
		!/^\d+\.\d+\.\d+$/.test(metadata.node_minimum || '') ||
		metadata.storage?.database?.format !== 'saturday.database.numeric' ||
		metadata.storage?.manifest?.format !== 'saturday.files.numeric'
	)
		throw new Error(
			'This build does not provide a compatible installation/storage contract. Keep the current build.'
		);
	for (const [min, max] of [
		[metadata.storage.database.minimumVersion, metadata.storage.database.currentVersion],
		[metadata.storage.manifest.minimumVersion, metadata.storage.manifest.version]
	])
		if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min)
			throw new Error('Invalid distribution storage bounds.');
	if (metadata.runtime) {
		if (
			compareVersions(metadata.runtime.version, metadata.node_minimum) < 0 ||
			!/^[a-f0-9]{64}$/.test(metadata.runtime.hashes?.[`${process.platform}-${process.arch}`] || '')
		)
			throw new Error('Pinned runtime metadata is unsupported on this OS/CPU.');
	}
	return metadata;
}
export async function prepareRuntime(config, metadata, currentVersion = process.versions.node) {
	if (compareVersions(currentVersion, metadata.node_minimum) >= 0) return config;
	const runtime = metadata.runtime,
		key = `${process.platform}-${process.arch}`;
	if (
		!runtime ||
		compareVersions(runtime.version, metadata.node_minimum) < 0 ||
		!/^[a-f0-9]{64}$/.test(runtime.hashes?.[key] || '')
	)
		throw new Error(
			'The candidate needs a newer runtime but supplies no supported pinned runtime artifact. Use a compatible installer.'
		);
	const root = join(dirname(config.descriptor_path), 'runtime'),
		os = process.platform === 'win32' ? 'win' : process.platform,
		name = `node-v${runtime.version}-${os}-${process.arch}`,
		target = join(root, name);
	await fs.mkdir(root, { recursive: true, mode: 0o700 });
	if ((await fs.lstat(root)).isSymbolicLink())
		throw new Error('Runtime directory cannot be linked.');
	if (existsSync(target)) {
		const stamp = readJson(join(target, 'saturday-runtime.json'));
		if (stamp?.sha256 !== runtime.hashes[key] || stamp?.installation_id !== config.installation_id)
			throw new Error('An unverified runtime occupies the candidate path. Preserve it for review.');
	} else {
		const stage = await fs.mkdtemp(join(root, 'stage-')),
			archive = join(stage, process.platform === 'win32' ? 'runtime.zip' : 'runtime.tar.gz');
		try {
			const response = await fetch(
				`https://nodejs.org/dist/v${runtime.version}/${name}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`,
				{ signal: AbortSignal.timeout(120000) }
			);
			if (!response.ok) throw new Error(`Runtime download failed (${response.status}).`);
			const stream = await fs.open(archive, 'wx', 0o600);
			try {
				for await (const chunk of response.body) await stream.write(chunk);
			} finally {
				await stream.close();
			}
			if ((await hashFile(archive)) !== runtime.hashes[key])
				throw new Error('Runtime SHA-256 validation failed.');
			await command('tar', ['-xf', archive, '-C', stage]);
			const candidate = join(stage, name),
				node = join(candidate, process.platform === 'win32' ? 'node.exe' : 'bin/node');
			if ((await command(node, ['--version'])) !== `v${runtime.version}`)
				throw new Error('Runtime identity differs from the pinned artifact.');
			await command(node, [
				'--input-type=module',
				'-e',
				"import {DatabaseSync} from 'node:sqlite';new DatabaseSync(':memory:').close();"
			]);
			await atomicJson(join(candidate, 'saturday-runtime.json'), {
				format: 'saturday.runtime',
				version: 1,
				installation_id: config.installation_id,
				sha256: runtime.hashes[key]
			});
			await fs.rename(candidate, target);
		} finally {
			await fs.rm(stage, { recursive: true, force: true });
		}
	}
	return {
		...config,
		node_path: join(target, process.platform === 'win32' ? 'node.exe' : 'bin/node'),
		runtime_root: target,
		runtime_owned: true,
		runtime_history: [
			...(config.runtime_history || []),
			{ root: config.runtime_root, node_path: config.node_path, owned: config.runtime_owned }
		]
	};
}
async function candidateMetadata(commit, request, target) {
	const content = await request(`/contents/package.json?ref=${commit}`);
	if (content.encoding !== 'base64' || typeof content.content !== 'string')
		throw new Error('Candidate package metadata is unavailable.');
	const pkg = JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'));
	validateDistribution(pkg.saturday);
	if (readAccessSettings().allow_lan && pkg.saturday.lan_api !== 1)
		throw new Error(
			'This candidate does not support saved LAN preferences. Disable LAN and restart before changing to this build.'
		);
	if (readAccessSettings().password && pkg.saturday.access_api !== 1)
		throw new Error(
			'This candidate does not support password login. Keep the current build or explicitly disable password login before changing to an older build.'
		);
	if (
		pkg.name !== 'saturday' ||
		pkg.engines?.node !== `>=${pkg.saturday.node_minimum}` ||
		(target?.kind === 'release' && pkg.version !== target.release)
	)
		throw new Error(
			'Candidate package/version/runtime metadata does not match the selected Saturday build.'
		);
	if (
		compareVersions(process.versions.node, pkg.saturday.node_minimum) < 0 &&
		!pkg.saturday.runtime
	)
		throw new Error(
			'This candidate needs a newer runtime. Use a compatible installer/runtime before updating.'
		);
	return pkg.saturday;
}
export async function selectTarget(config, request = github, assetRequest = fetch) {
	let releases = [];
	for (let page = 1; ; page++) {
		const result = await request(`/releases?per_page=100&page=${page}`);
		if (!Array.isArray(result)) throw new Error('Invalid release response.');
		releases.push(...result);
		if (result.length < 100) break;
		if (page >= 10) throw new Error('Release history needs an updated selector.');
	}
	const eligible = releases
		.filter(
			(r) =>
				!r.draft &&
				!r.prerelease &&
				/^(v)?\d+\.\d+\.\d+$/.test(r.tag_name || '') &&
				(r.assets || []).some((a) => a.name === 'saturday-release.json' && a.state === 'uploaded')
		)
		.sort((a, b) => compareVersions(b.tag_name.replace(/^v/, ''), a.tag_name.replace(/^v/, '')));
	if (eligible.length) {
		const r = eligible[0],
			asset = r.assets.find((a) => a.name === 'saturday-release.json');
		if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') || !Number.isSafeInteger(asset.id))
			throw new Error('Release metadata is missing its published SHA-256 digest.');
		const response = await assetRequest(`${api}/releases/assets/${asset.id}`, {
			headers: { accept: 'application/octet-stream', 'user-agent': 'Saturday updater' },
			signal: AbortSignal.timeout(15000)
		});
		if (!response.ok) throw new Error('Release metadata could not be downloaded. Retry the check.');
		const bytes = Buffer.from(await response.arrayBuffer());
		if (
			bytes.length > 1024 * 1024 ||
			`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== asset.digest
		)
			throw new Error('Release metadata integrity check failed.');
		const metadata = validateRelease(JSON.parse(bytes), r),
			commit = await request(`/commits/${encodeURIComponent(r.tag_name)}`);
		if (commit.sha !== metadata.commit)
			throw new Error('Release tag does not match its source metadata.');
		return {
			kind: 'release',
			commit: metadata.commit,
			release: metadata.release,
			release_id: r.id,
			metadata_digest: asset.digest,
			metadata,
			url: `https://github.com/${repository}/releases/tag/${encodeURIComponent(r.tag_name)}`,
			notes: (r.body || '').slice(0, 8000),
			available: !config.release || compareVersions(metadata.release, config.release) > 0
		};
	}
	if (config.release)
		return {
			kind: 'release',
			release: config.release,
			available: false,
			url: `https://github.com/${repository}/releases`
		};
	const commit = await request('/commits/main');
	if (!/^[a-f0-9]{40}$/.test(commit.sha || ''))
		throw new Error('GitHub returned an invalid main identity.');
	return {
		kind: 'development',
		commit: commit.sha,
		available: commit.sha !== config.build?.commit,
		url: `https://github.com/${repository}/commit/${commit.sha}`,
		notes: 'Main changed; a changed head is not proof of newer chronology.'
	};
}
async function command(command, args, options = {}) {
	return new Promise((res, rej) =>
		execFile(
			command,
			args,
			{ encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true, ...options },
			(e, out) => (e ? rej(new Error(`Command failed: ${command}. ${e.message}`)) : res(out.trim()))
		)
	);
}
export async function codeFingerprint(root) {
	const hash = createHash('sha256'),
		excluded = new Set([
			'.git',
			'node_modules',
			'build',
			'.svelte-kit',
			'data',
			'extensions',
			'.env',
			'plans'
		]);
	async function walk(path) {
		for (const name of (await fs.readdir(path)).sort()) {
			const p = join(path, name),
				key = relative(root, p).split(sep).join('/');
			if (
				excluded.has(key.split('/')[0]) ||
				key.startsWith('.env.') ||
				key.endsWith('extensions.generated.js')
			)
				continue;
			const stat = await fs.lstat(p);
			if (stat.isSymbolicLink())
				throw new Error(
					'Application source contains a symbolic link. Preserve it and review before updating.'
				);
			if (stat.isDirectory()) await walk(p);
			else if (stat.isFile()) {
				hash.update(key + '\0');
				hash.update(await fs.readFile(p));
			}
		}
	}
	await walk(root);
	return hash.digest('hex');
}
export async function localCodeState(config) {
	if (config.mode === 'source') {
		const dirty = await command('git', ['status', '--porcelain', '--untracked-files=normal'], {
			cwd: config.code_root
		});
		const head = await command('git', ['rev-parse', 'HEAD'], { cwd: config.code_root });
		return { dirty: Boolean(dirty), head, fingerprint: await codeFingerprint(config.code_root) };
	}
	const fingerprint = await codeFingerprint(config.code_root);
	return {
		dirty: Boolean(config.code_fingerprint && config.code_fingerprint !== fingerprint),
		unknown: !config.code_fingerprint,
		fingerprint
	};
}
export async function checkUpdates({ request } = {}) {
	const config = getInstallation(),
		paths = operationPaths();
	await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
	const release = await acquireDirectoryLock(join(paths.root, 'check.lock'), { attempts: 0 });
	if (!release) throw new Error('An update check is already running.');
	try {
		const local = await localCodeState(config),
			target = await selectTarget(config, request);
		if (target.available)
			target.requirements = await candidateMetadata(target.commit, request || github, target);
		const result = {
			format: 'saturday.update-check',
			version: 1,
			id: randomUUID(),
			installation_id: config.installation_id,
			checked_at: new Date().toISOString(),
			installed: config.build,
			installed_release: config.release || null,
			local,
			target
		};
		await atomicJson(paths.check, result);
		return result;
	} catch (e) {
		await atomicJson(paths.check, {
			format: 'saturday.update-check',
			version: 1,
			installation_id: config.installation_id,
			error: e.message,
			checked_at: new Date().toISOString()
		});
		throw e;
	} finally {
		await release();
	}
}
export function ownedRemovalTargets(config, deleteData = false) {
	const root = dirname(config.descriptor_path);
	const runtimeTargets = [];
	for (const entry of [
		{ root: config.runtime_root, node_path: config.node_path, owned: config.runtime_owned },
		...(config.runtime_history || [])
	])
		if (entry.owned) {
			if (
				!entry.root.startsWith(join(root, 'runtime') + sep) ||
				!entry.node_path.startsWith(entry.root + sep) ||
				!/^node-v\d+\.\d+\.\d+-(darwin|linux|win)-(arm64|x64)$/.test(entry.root.split(sep).at(-1))
			)
				throw new Error('Runtime ownership is invalid.');
			runtimeTargets.push(entry.root);
		}
	if (config.mode !== 'managed') {
		if (deleteData)
			throw new Error(
				'Source/custom storage ownership is uncertain. Data deletion is unavailable; retain it and use reviewed manual cleanup.'
			);
		return runtimeTargets;
	}
	if (
		config.code_root !== join(root, 'app') ||
		config.data_root !== join(root, 'data') ||
		config.extension_code !== join(root, 'extensions')
	)
		throw new Error('Custom installation paths must be retained for manual cleanup.');
	const expected = {
		database: join(root, 'data', 'saturday.db'),
		files: join(root, 'data', 'files'),
		files_state: join(root, 'data', 'files.state'),
		database_backups: join(root, 'data', 'backups', 'database'),
		database_restore: join(root, 'data', 'saturday.db.restore'),
		file_backups: join(root, 'data', 'backups', 'files'),
		extension_state: join(root, 'data', 'extensions'),
		extension_backups: join(root, 'data', 'extensions.backups')
	};
	if (deleteData && Object.entries(expected).some(([k, v]) => config[k] !== v))
		throw new Error(
			'External/shared storage is retained; deletion requires reviewed manual cleanup.'
		);
	const targets = [...runtimeTargets];
	if (config.code_owned === true) targets.push(config.code_root);
	if (config.runtime_owned === true) {
		if (
			!config.runtime_root.startsWith(join(root, 'runtime') + sep) ||
			!config.node_path.startsWith(config.runtime_root + sep)
		)
			throw new Error('Runtime ownership is invalid.');
		targets.push(config.runtime_root);
	}
	if (config.pdf_cache === join(root, 'runtime', 'chrome')) targets.push(config.pdf_cache);
	if (deleteData)
		targets.push(
			config.data_root,
			config.extension_code,
			...(config.logs === join(root, 'logs') ? [config.logs] : []),
			...(config.pdf_cache === join(root, 'runtime', 'chrome') ? [config.pdf_cache] : [])
		);
	return [...new Set(targets)];
}
export async function assertSafeRemoval(paths) {
	for (const path of paths) {
		let parent = path;
		while (parent !== dirname(parent)) {
			if (existsSync(parent) && (await fs.lstat(parent)).isSymbolicLink())
				throw new Error('Deletion cannot follow linked parent directories.');
			parent = dirname(parent);
		}
		// fs.rm removes child links themselves without traversing their targets. Never delete a linked root.
		if (existsSync(path) && (await fs.lstat(path)).isSymbolicLink())
			throw new Error('Deletion root is a symlink/junction. Preserve it for manual cleanup.');
	}
}
export async function queueOperation(
	operation,
	{ check_id, confirm = false, delete_data = false, source, retry_pdf = false } = {}
) {
	if (!['update', 'repair', 'uninstall'].includes(operation))
		throw new Error('Choose update, repair or uninstall.');
	if (source && operation !== 'repair')
		throw new Error(
			'Local source snapshots are only accepted for explicit repair, never as a substitute for a checked update.'
		);
	if (operation !== 'repair' && !confirm) throw new Error('Confirm the installation operation.');
	const config = getInstallation(),
		paths = operationPaths();
	await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
	const running = operationStatus();
	if (running && activeStates.includes(running.status) && !running.error) return running;
	const release = await acquireDirectoryLock(paths.lock, { attempts: 20 });
	if (!release) throw new Error('An installation operation is already running.');
	try {
		const previous = operationStatus();
		if (previous && activeStates.includes(previous.status) && !previous.error) return previous;
		if (operation !== 'repair' && existsSync(paths.journal))
			throw new Error('Repair the interrupted publication before another operation.');
		let selected;
		if (operation === 'update') {
			const check = installedCheck();
			if (
				!check?.id ||
				check.id !== check_id ||
				check.error ||
				check.installation_id !== config.installation_id ||
				Date.now() - Date.parse(check.checked_at) > 15 * 60 * 1000
			)
				throw new Error('The update check is stale. Check again.');
			if (!check.target?.available) throw new Error('No checked update is available.');
			if (check.local.dirty)
				throw new Error('Local source changes must be preserved/reviewed before updating.');
			selected = check;
		}
		if (operation === 'uninstall') {
			const targets = ownedRemovalTargets(config, delete_data);
			await assertSafeRemoval(targets);
		}
		const id = randomUUID(),
			worker = join(paths.root, `controller-${id}`);
		await fs.mkdir(worker, { recursive: true, mode: 0o700 });
		await fs.mkdir(join(worker, 'scripts'), { recursive: true });
		await fs.mkdir(join(worker, 'src/lib/server'), { recursive: true });
		await fs.writeFile(join(worker, 'package.json'), '{"type":"module"}');
		const helperRoot = existsSync(config.code_root)
			? config.code_root
			: fileURLToPath(new URL('../../../', import.meta.url));
		for (const file of [
			'scripts/install.mjs',
			'src/lib/server/installation.js',
			'src/lib/server/access-settings.js',
			'src/lib/server/access-network.js',
			'src/lib/server/server-lifecycle.js',
			'src/lib/server/installation-operations.js'
		])
			await fs.copyFile(join(helperRoot, file), join(worker, file));
		let node = existsSync(config.node_path) ? config.node_path : process.execPath;
		if (process.platform === 'win32') {
			node = join(worker, 'node.exe');
			await fs.copyFile(existsSync(config.node_path) ? config.node_path : process.execPath, node);
		}
		const state = {
			format: 'saturday.operation',
			version: 1,
			id,
			installation_id: config.installation_id,
			operation,
			status: 'queued',
			step: 'Preparing operation',
			started_at: new Date().toISOString(),
			config,
			selected,
			delete_data,
			source: source ? resolve(source) : null,
			retry_pdf,
			worker,
			log: join(paths.root, `${id}.log`)
		};
		await atomicJson(paths.status, state);
		const child = spawn(
			node,
			[
				join(worker, 'scripts/install.mjs'),
				'execute',
				'--operation-id',
				id,
				'--installation',
				config.descriptor_path
			],
			{
				cwd: worker,
				env: installationEnvironment(config),
				detached: true,
				windowsHide: true,
				stdio: 'ignore'
			}
		);
		await new Promise((res, rej) => {
			child.once('spawn', res);
			child.once('error', rej);
		});
		child.unref();
		state.pid = child.pid;
		await atomicJson(paths.status, state);
		return operationStatus();
	} finally {
		await release();
	}
}

async function hashFile(path) {
	const { createReadStream } = await import('node:fs');
	const h = createHash('sha256');
	for await (const chunk of createReadStream(path)) h.update(chunk);
	return h.digest('hex');
}
async function stopOwnedServer() {
	let status = serverSummary();
	if (!status.managed) return false;
	await controlServer('stop');
	const deadline = Date.now() + 15000;
	while (serverSummary().managed && Date.now() < deadline) await pause(100);
	if (serverSummary().managed)
		throw new Error('The UI has not stopped. Inspect server logs before retrying.');
	return true;
}
async function copyDatabase(source, target) {
	await fs.mkdir(dirname(target), { recursive: true });
	const { DatabaseSync } = await import('node:sqlite');
	const db = new DatabaseSync(source, { readOnly: true });
	try {
		db.prepare('VACUUM INTO ?').run(target);
	} finally {
		db.close();
	}
}
async function stageExtensions(config, workspace) {
	await fs.mkdir(join(workspace, 'data'), { recursive: true });
	if (existsSync(config.extension_state))
		await fs.cp(config.extension_state, join(workspace, 'data', 'extensions'), {
			recursive: true,
			filter: (p) =>
				!['lock', 'processes', 'staging'].includes(
					relative(config.extension_state, p).split(sep)[0]
				)
		});
	if (existsSync(config.extension_code))
		await fs.cp(config.extension_code, join(workspace, 'extensions'), { recursive: true });
}
function stageEnvironment(config, app, workspace, target) {
	return {
		...installationEnvironment(config),
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_SETUP_STAGING: '1',
		SATURDAY_PROJECT_ROOT: app,
		SATURDAY_DB_PATH: '',
		SATURDAY_FILES_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: join(workspace, 'data', 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(workspace, 'extensions'),
		SATURDAY_BUILD_COMMIT: target?.commit || '',
		SATURDAY_BUILD_ID: target?.local_id || '',
		SATURDAY_BUILD_DIRTY: '',
		PATH: `${dirname(config.node_path)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`
	};
}
async function dataRecovery(config, libraryRoot = config.code_root) {
	const pairs = await import(pathToFileURL(join(libraryRoot, 'src/lib/server/files/pairs.js')));
	const backups = await import(pathToFileURL(join(libraryRoot, 'src/lib/server/backups.js')));
	const files = await import(pathToFileURL(join(libraryRoot, 'src/lib/server/files/backups.js')));
	const extensions = await import(pathToFileURL(join(libraryRoot, 'src/lib/server/extensions.js')));
	let pair;
	try {
		pair = await pairs.createBackupPair({ kind: 'safety' });
	} catch (e) {
		if (e.code !== 'DATASET_MISMATCH') throw e;
		const db = backups.createBackup(),
			file = await files.createFileBackup('safety');
		pair = {
			database_backup_id: db.backup_id,
			file_backup_id: file.backup_id,
			files_sha256: file.sha256
		};
	}
	const database = backups.getBackupFile(pair.database_backup_id),
		archive = await files.getFileBackup(pair.file_backup_id);
	if ((await hashFile(archive.path)) !== pair.files_sha256)
		throw new Error('Recovery file archive failed verification.');
	const ext = [];
	for (const entry of (await extensions.extensionCatalog()).installed)
		if (entry.manifest.database && existsSync(extensions.dataPath(entry.id))) {
			const b = await extensions.createExtensionBackup(entry.id);
			const checked = await extensions.getExtensionBackup(b.backup_id);
			ext.push({ id: entry.id, path: checked.path, sha256: b.sha256 });
		}
	// Retained extension data can outlive its installed package. Preserve those databases too.
	for (const name of await fs.readdir(config.extension_state)) {
		const path = join(config.extension_state, name, 'database.sqlite');
		if (existsSync(path) && !ext.some((e) => e.id === name)) {
			const target = join(operationPaths().root, `retained-extension-${randomUUID()}.sqlite`);
			await copyDatabase(path, target);
			ext.push({ id: name, path: target, sha256: await hashFile(target) });
		}
	}
	return { database: database.path, files: archive.path, extensions: ext };
}
async function assertClientsStopped(config) {
	const dir = join(config.extension_state, 'processes');
	if (!existsSync(dir)) return;
	for (const name of await fs.readdir(dir)) {
		if (!/^\d+\.json$/.test(name)) throw new Error('Unrecognized client lease requires repair.');
		const pid = Number(name.slice(0, -5));
		if (pid !== process.pid && alive(pid))
			throw new Error(
				'Waiting for assistant disconnect. Pause/disconnect all Saturday MCP clients, then retry.'
			);
	}
}
async function assertSourcePublicationSafe(config, candidate) {
	const protectedKeys = [
		config.data_root,
		config.files,
		config.extension_state,
		config.extension_code,
		config.descriptor_path
	];
	const tracked = (await command('git', ['ls-files', '-z'], { cwd: config.code_root }))
		.split('\0')
		.filter(Boolean);
	for (const path of protectedKeys) {
		const key = relative(config.code_root, path).split(sep).join('/');
		if (
			!key.startsWith('../') &&
			!key.startsWith('/') &&
			(tracked.some((p) => p === key || p.startsWith(key + '/')) ||
				existsSync(join(candidate, key)))
		)
			throw new Error('Incoming/source tracked files overlap stored data. Publication stopped.');
	}
}
async function publish(config, app, previous, target, journal, writeJournal) {
	const next = {
		...config,
		...(journal.runtime
			? {
					node_path: journal.runtime.node_path,
					runtime_root: journal.runtime.runtime_root,
					runtime_owned: journal.runtime.runtime_owned,
					runtime_history: journal.runtime.runtime_history
				}
			: {}),
		build: {
			id: target.local_id || (target.commit ? `dev.${target.commit.slice(0, 12)}` : 'development'),
			commit: target.commit || null,
			dirty: target.commit ? false : null
		},
		release: target.kind === 'release' ? target.release : null,
		distribution: target.kind,
		uninstalled: false,
		...(config.data_deleted
			? { initialized: { database: false, files: false, extensions: false } }
			: {})
	};
	if (config.mode === 'managed') {
		if (
			config.code_root !== join(dirname(config.descriptor_path), 'app') ||
			config.code_owned !== true
		)
			throw new Error('Application ownership is uncertain; publication stopped.');
		journal.previous = previous;
		journal.candidate = app;
		journal.next = next;
		journal.phase = 'prepared';
		await writeJournal();
		if (existsSync(config.code_root)) await fs.rename(config.code_root, previous);
		journal.phase = 'old_saved';
		await writeJournal();
		await fs.rename(app, config.code_root);
	} else {
		await assertSourcePublicationSafe(config, app);
		journal.previous = previous;
		journal.candidate = app;
		journal.next = next;
		journal.previous_head = await command('git', ['rev-parse', 'HEAD'], { cwd: config.code_root });
		journal.phase = 'prepared';
		await writeJournal();
		if (!journal.source_repair) {
			await command(
				'git',
				['fetch', '--no-tags', `https://github.com/${repository}.git`, target.commit],
				{ cwd: config.code_root }
			);
			await command('git', ['checkout', '--detach', target.commit], { cwd: config.code_root });
		}
		await fs.mkdir(previous, { recursive: true });
		for (const name of ['build', 'node_modules']) {
			if (existsSync(join(config.code_root, name)))
				await fs.rename(join(config.code_root, name), join(previous, name));
			await fs.rename(join(app, name), join(config.code_root, name));
		}
	}
	journal.phase = 'published';
	await writeJournal();
	await atomicJson(config.descriptor_path, next);
	return next;
}
async function finishPublication(journal, run, writeJournal, retryPdf = false) {
	const config = journal.next;
	Object.assign(process.env, installationEnvironment(config), {
		SATURDAY_BUILD_COMMIT: config.build.commit || '',
		SATURDAY_BUILD_DIRTY: config.build.dirty ? '1' : '',
		SATURDAY_BUILD_ID: config.build.id?.startsWith('local.') ? config.build.id : ''
	});
	journal.phase = 'migrating';
	await writeJournal();
	await run(
		config.node_path,
		[
			join(config.code_root, 'scripts/setup.mjs'),
			'--skip-dependencies',
			'--skip-build',
			...(retryPdf ? [] : ['--skip-pdf'])
		],
		{ cwd: config.code_root, env: process.env }
	);
	const result = JSON.parse(await fs.readFile(config.descriptor_path, 'utf8'));
	result.release = config.release;
	result.distribution = config.distribution;
	result.uninstalled = false;
	result.data_deleted = false;
	result.code_fingerprint = await codeFingerprint(result.code_root);
	await atomicJson(config.descriptor_path, result);
	if (journal.config.node_path !== result.node_path) {
		await refreshLoginStartup(journal.config, result, journal.login?.enabled === true);
		if (journal.config.desktop_shortcut && existsSync(journal.config.desktop_shortcut))
			await createDesktopShortcut();
	}
	journal.phase = 'complete';
	await writeJournal();
	return result;
}
export async function executeOperation(
	id,
	{ downloadSource, copySource, run, resolveTarget = selectTarget }
) {
	const paths = operationPaths();
	const release = await acquireDirectoryLock(paths.lock);
	let state = readJson(paths.status);
	if (!state || state.id !== id || state.installation_id !== getInstallation().installation_id) {
		await release();
		throw new Error('The queued operation no longer matches this installation.');
	}
	let config = state.config,
		admission,
		wasRunning = false,
		published = false,
		journal = readJson(paths.journal),
		buffer = '';
	const update = async (status, step, extra = {}) => {
		Object.assign(state, { status, step, ...extra });
		await atomicJson(paths.status, state);
	};
	const record = (chunk) => {
		buffer = (buffer + String(chunk)).slice(-1024 * 1024);
		fs.writeFile(state.log, buffer, { mode: 0o600 }).catch(() => {});
	};
	// Child setup logs are bounded and retained outside replaceable code.
	const loggingRun = async (cmd, args, options = {}) => {
		const child = spawn(cmd, args, {
			...options,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		for (const stream of [child.stdout, child.stderr]) stream.on('data', record);
		await new Promise((res, rej) => {
			child.once('error', rej);
			child.once('close', (code) =>
				code === 0 ? res() : rej(new Error(`Command failed (${code}). See ${state.log}.`))
			);
		});
	};
	const writeJournal = () => atomicJson(paths.journal, journal);
	let gateway;
	const browserOrigin = readJson(serverPaths().record)?.url;
	process.env.SATURDAY_SERVER_TOKEN ||= readJson(serverPaths().record)?.token || '';
	if (browserOrigin && process.env.SATURDAY_SERVER_TOKEN && !readAccessSettings().password) {
		gateway = createServer((request, response) => {
			const name = accessCookieName('control');
			const cookie = (request.headers.cookie || '')
				.split(';')
				.map((part) => part.trim())
				.find((part) => part.startsWith(name + '='))
				?.slice(name.length + 1);
			if (
				request.method !== 'GET' ||
				request.url !== `/status?id=${id}` ||
				request.headers.origin !== browserOrigin ||
				!validServerSession(cookie)
			) {
				response.writeHead(403);
				response.end();
				return;
			}
			response.writeHead(200, {
				'content-type': 'application/json',
				'cache-control': 'no-store',
				'access-control-allow-origin': browserOrigin,
				'access-control-allow-credentials': 'true',
				vary: 'Origin'
			});
			response.end(JSON.stringify(operationStatus()));
		});
		await new Promise((res, rej) => {
			gateway.once('error', rej);
			gateway.listen(0, '127.0.0.1', res);
		});
		state.poll_url = `http://127.0.0.1:${gateway.address().port}/status?id=${id}`;
		await atomicJson(paths.status, state);
	}
	try {
		validateInstallation(config);
		Object.assign(process.env, installationEnvironment(config));
		if (state.operation === 'repair' && journal) {
			await update('staging', 'Repairing interrupted publication');
			wasRunning = journal.was_running;
			await stopOwnedServer();
			await assertClientsStopped(config);
			admission = await claimInstallationMaintenance({ persistent: true, recover: true });
			process.env.SATURDAY_MAINTENANCE_TOKEN = readJson(serverPaths().maintenance).token;
			if (
				journal.installation_id !== config.installation_id ||
				journal.format !== 'saturday.update-publication' ||
				journal.version !== 1
			)
				throw new Error('Unrecognized update journal. Retain it for reviewed recovery.');
			if (
				!/^[a-f0-9-]{36}$/.test(journal.operation_id || '') ||
				journal.previous !== join(paths.root, `previous-${journal.operation_id}`) ||
				journal.candidate !== join(paths.root, `work-${journal.operation_id}`, 'app') ||
				!['prepared', 'old_saved', 'published', 'migrating', 'complete'].includes(journal.phase)
			)
				throw new Error(
					'Update recovery paths/state are invalid. Preserve recovery for manual review.'
				);
			for (const key of [
				'code_root',
				'data_root',
				'database',
				'files',
				'files_state',
				'database_backups',
				'database_restore',
				'file_backups',
				'extension_state',
				'extension_code',
				'extension_backups',
				'logs'
			])
				if (journal.config[key] !== config[key] || journal.next[key] !== config[key])
					throw new Error('Update recovery cannot relocate storage or change runtime ownership.');
			if (journal.next.node_path !== journal.config.node_path) {
				const runtime = journal.runtime;
				if (
					!runtime?.runtime_owned ||
					!runtime.runtime_root.startsWith(
						join(dirname(config.descriptor_path), 'runtime') + sep
					) ||
					runtime.node_path !== journal.next.node_path ||
					readJson(join(runtime.runtime_root, 'saturday-runtime.json'))?.installation_id !==
						config.installation_id
				)
					throw new Error('Recovery runtime ownership is invalid.');
			}
			for (const path of [journal.candidate, journal.previous, config.code_root])
				if (existsSync(path) && (await fs.lstat(path)).isSymbolicLink())
					throw new Error('Recovery cannot follow a linked code directory.');
			// Finish publication idempotently; never restore old code after migration began.
			if (config.mode === 'managed' && ['prepared', 'old_saved'].includes(journal.phase)) {
				if (!existsSync(config.code_root) && existsSync(journal.candidate))
					await fs.rename(journal.candidate, config.code_root);
				else if (
					journal.phase === 'prepared' &&
					existsSync(journal.candidate) &&
					existsSync(config.code_root)
				) {
					await fs.rename(config.code_root, journal.previous);
					await fs.rename(journal.candidate, config.code_root);
				}
				await atomicJson(config.descriptor_path, journal.next);
			} else if (
				config.mode === 'source' &&
				journal.phase !== 'published' &&
				journal.phase !== 'migrating' &&
				journal.phase !== 'complete'
			)
				throw new Error(
					'Interrupted source publication needs reviewed Git/artifact recovery using the retained previous HEAD and build. Data is retained.'
				);
			config = await finishPublication(journal, loggingRun, writeJournal, state.retry_pdf);
			published = true;
		} else if (state.operation === 'uninstall') {
			const targets = ownedRemovalTargets(config, state.delete_data);
			await assertSafeRemoval(targets);
			wasRunning = await stopOwnedServer();
			await assertClientsStopped(config);
			admission = await claimInstallationMaintenance({ persistent: true });
			process.env.SATURDAY_MAINTENANCE_TOKEN = readJson(serverPaths().maintenance).token;
			await update('removing', 'Removing owned application and integrations');
			const issues = [];
			try {
				await setLoginStartup(false);
			} catch (e) {
				issues.push(e.message);
			}
			try {
				await removeDesktopShortcut();
			} catch (e) {
				issues.push(e.message);
			}
			// A failed startup removal must not leave a registration pointing at deleted code.
			if (issues.length)
				throw new Error(
					`Integration cleanup incomplete: ${issues.join(' ')}. Owned code/data retained; retry repair/removal.`
				);
			if (state.delete_data) {
				for (const name of await fs.readdir(paths.root)) {
					if (
						/^(work|previous)-[a-f0-9-]{36}$/.test(name) ||
						/^retained-extension-[a-f0-9-]{36}\.sqlite$/.test(name)
					)
						targets.push(join(paths.root, name));
				}
			}
			config.uninstalled = true;
			config.uninstall = {
				status: 'removing',
				delete_data: state.delete_data,
				targets,
				removed: []
			};
			await atomicJson(config.descriptor_path, config);
			for (const path of targets) {
				await assertSafeRemoval([path]);
				await fs.rm(path, { recursive: true, force: true });
				config.uninstall.removed.push(path);
				await atomicJson(config.descriptor_path, config);
			}
			config.uninstalled = true;
			config.data_deleted = state.delete_data;
			config.uninstall.status = 'complete';
			await atomicJson(config.descriptor_path, config);
			await update(
				'complete',
				state.delete_data
					? 'Saturday and owned data removed'
					: 'Saturday removed; data and backups retained',
				{
					completed_at: new Date().toISOString(),
					retained_paths: state.delete_data ? [] : [config.data_root, config.extension_code],
					reconnect_required: true
				}
			);
			return;
		} else {
			if (state.operation === 'repair' && config.mode === 'source')
				state.source ||= config.code_root;
			const selected = state.selected;
			let target = selected?.target;
			if (state.operation === 'update') {
				const current = await localCodeState(config);
				if (current.dirty || current.fingerprint !== selected.local.fingerprint)
					throw new Error('Installed source changed after the check. Preserve it and check again.');
				const fresh = await resolveTarget(config);
				if (
					fresh.commit !== target.commit ||
					fresh.release !== target.release ||
					fresh.metadata_digest !== target.metadata_digest
				)
					throw new Error(
						'The update check changed upstream. Check again; no substitute was installed.'
					);
			} else if (state.source) target = { kind: 'development', commit: null, local_source: true };
			else if (config.build?.commit)
				target = {
					kind: config.release ? 'release' : 'development',
					release: config.release,
					commit: config.build.commit
				};
			else
				throw new Error(
					'Repair needs --source for a build with unknown source identity. No data was reset.'
				);
			await update('staging', 'Downloading and building the checked candidate', { target });
			const work = join(paths.root, `work-${id}`);
			await fs.mkdir(work, { recursive: true });
			const app = join(work, 'app'),
				workspace = join(work, 'workspace');
			const source = state.source
				? { source: state.source }
				: await downloadSource(work, target.commit);
			await copySource(source.source, app);
			if (target.local_source)
				target.local_id = `local.${(await codeFingerprint(app)).slice(0, 12)}`;
			await stageExtensions(config, workspace);
			const pkg = JSON.parse(await fs.readFile(join(app, 'package.json'), 'utf8'));
			validateDistribution(pkg.saturday);
			if (readAccessSettings().allow_lan && pkg.saturday.lan_api !== 1)
				throw new Error(
					'This candidate does not support saved LAN preferences. Disable LAN and restart before changing to this build.'
				);
			if (readAccessSettings().password && pkg.saturday.access_api !== 1)
				throw new Error(
					'This candidate does not support password login. Keep the current build or explicitly disable password login before changing to an older build.'
				);
			if (
				pkg.name !== 'saturday' ||
				pkg.engines?.node !== `>=${pkg.saturday.node_minimum}` ||
				(target.kind === 'release' && pkg.version !== target.release)
			)
				throw new Error(
					'Candidate package/version/runtime metadata differs from the checked build.'
				);
			if (pkg.saturday?.installation_api !== 1)
				throw new Error(
					'This candidate does not support the installed maintenance/update contract. Keep the current app and choose a compatible build.'
				);
			const runtime = await prepareRuntime(config, pkg.saturday);
			const npm = [
				join(dirname(runtime.node_path), 'node_modules/npm/bin/npm-cli.js'),
				join(dirname(runtime.node_path), '../lib/node_modules/npm/bin/npm-cli.js')
			].find(existsSync);
			if (!npm)
				throw new Error(
					'The installed runtime has no npm toolchain. Repair the runtime before updating.'
				);
			const env = stageEnvironment(runtime, app, workspace, target);
			await loggingRun(runtime.node_path, [npm, 'ci'], {
				cwd: app,
				env: { ...env, PUPPETEER_SKIP_DOWNLOAD: 'true' }
			});
			await loggingRun(runtime.node_path, [npm, 'run', 'build'], { cwd: app, env });
			if (
				state.operation === 'update' &&
				(await localCodeState(config)).fingerprint !== selected.local.fingerprint
			)
				throw new Error('Source changed while staging; publication stopped.');
			await update('waiting_for_disconnect', 'Stopping UI; waiting for assistant disconnect');
			wasRunning = await stopOwnedServer();
			await assertClientsStopped(config);
			admission = await claimInstallationMaintenance({ persistent: true });
			process.env.SATURDAY_MAINTENANCE_TOKEN = readJson(serverPaths().maintenance).token;
			await assertClientsStopped(config);
			await update('backing_up', 'Capturing verified database, files and extension recovery');
			state.recovery = config.data_deleted
				? null
				: await dataRecovery(config, existsSync(config.code_root) ? config.code_root : app);
			await atomicJson(paths.status, state);
			// Validate migrations/manifest upgrades on post-quiescence copies before touching live storage.
			if (!config.data_deleted) {
				await copyDatabase(config.database, join(workspace, 'data', 'saturday.db'));
				await fs.cp(config.files, join(workspace, 'data', 'files'), { recursive: true });
			}
			const validationEnv = {
				...env,
				SATURDAY_MAINTENANCE_TOKEN: process.env.SATURDAY_MAINTENANCE_TOKEN,
				SATURDAY_EXTENSION_STATE_PATH: '',
				SATURDAY_EXTENSIONS_PATH: ''
			};
			await loggingRun(
				runtime.node_path,
				[
					join(app, 'scripts/setup.mjs'),
					'--managed',
					'--root',
					workspace,
					'--skip-dependencies',
					'--skip-build',
					'--skip-pdf'
				],
				{ cwd: app, env: validationEnv }
			);
			await assertClientsStopped(config);
			await update('publishing', 'Publishing verified code with retained previous build');
			const login = await loginStartupStatus();
			if (runtime.node_path !== config.node_path && !login.available)
				throw new Error('Review the unavailable login registration before switching runtime.');
			journal = {
				format: 'saturday.update-publication',
				version: 1,
				installation_id: config.installation_id,
				operation_id: id,
				was_running: wasRunning,
				runtime,
				login,
				source_repair: state.operation === 'repair' && config.mode === 'source',
				config,
				recovery: state.recovery
			};
			const previous = join(paths.root, `previous-${id}`);
			config = await publish(config, app, previous, target, journal, writeJournal);
			published = true;
			await update('migrating', 'Preparing compatible live storage');
			config = await finishPublication(journal, loggingRun, writeJournal, state.retry_pdf);
		}
		state.configuration_changed = journal?.config?.node_path !== config.node_path;
		if (admission) {
			await admission();
			admission = null;
		}
		delete process.env.SATURDAY_MAINTENANCE_TOKEN;
		await fs.rm(paths.journal, { force: true });
		const work = join(paths.root, `work-${state.id}`);
		try {
			await fs.rm(work, { recursive: true, force: true });
		} catch (e) {
			state.warning = `Completed; staging cleanup needs attention: ${e.message}`;
		}
		if (wasRunning) {
			await update('restarting', 'Restarting and verifying the installed build');
			const result = await startServer();
			state.url = result.url;
		}
		await update(
			'complete',
			'Installation ready; reconnect your assistant to load the new MCP code',
			{ completed_at: new Date().toISOString(), reconnect_required: true }
		);
	} catch (e) {
		record(`${e.message}\n`);
		const recoveryRequired = existsSync(paths.journal);
		await update(
			recoveryRequired
				? 'recovery_required'
				: /Waiting for assistant disconnect/.test(e.message)
					? 'waiting_for_disconnect'
					: 'failed',
			e.message,
			{ error: e.message, completed_at: new Date().toISOString(), recovery: state.recovery }
		);
		// Before publication, the existing compatible app can resume. Afterwards, keep maintenance persistent for explicit repair.
		if (!recoveryRequired) {
			if (admission) {
				await admission();
				admission = null;
			}
			delete process.env.SATURDAY_MAINTENANCE_TOKEN;
			if (wasRunning)
				try {
					await startServer();
				} catch {}
		}
	} finally {
		if (admission && state.status === 'complete') {
			await admission();
			delete process.env.SATURDAY_MAINTENANCE_TOKEN;
		}
		await release();
		if (gateway) {
			const timer = setTimeout(() => gateway.close(), 15000);
			timer.unref();
		}
		// Controller files are disposable; operation state/recovery/logs remain outside app/runtime.
	}
}
