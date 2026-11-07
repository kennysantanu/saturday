import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	sourceInstallation,
	createDesktopShortcut,
	removeDesktopShortcut,
	launcherArtifacts
} from '../src/lib/server/installation.js';

// The macOS and Linux desktop shortcuts are real files, so they can be checked on those hosts.
const supported = ['darwin', 'linux'].includes(process.platform);

test(
	'the desktop shortcut is named Saturday, carries the icon, avoids other items and replaces old ones',
	{
		skip: !supported && 'Needs a macOS or Linux host.'
	},
	async (t) => {
		const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'saturday-shortcuts-')));
		const previousEnv = { ...process.env };
		t.after(() => {
			for (const key of Object.keys(process.env))
				if (!(key in previousEnv)) delete process.env[key];
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

		const mac = process.platform === 'darwin';
		const extension = mac ? '.app' : '.desktop';
		const artifact = launcherArtifacts({ ...config, descriptor_path: descriptor });
		assert.ok(fs.existsSync(artifact.icon), 'the bundled icon ships with the code');
		const desktop = join(root, 'Desktop');
		fs.mkdirSync(desktop);
		const first = join(desktop, `Saturday${extension}`);

		assert.equal(await createDesktopShortcut({ desktop }), first);
		assert.equal(await createDesktopShortcut({ desktop }), first, 'creating again keeps the name');
		if (mac) {
			const plist = fs.readFileSync(join(first, 'Contents', 'Info.plist'), 'utf8');
			assert.match(plist, /<key>CFBundleName<\/key><string>Saturday<\/string>/);
			assert.match(plist, /<key>CFBundleDisplayName<\/key><string>Saturday<\/string>/);
			assert.match(plist, /<key>CFBundleIconFile<\/key><string>saturday<\/string>/);
			assert.deepEqual(
				fs.readFileSync(join(first, 'Contents', 'Resources', 'saturday.icns')),
				fs.readFileSync(artifact.icon)
			);
		} else {
			const entry = fs.readFileSync(first, 'utf8');
			assert.match(entry, /\nName=Saturday\n/);
			assert.match(entry, /\nComment=Saturday Career Dashboard\n/);
			assert.ok(entry.includes(`\nIcon=${artifact.icon}\n`));
		}

		// An item of someone else's called Saturday is left alone and the next name is used.
		const other = join(root, 'Other');
		fs.mkdirSync(other);
		const foreign = join(other, `Saturday${extension}`);
		if (mac) fs.mkdirSync(foreign);
		else fs.writeFileSync(foreign, 'not ours');
		const second = join(other, `Saturday (2)${extension}`);
		assert.equal(await createDesktopShortcut({ desktop: other }), second);
		assert.equal(fs.statSync(foreign).isDirectory(), mac, 'the unrelated item is untouched');
		if (!mac) assert.equal(fs.readFileSync(foreign, 'utf8'), 'not ours');

		// A shortcut an earlier version made (named with the installation id) is replaced.
		const legacyName = mac
			? 'Open Saturday 12345678.app'
			: `saturday-${config.installation_id}.desktop`;
		const legacy = join(desktop, legacyName);
		if (mac) {
			fs.mkdirSync(join(legacy, 'Contents', 'MacOS'), { recursive: true });
			fs.writeFileSync(
				join(legacy, 'Contents', 'MacOS', 'open-saturday'),
				`# ${artifact.marker}\n`
			);
		} else fs.writeFileSync(legacy, `# ${artifact.marker}\n`);
		assert.equal(await createDesktopShortcut({ desktop }), first);
		assert.equal(fs.existsSync(legacy), false, 'the earlier shortcut is replaced');

		// Removing deletes only what is ours.
		fs.writeFileSync(descriptor, JSON.stringify({ ...config, desktop_shortcut: first }));
		await removeDesktopShortcut();
		assert.equal(fs.existsSync(first), false);
		fs.writeFileSync(descriptor, JSON.stringify({ ...config, desktop_shortcut: second }));
		await removeDesktopShortcut();
		assert.equal(fs.existsSync(second), false);
		assert.equal(fs.existsSync(foreign), true, 'the unrelated item remains');
	}
);

test('the bundled icons are valid Windows, macOS and PNG images at every size', () => {
	const dir = new URL('../static/icons/', import.meta.url);
	const ico = fs.readFileSync(new URL('saturday.ico', dir));
	assert.equal(ico.readUInt16LE(2), 1, 'an icon resource');
	const count = ico.readUInt16LE(4);
	const sizes = [];
	for (let index = 0; index < count; index++) {
		const entry = 6 + index * 16;
		const length = ico.readUInt32LE(entry + 8),
			offset = ico.readUInt32LE(entry + 12);
		const png = ico.subarray(offset, offset + length);
		assert.equal(png.subarray(1, 4).toString(), 'PNG');
		const width = png.readUInt32BE(16);
		assert.equal(width, png.readUInt32BE(20), 'square');
		assert.equal(ico[entry] || 256, width, 'the directory matches the image');
		sizes.push(width);
	}
	assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
	const icns = fs.readFileSync(new URL('saturday.icns', dir));
	assert.equal(icns.subarray(0, 4).toString(), 'icns');
	assert.equal(icns.readUInt32BE(4), icns.length);
	const types = [];
	for (let at = 8; at < icns.length;) {
		types.push(icns.subarray(at, at + 4).toString());
		at += icns.readUInt32BE(at + 4);
	}
	assert.deepEqual(types, ['icp4', 'icp5', 'icp6', 'ic07', 'ic08', 'ic09', 'ic10']);
	const png = fs.readFileSync(new URL('saturday.png', dir));
	assert.equal(png.readUInt32BE(16), 512);
});
