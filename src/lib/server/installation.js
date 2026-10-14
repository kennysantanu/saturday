// Installation identity and paths shared by scripts, web, CLI and MCP. No store initialization on read.
import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, dirname, join, sep, basename, win32, posix, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

export function defaultInstallationRoot(
	platform = process.platform,
	env = process.env,
	home = homedir()
) {
	if (platform === 'win32') {
		if (!env.LOCALAPPDATA || !win32.isAbsolute(env.LOCALAPPDATA))
			throw new Error('LOCALAPPDATA must identify an absolute per-user directory.');
		return win32.join(env.LOCALAPPDATA, 'Saturday');
	}
	if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', 'Saturday');
	if (platform === 'linux')
		return posix.join(
			env.XDG_DATA_HOME && posix.isAbsolute(env.XDG_DATA_HOME)
				? env.XDG_DATA_HOME
				: posix.join(home, '.local', 'share'),
			'saturday'
		);
	throw new Error('Saturday installation supports macOS, Windows and Linux.');
}
export function sourceProjectRoot() {
	if (process.env.SATURDAY_PROJECT_ROOT) return resolve(process.env.SATURDAY_PROJECT_ROOT);
	const entry = process.argv[1] ? resolve(process.argv[1]) : '';
	if (entry.endsWith(`${sep}build${sep}mcp${sep}index.js`)) return resolve(dirname(entry), '../..');
	if (entry.endsWith(`${sep}build${sep}index.js`)) return resolve(dirname(entry), '..');
	return resolve(fileURLToPath(new URL('../../../', import.meta.url)));
}
export function descriptorPath() {
	if (process.env.SATURDAY_INSTALLATION_PATH)
		return resolve(process.env.SATURDAY_INSTALLATION_PATH);
	if (process.env.SATURDAY_SETUP_STAGING === '1') return null;
	const root = sourceProjectRoot();
	if (
		!process.env.SATURDAY_DB_PATH &&
		basename(root) === 'app' &&
		existsSync(join(dirname(root), 'installation.json'))
	)
		return join(dirname(root), 'installation.json');
	const data = process.env.SATURDAY_DB_PATH
		? dirname(resolve(root, process.env.SATURDAY_DB_PATH))
		: join(root, 'data');
	const path = join(data, 'installation.json');
	return existsSync(path) ? path : null;
}
export function sourceInstallation() {
	const code = sourceProjectRoot(),
		database = resolve(code, process.env.SATURDAY_DB_PATH || 'data/saturday.db');
	const files = resolve(code, process.env.SATURDAY_FILES_PATH || 'data/files');
	const state = resolve(
		process.env.SATURDAY_EXTENSION_STATE_PATH || join(dirname(database), 'extensions')
	);
	return {
		format: 'saturday.installation',
		version: 1,
		installation_id: `source.${createHash('sha256')
			.update(JSON.stringify([code, database, files, state]))
			.digest('hex')
			.slice(0, 24)}`,
		mode: 'source',
		code_root: code,
		node_path: process.execPath,
		runtime_root: dirname(process.execPath),
		runtime_owned: false,
		code_owned: false,
		data_root: dirname(database),
		database,
		files,
		files_state: `${files}.state`,
		database_backups: join(dirname(database), 'backups', 'database'),
		database_restore: `${database}.restore`,
		file_backups: join(dirname(files), 'backups', 'files'),
		extension_state: state,
		extension_code: resolve(process.env.SATURDAY_EXTENSIONS_PATH || join(code, 'extensions')),
		extension_backups: `${state}.backups`,
		logs: join(dirname(database), 'logs'),
		port: 3000,
		initialized: { database: false, files: false },
		setup: {}
	};
}
const pathKeys = [
	'code_root',
	'node_path',
	'runtime_root',
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
];
export function validateInstallation(value) {
	if (
		value?.format !== 'saturday.installation' ||
		value.version !== 1 ||
		!['source', 'managed'].includes(value.mode) ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
			value.installation_id ?? ''
		) ||
		!Number.isInteger(value.port) ||
		value.port < 1 ||
		value.port > 65535 ||
		!value.initialized ||
		typeof value.initialized.database !== 'boolean' ||
		typeof value.initialized.files !== 'boolean' ||
		!value.setup ||
		typeof value.setup !== 'object' ||
		Array.isArray(value.setup)
	)
		throw new Error(
			'Unsupported or invalid installation descriptor. Repair setup without resetting data.'
		);
	for (const key of pathKeys)
		if (
			typeof value[key] !== 'string' ||
			!isAbsolute(value[key]) ||
			resolve(value[key]) !== value[key]
		)
			throw new Error(`Installation ${key} must be an absolute resolved path.`);
	return value;
}
export function getInstallation() {
	const path = descriptorPath();
	if (!path) return sourceInstallation();
	const st = lstatSync(path);
	if (st.isSymbolicLink() || !st.isFile())
		throw new Error('Installation descriptor must be a regular file.');
	const value = validateInstallation(JSON.parse(readFileSync(path, 'utf8')));
	for (const [env, key] of [
		['SATURDAY_DB_PATH', 'database'],
		['SATURDAY_FILES_PATH', 'files'],
		['SATURDAY_EXTENSION_STATE_PATH', 'extension_state'],
		['SATURDAY_EXTENSIONS_PATH', 'extension_code'],
		['SATURDAY_PROJECT_ROOT', 'code_root']
	]) {
		if (process.env[env] && resolve(value.code_root, process.env[env]) !== value[key])
			throw new Error(
				`${env} conflicts with this installation. Use its descriptor or a separate workspace.`
			);
	}
	return { ...value, descriptor_path: path };
}
export function assertInstallationStorage({ allowFileRecovery = false } = {}) {
	const value = getInstallation();
	if (!value.descriptor_path) return;
	for (const [key, path] of [
		['database', value.database],
		['files', join(value.files, 'manifest.json')],
		['extensions', join(value.extension_state, 'catalog.json')]
	]) {
		if (value.initialized[key] && !(key === 'files' && allowFileRecovery)) {
			try {
				const stat = lstatSync(path);
				if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular file');
			} catch {
				throw new Error(
					`Expected ${key} storage is missing or inaccessible. Restore or repair it; Saturday will not create a replacement workspace.`
				);
			}
		}
	}
}
export function installationEnvironment(value = getInstallation()) {
	return {
		...process.env,
		SATURDAY_INSTALLATION_PATH: value.descriptor_path || '',
		SATURDAY_PROJECT_ROOT: value.code_root,
		SATURDAY_DB_PATH: value.database,
		SATURDAY_FILES_PATH: value.files,
		SATURDAY_EXTENSION_STATE_PATH: value.extension_state,
		SATURDAY_EXTENSIONS_PATH: value.extension_code
	};
}

export async function syncDirectory(path) {
	let handle;
	try {
		handle = await fs.open(path, 'r');
		await handle.sync();
	} catch (e) {
		if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EISDIR', 'ENOTSUP'].includes(e.code))
			throw e;
	} finally {
		await handle?.close();
	}
}
export async function atomicJson(path, value) {
	await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		const h = await fs.open(temp, 'wx', 0o600);
		try {
			await h.writeFile(JSON.stringify(value, null, 2));
			await h.sync();
		} finally {
			await h.close();
		}
		await fs.rename(temp, path);
		await syncDirectory(dirname(path));
	} catch (error) {
		await fs.rm(temp, { force: true });
		throw error;
	}
}

// Unique owner filenames prevent two stale-lock reclaimers from deleting a new owner.
export async function acquireDirectoryLock(lock, { attempts = 100 } = {}) {
	const owner = `${process.pid}-${randomUUID()}.owner`;
	for (let attempt = 0; ; attempt++) {
		try {
			await fs.mkdir(lock);
			await fs.writeFile(join(lock, owner), '', { flag: 'wx' });
			return async () => {
				await fs.unlink(join(lock, owner));
				await fs.rmdir(lock);
			};
		} catch (e) {
			if (e.code === 'ENOENT') continue;
			if (e.code !== 'EEXIST') throw e;
			let names;
			try {
				names = await fs.readdir(lock);
			} catch (e) {
				if (e.code === 'ENOENT') continue;
				throw e;
			}
			let reclaimed = false;
			for (const name of names) {
				const match = /^(\d+)-[a-f0-9-]+\.owner$/.exec(name);
				if (!match) continue;
				try {
					process.kill(Number(match[1]), 0);
				} catch (e) {
					if (e.code !== 'ESRCH') continue;
					try {
						await fs.unlink(join(lock, name));
						await fs.rmdir(lock);
						reclaimed = true;
					} catch (e) {
						if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;
					}
				}
			}
			// A process can die between mkdir and publishing its owner file.
			if (!names.length) {
				try {
					if (Date.now() - (await fs.stat(lock)).mtimeMs > 30000) {
						await fs.rmdir(lock);
						reclaimed = true;
					}
				} catch (e) {
					if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(e.code)) throw e;
				}
			}
			if (reclaimed) continue;
			if (attempt >= attempts) {
				if (!attempts) return null;
				throw Object.assign(
					new Error('Storage is busy. Try again after the current operation completes.'),
					{ code: 'BUSY' }
				);
			}
			await new Promise((r) => setTimeout(r, 50));
		}
	}
}
