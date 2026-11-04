import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { runInNewContext } from 'node:vm';
import { defaultInstallationRoot as bootstrapRoot, install } from '../scripts/install.mjs';
import {
	defaultInstallationRoot,
	sourceInstallation,
	createDesktopShortcut,
	removeDesktopShortcut,
	loginStartupStatus
} from '../src/lib/server/installation.js';

const windowsEnv = {
	USERPROFILE: 'C:\\Users\\Example ü',
	LOCALAPPDATA: 'C:\\Users\\Example ü\\AppData\\Local'
};
const current = win32.join(windowsEnv.USERPROFILE, 'Saturday');
const previous = win32.join(windowsEnv.LOCALAPPDATA, 'Saturday');

for (const root of [defaultInstallationRoot, bootstrapRoot]) {
	test(`${root === bootstrapRoot ? 'bootstrap' : 'setup'} uses a stable Windows root and preserves existing workspaces`, () => {
		const select = (paths = [], env = windowsEnv) =>
			root('win32', env, windowsEnv.USERPROFILE, (path) => paths.includes(path));
		assert.equal(select(), current);
		// Failed downloads/builds with only runtime/logs do not select the virtualized root.
		assert.equal(select([win32.join(previous, 'runtime'), win32.join(previous, 'logs')]), current);
		for (const name of ['installation.json', 'data', 'app', 'install-publication.json']) {
			assert.equal(select([win32.join(previous, name)]), previous);
			assert.equal(select([win32.join(current, name)]), current);
			assert.equal(
				select([win32.join(current, name), win32.join(previous, 'installation.json')]),
				current
			);
		}
		assert.equal(select([], { USERPROFILE: windowsEnv.USERPROFILE }), current);
		for (const USERPROFILE of ['', 'relative'])
			assert.throws(() => select([], { ...windowsEnv, USERPROFILE }), /USERPROFILE/);
	});
}

test('managed installation refuses to copy a checkout into itself without changing source files', async (t) => {
	const source = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'saturday-nested-source-')));
	t.after(() => fs.rmSync(source, { recursive: true, force: true }));
	fs.writeFileSync(join(source, 'README.md'), 'Fictional source');
	await assert.rejects(
		install({ root: source, source }, { run: () => assert.fail('Must refuse before setup') }),
		/SATURDAY_INSTALL_ROOT outside the source checkout/
	);
	assert.deepEqual(fs.readdirSync(source).sort(), ['README.md', 'logs']);
	assert.equal(fs.readFileSync(join(source, 'README.md'), 'utf8'), 'Fictional source');
});

test('Windows shortcut results persist without stdout, preserve Unicode and reject missing/unowned results', async (t) => {
	const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'saturday-win-shortcut-')));
	const previousEnv = { ...process.env };
	const platform = Object.getOwnPropertyDescriptor(process, 'platform');
	t.after(() => {
		Object.defineProperty(process, 'platform', platform);
		t.mock.restoreAll();
		syncBuiltinESMExports();
		for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
		Object.assign(process.env, previousEnv);
		fs.rmSync(root, { recursive: true, force: true });
	});
	for (const key of Object.keys(process.env))
		if (key.startsWith('SATURDAY_')) delete process.env[key];
	Object.assign(process.env, {
		SATURDAY_DB_PATH: join(root, 'data', 'saturday.db'),
		SATURDAY_FILES_PATH: join(root, 'data', 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'data', 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'extensions')
	});
	const descriptor = join(root, 'installation.json');
	const config = {
		...sourceInstallation(),
		installation_id: '12345678-1234-1234-1234-123456789012'
	};
	fs.writeFileSync(descriptor, JSON.stringify(config));
	process.env.SATURDAY_INSTALLATION_PATH = descriptor;
	Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
	const links = new Map();
	const desktop = 'C:\\Users\\Example ü\\OneDrive\\Desktop';
	const shortcuts = new Set();
	let mode = 'normal';
	const quit = {};
	const shell = {
		SpecialFolders: (folder) => (folder === 'Desktop' ? desktop : 'C:\\Users\\Example ü\\Startup'),
		ExpandEnvironmentStrings: (value) => value.replace('%SystemRoot%', 'C:\\Windows'),
		CreateShortcut: (path) => {
			path = win32.normalize(path);
			const link = links.get(path) || {};
			link.Save = () => {
				links.set(path, link);
				shortcuts.add(path);
			};
			return link;
		}
	};
	const files = {
		FileExists: (path) => links.has(win32.normalize(path)),
		DeleteFile: (path) => links.delete(win32.normalize(path)),
		CreateTextFile: (path, overwrite, unicode) => {
			assert.equal(overwrite, false);
			assert.equal(unicode, true);
			let text = '\ufeff';
			return {
				Write: (value) => {
					text += value;
				},
				Close: () => fs.writeFileSync(path, text, { encoding: 'utf16le', flag: 'wx' })
			};
		}
	};
	t.mock.method(childProcess, 'execFile', (command, args, options, callback) => {
		assert.equal(command, 'cscript.exe');
		assert.equal(options.encoding, 'utf16le');
		const [helper, ...arguments_] = args.slice(2);
		queueMicrotask(() => {
			try {
				if (mode !== 'missing') {
					if (mode === 'empty') fs.writeFileSync(arguments_[4], '\ufeff', 'utf16le');
					else
						runInNewContext(fs.readFileSync(helper, 'utf8'), {
							ActiveXObject: function (name) {
								return name === 'WScript.Shell' ? shell : files;
							},
							WScript: {
								Arguments: (index) => arguments_[index],
								Quit: () => {
									throw quit;
								}
							}
						});
				}
				callback(null, '', ''); // Reproduce the observed empty native stdout.
			} catch (error) {
				callback(error === quit ? null : error, '', '');
			}
		});
	});
	syncBuiltinESMExports();
	const expected = win32.join(desktop, 'Open Saturday 12345678.lnk');
	assert.equal(await createDesktopShortcut(), expected);
	assert.equal(JSON.parse(fs.readFileSync(descriptor)).desktop_shortcut, expected);
	assert.equal(shortcuts.has(expected), true);
	assert.deepEqual(await loginStartupStatus(), { available: true, enabled: false });
	assert.equal(await createDesktopShortcut(), expected); // An owned existing shortcut can be recreated.
	links.get(expected).Description = 'Someone else owns this shortcut';
	await assert.rejects(createDesktopShortcut(), /unrelated shortcut/);
	assert.equal(links.get(expected).Description, 'Someone else owns this shortcut');
	links.get(expected).Description = 'Saturday installation ' + config.installation_id;
	assert.equal(await removeDesktopShortcut(), 'disabled');
	assert.equal(links.has(expected), false);
	for (mode of ['missing', 'empty']) {
		await assert.rejects(createDesktopShortcut(), mode === 'missing' ? /ENOENT/ : /no result/);
		assert.equal(JSON.parse(fs.readFileSync(descriptor)).desktop_shortcut, expected);
	}
	assert.deepEqual(fs.readdirSync(join(config.data_root, 'server.state')).sort(), [
		'login-saturday.js',
		'open-saturday.js',
		'shortcut-helper.js'
	]);
});
