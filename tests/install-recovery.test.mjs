import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	recordedDirectoryKeys,
	unclassifiedPathKeys,
	ensureRecordedDirectories,
	checkRecordedDirectories
} from '../src/lib/server/installation.js';
import {
	incompleteChromeDirectories,
	quarantineIncomplete,
	removeIncompleteChrome,
	scanIncompleteChrome
} from '../scripts/pdf-cache.mjs';

const temp = () => fs.mkdtemp(join(tmpdir(), 'saturday-recovery-'));
const descriptor = (root) => ({
	data_root: join(root, 'data'),
	files: join(root, 'data', 'files'),
	files_state: join(root, 'data', 'files.state'),
	database_backups: join(root, 'data', 'backups', 'database'),
	database_restore: join(root, 'data', 'saturday.db.restore'),
	file_backups: join(root, 'data', 'backups', 'files'),
	extension_state: join(root, 'data', 'extensions'),
	extension_code: join(root, 'extensions'),
	extension_backups: join(root, 'data', 'extensions.backups'),
	logs: join(root, 'logs')
});

test('every recorded path key is classified as a directory or a non-directory', () => {
	// Fails when a path is added to the descriptor without deciding whether setup creates it.
	assert.deepEqual(unclassifiedPathKeys(), []);
	assert.deepEqual(Object.keys(descriptor('/x')).sort(), [...recordedDirectoryKeys].sort());
});

test('setup creates every recorded directory, keeps existing contents and restores deleted ones', async () => {
	const root = await temp();
	try {
		const config = descriptor(root);
		assert.ok(checkRecordedDirectories(config).some((p) => p === 'extension_code is missing'));
		await fs.mkdir(config.files, { recursive: true });
		await fs.writeFile(join(config.files, 'keep.txt'), 'data');
		await ensureRecordedDirectories(config);
		assert.deepEqual(checkRecordedDirectories(config), []);
		assert.equal(await fs.readFile(join(config.files, 'keep.txt'), 'utf8'), 'data');
		if (process.platform !== 'win32')
			assert.equal((await fs.stat(config.extension_code)).mode & 0o777, 0o700);
		await fs.rm(config.extension_code, { recursive: true });
		await ensureRecordedDirectories(config);
		assert.deepEqual(checkRecordedDirectories(config), []);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('a recorded path that is a file is reported, not replaced', async () => {
	const root = await temp();
	try {
		const config = descriptor(root);
		// Pre-create the other recorded directories so this case isolates the file-in-the-way rule.
		for (const key of recordedDirectoryKeys)
			if (key !== 'extension_code') await fs.mkdir(config[key], { recursive: true });
		await fs.writeFile(config.extension_code, 'not a directory');
		await assert.rejects(ensureRecordedDirectories(config), /extension_code .*not a directory/);
		assert.equal(await fs.readFile(config.extension_code, 'utf8'), 'not a directory');
		assert.deepEqual(checkRecordedDirectories(config), ['extension_code is not a directory']);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('only incomplete Chrome version directories are removed, and only inside the cache', async () => {
	const root = await temp();
	try {
		const cache = join(root, 'chrome-cache');
		const incomplete = join(cache, 'chrome', 'mac_arm-100.0.1.2');
		const partial = join(cache, 'chrome', 'linux-101.0.1.2', 'chrome-linux64');
		const complete = join(cache, 'chrome', 'linux-99.0.1.2', 'chrome-linux64');
		const outside = join(root, 'outside');
		await fs.mkdir(incomplete, { recursive: true });
		await fs.mkdir(partial, { recursive: true });
		await fs.writeFile(join(partial, 'locales.pak'), 'x');
		await fs.mkdir(complete, { recursive: true });
		await fs.writeFile(join(complete, 'chrome'), 'binary');
		await fs.mkdir(outside);
		await fs.writeFile(join(outside, 'precious'), 'x');
		await fs.symlink(outside, join(cache, 'chrome', 'linux-102.0.0.1'), 'dir').catch(() => {});
		await fs.mkdir(join(cache, 'chrome', 'not-a-version'), { recursive: true });

		assert.deepEqual((await incompleteChromeDirectories(cache)).sort(), [
			incompleteDir(partial),
			incomplete
		]);
		await removeIncompleteChrome(cache);
		assert.ok(!existsSync(incomplete));
		assert.ok(!existsSync(join(cache, 'chrome', 'linux-101.0.1.2')));
		assert.ok(existsSync(join(complete, 'chrome')));
		assert.ok(existsSync(join(outside, 'precious')));
		assert.ok(existsSync(join(cache, 'chrome', 'not-a-version')));
		assert.deepEqual(await removeIncompleteChrome(cache), []);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('a missing cache needs no cleanup', async () => {
	const root = await temp();
	try {
		assert.deepEqual(await removeIncompleteChrome(join(root, 'absent')), []);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

// The partial fixture nests the executable's expected folder; the version directory is its parent.
const incompleteDir = (path) => join(path, '..');

test('a complete Chrome version is never removed, and its sibling incomplete version is', async () => {
	const root = await temp();
	try {
		const cache = join(root, 'cache'),
			chrome = join(cache, 'chrome');
		const complete = join(chrome, 'mac_arm-200.0.1'),
			broken = join(chrome, 'mac_arm-100.0.1');
		// Real macOS layout: …/Google Chrome for Testing.app/Contents/MacOS/<executable>
		await fs.mkdir(
			join(complete, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS'),
			{ recursive: true }
		);
		await fs.writeFile(
			join(
				complete,
				'chrome-mac-arm64',
				'Google Chrome for Testing.app',
				'Contents',
				'MacOS',
				'Google Chrome for Testing'
			),
			'bin'
		);
		await fs.mkdir(join(broken, 'chrome-mac-arm64'), { recursive: true });
		const moved = await removeIncompleteChrome(cache);
		assert.equal(moved.length, 1);
		assert.match(moved[0], /^.*mac_arm-100\.0\.1\.incomplete-\d+-\d+$/);
		assert.ok(existsSync(complete), 'a complete version must survive');
		assert.ok(!existsSync(broken), 'the incomplete version no longer occupies its path');
		assert.ok(existsSync(moved[0]), 'the incomplete version was moved aside, not destroyed');
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('a symlinked cache is followed, but removal stays inside its real location', async () => {
	const root = await temp();
	try {
		const real = join(root, 'real'),
			outside = join(root, 'outside', 'chrome', 'mac_arm-1.0.0'),
			link = join(root, 'link');
		await fs.mkdir(outside, { recursive: true });
		await fs.mkdir(join(real, 'chrome', 'mac_arm-9.9.9'), { recursive: true });
		await fs.mkdir(link, { recursive: true });
		// The cache itself is a symlink to a directory that is legitimately ours.
		await fs.symlink(real, join(link, 'cache'), 'dir');
		const moved = await removeIncompleteChrome(join(link, 'cache'));
		assert.equal(moved.length, 1);
		assert.match(moved[0], /mac_arm-9\.9\.9\.incomplete-\d+-\d+$/);
		assert.ok(
			!existsSync(join(real, 'chrome', 'mac_arm-9.9.9')),
			'the incomplete entry no longer occupies its path'
		);
		assert.ok(existsSync(outside), 'nothing outside the resolved cache is removed');
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('a symlinked chrome directory is not followed for removal', async () => {
	const root = await temp();
	try {
		const cache = join(root, 'cache'),
			elsewhere = join(root, 'elsewhere', 'mac_arm-1.0.0');
		await fs.mkdir(elsewhere, { recursive: true });
		await fs.mkdir(cache, { recursive: true });
		await fs.symlink(join(root, 'elsewhere'), join(cache, 'chrome'), 'dir');
		assert.deepEqual(await removeIncompleteChrome(cache), []);
		assert.ok(existsSync(elsewhere), 'a symlinked chrome directory is never traversed');
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('an unreadable cache is an error, not a licence to delete', async () => {
	const root = await temp();
	try {
		const cache = join(root, 'cache'),
			chrome = join(cache, 'chrome');
		await fs.mkdir(join(chrome, 'mac_arm-1.0.0'), { recursive: true });
		if (process.platform === 'win32') return; // Directory permissions are not modelled the same way.
		await fs.chmod(chrome, 0o000);
		await assert.rejects(removeIncompleteChrome(cache), /could not be inspected/);
		await fs.chmod(chrome, 0o700);
		assert.ok(
			existsSync(join(chrome, 'mac_arm-1.0.0')),
			'nothing may be removed on inspection failure'
		);
	} finally {
		await fs.chmod(join(root, 'cache', 'chrome'), 0o700).catch(() => {});
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('database_restore is treated as a directory and pdf_cache as optional', async () => {
	const root = await temp();
	try {
		const config = descriptor(root);
		await ensureRecordedDirectories(config);
		assert.ok(existsSync(config.database_restore), 'database_restore must be created');
		assert.deepEqual(checkRecordedDirectories(config), []);
		// pdf_cache is only required when the descriptor records it.
		assert.ok(!existsSync(join(root, 'runtime', 'chrome')));
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('removal never follows a symlink inside the tree, so the target survives', async () => {
	const root = await temp();
	try {
		const cache = join(root, 'cache'),
			broken = join(cache, 'chrome', 'mac_arm-3.0.0'),
			precious = join(root, 'precious');
		await fs.mkdir(join(broken, 'chrome-mac-arm64'), { recursive: true });
		await fs.mkdir(precious, { recursive: true });
		await fs.writeFile(join(precious, 'keep.txt'), 'important');
		// A symlink inside the incomplete tree must be unlinked, never traversed.
		await fs.symlink(precious, join(broken, 'chrome-mac-arm64', 'link'), 'dir');
		const moved = await removeIncompleteChrome(cache);
		assert.equal(moved.length, 1);
		assert.ok(!existsSync(broken), 'the incomplete tree no longer occupies its path');
		assert.ok(existsSync(join(precious, 'keep.txt')), 'the symlink target is untouched');
		assert.ok(
			existsSync(join(moved[0], 'chrome-mac-arm64', 'link')),
			'the symlink itself moved with the tree'
		);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('a version that finishes downloading between discovery and rename is left alone', async () => {
	const root = await temp();
	try {
		const cache = join(root, 'cache'),
			version = join(cache, 'chrome', 'mac_arm-4.0.0'),
			macOS = join(
				version,
				'chrome-mac-arm64',
				'Google Chrome for Testing.app',
				'Contents',
				'MacOS'
			);
		await fs.mkdir(macOS, { recursive: true });
		// Discovery sees no executable, so the entry looks incomplete.
		const discovered = await incompleteChromeDirectories(cache);
		assert.deepEqual(discovered, [version]);
		// The download completes in the window between discovery and the rename.
		await fs.writeFile(join(macOS, 'Google Chrome for Testing'), 'bin');
		// Recover exactly the entry discovery returned; the re-check must decline to move it.
		const outcome = await quarantineIncomplete(cache, discovered);
		assert.deepEqual(outcome, []);
		assert.ok(existsSync(version), 'a completed version must not be moved aside');
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('recovery refuses when the cache root was replaced after discovery', async () => {
	const root = await temp();
	try {
		const cache = join(root, 'cache'),
			version = join(cache, 'chrome', 'mac_arm-5.0.0'),
			elsewhere = join(root, 'elsewhere');
		await fs.mkdir(version, { recursive: true });
		await fs.mkdir(elsewhere, { recursive: true });
		const { root: discoveredRoot, entries } = await scanIncompleteChrome(cache);
		assert.deepEqual(entries, [version]);
		// Replace the chrome directory with a symlink to somewhere else.
		await fs.rm(join(cache, 'chrome'), { recursive: true, force: true });
		await fs.mkdir(join(elsewhere, 'mac_arm-5.0.0'), { recursive: true });
		await fs.symlink(elsewhere, join(cache, 'chrome'), 'dir');
		await assert.rejects(
			quarantineIncomplete(cache, entries, discoveredRoot),
			/cache location changed/
		);
		assert.ok(existsSync(join(elsewhere, 'mac_arm-5.0.0')), 'nothing outside may be moved');
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
