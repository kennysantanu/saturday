export const installationApiVersion = 1;

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
	if (
		value.pdf_cache !== undefined &&
		(typeof value.pdf_cache !== 'string' ||
			!isAbsolute(value.pdf_cache) ||
			resolve(value.pdf_cache) !== value.pdf_cache)
	)
		throw new Error('PDF cache must be an absolute resolved path.');
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
	const maintenancePath = join(value.data_root, 'server.state', 'maintenance.json');
	let authorizedMaintenance = false;
	if (process.env.SATURDAY_MAINTENANCE_TOKEN && existsSync(maintenancePath)) {
		const flag = JSON.parse(readFileSync(maintenancePath, 'utf8'));
		authorizedMaintenance =
			flag.installation_id === value.installation_id &&
			flag.token === process.env.SATURDAY_MAINTENANCE_TOKEN;
	}
	if (value.uninstalled && !authorizedMaintenance)
		throw new Error('Saturday is uninstalled. Reinstall or repair it before using the workspace.');
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
		SATURDAY_EXTENSIONS_PATH: value.extension_code,
		...(value.pdf_cache ? { PUPPETEER_CACHE_DIR: value.pdf_cache } : {})
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

// Platform launchers use fixed operations and a descriptor, never caller-provided shell code.
const shellQuote = (s) => "'" + String(s).replaceAll("'", "'\\''") + "'";
const xml = (s) =>
	String(s)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
const windowsArg = (s) =>
	'"' +
	String(s)
		.replace(/(\\*)"/g, '$1$1\\"')
		.replace(/(\\+)$/g, '$1$1') +
	'"';
const desktopArg = (s) =>
	'"' +
	String(s)
		.replaceAll('\\', '\\\\')
		.replaceAll('"', '\\"')
		.replaceAll('`', '\\`')
		.replaceAll('$', '\\$')
		.replaceAll('%', '%%') +
	'"';
export function launcherArtifacts(
	value,
	{ platform = process.platform, home = homedir(), env = process.env, desktop } = {}
) {
	if (!value.descriptor_path)
		throw new Error('Run setup first to prepare an installation descriptor.');
	for (const path of [value.node_path, value.code_root, value.descriptor_path, home, desktop || ''])
		if (/[\r\n\0]/.test(path)) throw new Error('Launcher paths cannot contain line breaks.');
	const platformPath = platform === 'win32' ? win32 : posix;
	const id = value.installation_id,
		short = id.slice(0, 8),
		label = `app.saturday.${id}`;
	const script = platformPath.join(value.code_root, 'scripts', 'start.mjs');
	const args = (operation) => [
		script,
		...(operation === 'open' ? ['open'] : ['--background']),
		'--installation',
		value.descriptor_path
	];
	const marker = `Saturday installation ${id}`;
	const configHome =
		env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
			? env.XDG_CONFIG_HOME
			: platformPath.join(home, '.config');
	const desktopRoot = desktop || platformPath.join(home, 'Desktop');
	const shell = `#!/bin/sh\n# ${marker}\nexec ${shellQuote(value.node_path)} ${args('open').map(shellQuote).join(' ')}\n`;
	const loginArgs = [value.node_path, ...args('login')];
	const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${loginArgs.map((a) => `<string>${xml(a)}</string>`).join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><false/><key>AbandonProcessGroup</key><true/><key>StandardOutPath</key><string>${xml(platformPath.join(value.logs, 'login.log'))}</string><key>StandardErrorPath</key><string>${xml(platformPath.join(value.logs, 'login.log'))}</string></dict></plist>\n`;
	const desktopFile = (operation) =>
		`[Desktop Entry]\n# ${marker}\nType=Application\nName=Open Saturday\nComment=Open your local career dashboard\nExec=${[value.node_path, ...args(operation)].map(desktopArg).join(' ').replaceAll('\\', '\\\\')}\nTerminal=false\nCategories=Office;\n`;
	return {
		marker,
		label,
		args,
		shell,
		desktop:
			platform === 'darwin'
				? platformPath.join(desktopRoot, `Open Saturday ${short}.app`)
				: platform === 'win32'
					? `Open Saturday ${short}.lnk`
					: platformPath.join(desktopRoot, `saturday-${id}.desktop`),
		login:
			platform === 'darwin'
				? platformPath.join(home, 'Library', 'LaunchAgents', `${label}.plist`)
				: platform === 'win32'
					? `Saturday ${id}.lnk`
					: platformPath.join(configHome, 'autostart', `saturday-${id}.desktop`),
		loginContent: platform === 'darwin' ? plist : desktopFile('login'),
		desktopContent: desktopFile('open')
	};
}
async function native(command, args, encoding = 'utf8') {
	const { execFile } = await import('node:child_process');
	return new Promise((res, rej) =>
		execFile(command, args, { encoding, windowsHide: true, timeout: 15000 }, (e, stdout) =>
			e
				? rej(
						new Error(
							`OS integration failed (${command}). Check permissions/policy; use the CLI fallback.`
						)
					)
				: res(stdout.trim())
		)
	);
}
async function ownedText(path, content, marker, mode = 0o600) {
	await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
	if (existsSync(path)) {
		const stat = await fs.lstat(path);
		if (
			!stat.isFile() ||
			stat.isSymbolicLink() ||
			!(await fs.readFile(path, 'utf8')).includes(marker)
		)
			throw new Error('A launcher path is occupied by an unowned file. It was preserved.');
	}
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(
			temp,
			path.endsWith('.js')
				? content.replace(
						/[^\x00-\x7F]/g,
						(c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
					)
				: content,
			{ flag: 'wx', mode }
		);
		await fs.rename(temp, path);
	} finally {
		await fs.rm(temp, { force: true });
	}
}
async function linuxDesktop(home) {
	try {
		const path = await native('xdg-user-dir', ['DESKTOP']);
		if (isAbsolute(path) && path !== home) return path;
	} catch {}
	throw new Error('Desktop folder could not be resolved with xdg-user-dir. Use the CLI fallback.');
}
async function windowsShortcut(value, artifact, action, folder) {
	const state = join(value.data_root, 'server.state');
	await fs.mkdir(state, { recursive: true, mode: 0o700 });
	const release = await acquireDirectoryLock(join(state, 'shortcut.lock'));
	try {
		const launcher = join(state, folder === 'Desktop' ? 'open-saturday.js' : 'login-saturday.js');
		const command = [value.node_path, ...artifact.args(folder === 'Desktop' ? 'open' : 'login')]
			.map(windowsArg)
			.join(' ');
		await ownedText(
			launcher,
			`// ${artifact.marker}\nvar shell = new ActiveXObject("WScript.Shell");\nvar code = shell.Run(${JSON.stringify(command)}, 0, true);\nif (code !== 0) WScript.Echo("Saturday could not start. Check the server log or reopen from Command Prompt.");\n`,
			artifact.marker
		);
		const helper = join(state, 'shortcut-helper.js');
		const helperContent = `// ${artifact.marker}\nvar a=WScript.Arguments, s=new ActiveXObject("WScript.Shell"), f=new ActiveXObject("Scripting.FileSystemObject");\nvar p=s.SpecialFolders(a(1))+"\\\\"+a(2), target=s.ExpandEnvironmentStrings("%SystemRoot%\\\\System32\\\\wscript.exe"), args=${JSON.stringify(windowsArg(launcher))};\nif(f.FileExists(p)){var old=s.CreateShortcut(p);if(old.Description!==a(3)||old.TargetPath.toLowerCase()!==target.toLowerCase()||old.Arguments!==args){WScript.Echo("foreign");WScript.Quit(0);}}\nif(a(0)==="read"){WScript.Echo(f.FileExists(p)?"enabled":"disabled");}\nelse if(a(0)==="remove"){if(f.FileExists(p))f.DeleteFile(p);WScript.Echo("disabled");}\nelse {var l=s.CreateShortcut(p);l.TargetPath=target;l.Arguments=args;l.Description=a(3);l.WorkingDirectory=${JSON.stringify(value.code_root)};l.Save();WScript.Echo(p);}\n`;
		await ownedText(helper, helperContent, artifact.marker);
		const result = await native(
			'cscript.exe',
			[
				'//Nologo',
				'//U',
				helper,
				action,
				folder,
				folder === 'Desktop' ? artifact.desktop : artifact.login,
				artifact.marker
			],
			'utf16le'
		);
		if (result === 'foreign')
			throw new Error('An unrelated shortcut occupies the path and was preserved.');
		return result;
	} finally {
		await release();
	}
}
export async function createDesktopShortcut({ desktop } = {}) {
	const value = getInstallation();
	const artifact = launcherArtifacts(value, {
		...(desktop || value.desktop_shortcut
			? { desktop: desktop ? resolve(desktop) : dirname(value.desktop_shortcut) }
			: process.platform === 'linux'
				? { desktop: await linuxDesktop(homedir()) }
				: {})
	});
	let shortcut = artifact.desktop;
	if (process.platform === 'darwin') {
		for (const path of [
			artifact.desktop,
			join(artifact.desktop, 'Contents'),
			join(artifact.desktop, 'Contents', 'MacOS')
		]) {
			if (
				existsSync(path) &&
				((await fs.lstat(path)).isSymbolicLink() || !(await fs.lstat(path)).isDirectory())
			)
				throw new Error('Unsafe desktop application path. Existing files were preserved.');
		}
		if (
			existsSync(artifact.desktop) &&
			!(
				await fs.readFile(join(artifact.desktop, 'Contents', 'MacOS', 'open-saturday'), 'utf8')
			).includes(artifact.marker)
		)
			throw new Error('An unrelated application occupies the desktop path.');
		await ownedText(
			join(artifact.desktop, 'Contents', 'MacOS', 'open-saturday'),
			artifact.shell,
			artifact.marker,
			0o700
		);
		const plist = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${artifact.label}</string><key>CFBundleName</key><string>Open Saturday</string><key>CFBundleExecutable</key><string>open-saturday</string><key>CFBundlePackageType</key><string>APPL</string><key>SaturdayOwner</key><string>${artifact.marker}</string></dict></plist>`;
		await ownedText(join(artifact.desktop, 'Contents', 'Info.plist'), plist, artifact.marker);
	} else if (process.platform === 'win32')
		shortcut = await windowsShortcut(value, artifact, 'create', 'Desktop');
	else if (process.platform === 'linux')
		await ownedText(artifact.desktop, artifact.desktopContent, artifact.marker, 0o700);
	else throw new Error('Desktop integration is unavailable on this OS.');
	await atomicJson(value.descriptor_path, { ...value, desktop_shortcut: shortcut });
	return shortcut;
}
export async function loginStartupStatus() {
	const value = getInstallation();
	if (!value.descriptor_path)
		return {
			available: false,
			enabled: false,
			error: 'Run npm run setup before enabling login startup.'
		};
	const artifact = launcherArtifacts(value);
	if (!['darwin', 'win32', 'linux'].includes(process.platform))
		return { available: false, enabled: false, error: 'Login startup is unavailable on this OS.' };
	try {
		if (process.platform === 'win32')
			return {
				available: true,
				enabled: (await windowsShortcut(value, artifact, 'read', 'Startup')) === 'enabled'
			};
		if (!existsSync(artifact.login)) return { available: true, enabled: false };
		const stat = await fs.lstat(artifact.login);
		if (
			!stat.isFile() ||
			stat.isSymbolicLink() ||
			(await fs.readFile(artifact.login, 'utf8')) !== artifact.loginContent
		)
			throw new Error(
				'Login registration differs from this installation. Repair it before changing startup.'
			);
		if (process.platform === 'darwin') {
			const disabled = await native('launchctl', ['print-disabled', `gui/${process.getuid()}`]);
			if (disabled.includes(`\"${artifact.label}\" => true`))
				throw new Error(
					'This login registration is disabled by macOS. Review its launchctl override before changing startup.'
				);
		}
		return { available: true, enabled: true };
	} catch (e) {
		return { available: false, enabled: false, error: e.message };
	}
}
export async function setLoginStartup(enabled) {
	if (typeof enabled !== 'boolean') throw new Error('Choose whether to start at login.');
	const { withServerActivity } = await import('./server-lifecycle.js');
	return withServerActivity(async () => {
		const value = getInstallation(),
			artifact = launcherArtifacts(value);
		const release = await acquireDirectoryLock(`${value.descriptor_path}.lock`, { attempts: 0 });
		if (!release) throw new Error('Setup is running. Retry after it finishes.');
		try {
			const before = await loginStartupStatus();
			if (!before.available) throw new Error(before.error);
			if (before.enabled === enabled) return before;
			if (process.platform === 'win32')
				await windowsShortcut(value, artifact, enabled ? 'create' : 'remove', 'Startup');
			else if (enabled) {
				await fs.mkdir(value.logs, { recursive: true, mode: 0o700 });
				await ownedText(
					artifact.login,
					artifact.loginContent,
					process.platform === 'darwin' ? artifact.label : artifact.marker
				);
				// RunAtLoad only; KeepAlive is false. The short launch command exits and never respawns after Stop.
				if (process.platform === 'darwin') {
					try {
						await native('launchctl', ['bootstrap', `gui/${process.getuid()}`, artifact.login]);
					} catch (e) {
						await fs.rm(artifact.login, { force: true });
						throw e;
					}
				}
			} else {
				if (process.platform === 'darwin') {
					try {
						await native('launchctl', ['bootout', `gui/${process.getuid()}/${artifact.label}`]);
					} catch {
						/* An unloaded registration can still be removed for next login. */
					}
				}
				await fs.rm(artifact.login);
			}
			return loginStartupStatus();
		} finally {
			await release();
		}
	});
}

export async function removeDesktopShortcut() {
	const value = getInstallation();
	const artifact = launcherArtifacts(value, {
		...(value.desktop_shortcut
			? { desktop: dirname(value.desktop_shortcut) }
			: process.platform === 'linux'
				? { desktop: await linuxDesktop(homedir()) }
				: {})
	});
	if (process.platform === 'win32') return windowsShortcut(value, artifact, 'remove', 'Desktop');
	if (!existsSync(artifact.desktop)) return;
	if ((await fs.lstat(artifact.desktop)).isSymbolicLink())
		throw new Error('The shortcut path is linked; it was retained.');
	const owned =
		process.platform === 'darwin'
			? join(artifact.desktop, 'Contents', 'MacOS', 'open-saturday')
			: artifact.desktop;
	if (!(await fs.readFile(owned, 'utf8')).includes(artifact.marker))
		throw new Error('An unowned desktop item was retained.');
	await fs.rm(artifact.desktop, { recursive: true });
}

export async function refreshLoginStartup(previous, next, enabled) {
	if (!enabled) return;
	const before = launcherArtifacts(previous),
		after = launcherArtifacts(next);
	if (process.platform === 'win32') {
		await windowsShortcut(next, after, 'create', 'Startup');
		return;
	}
	if (!existsSync(before.login))
		throw new Error('Login registration changed during update. Review startup before repair.');
	const content = await fs.readFile(before.login, 'utf8');
	if (content === after.loginContent) return;
	if (content !== before.loginContent)
		throw new Error('An unrecognized login registration was retained.');
	await ownedText(
		after.login,
		after.loginContent,
		process.platform === 'darwin' ? after.label : after.marker
	);
	// The updated file is loaded at the next sign-in. Do not run a login job now or revive a stopped UI.
}
