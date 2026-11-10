import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, renameSync, symlinkSync, mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
	isolatedEnvironment,
	personalMacRoot,
	macSandboxProfile,
	assertOutsideProtectedRoots
} from './helpers/test-isolation.mjs';

test('every npm test suite and the verification/type-check entries use the protected launcher', () => {
	const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	for (const [name, command] of Object.entries(pkg.scripts)) {
		if (name === 'test' || name.startsWith('test:') || ['verify', 'check'].includes(name))
			assert.match(command, /^node tests\/run\.mjs [\w-]+$/, name);
	}
});

test('inherited installation, storage, build and preload overrides are replaced by disposable paths', () => {
	const root = join(tmpdir(), 'fictional-check');
	const env = isolatedEnvironment(
		{
			PATH: 'keep-path',
			HOME: '/fictional/home',
			SATURDAY_INSTALLATION_PATH: '/personal/installation.json',
			SATURDAY_DB_PATH: '/personal/saturday.db',
			SATURDAY_INSTALL_ROOT: '/personal',
			SATURDAY_SETUP_STAGING: '1',
			SATURDAY_BUILD_COMMIT: 'personal-build',
			NODE_OPTIONS: '--import=/personal/preload.mjs',
			NODE_PATH: '/personal/modules'
		},
		root,
		'/fictional/source'
	);
	assert.equal(env.PATH, 'keep-path');
	assert.equal(env.SATURDAY_INSTALLATION_PATH, '');
	assert.equal(env.SATURDAY_PROJECT_ROOT, '/fictional/source');
	for (const key of [
		'SATURDAY_DB_PATH',
		'SATURDAY_FILES_PATH',
		'SATURDAY_EXTENSIONS_PATH',
		'SATURDAY_EXTENSION_STATE_PATH',
		'SATURDAY_INSTALL_ROOT'
	])
		assert.ok(env[key].startsWith(root));
	for (const key of [
		'NODE_OPTIONS',
		'NODE_PATH',
		'SATURDAY_SETUP_STAGING',
		'SATURDAY_BUILD_COMMIT'
	])
		assert.equal(env[key], undefined);
	const previous = process.env.HOME;
	try {
		process.env.HOME = '/fictional/fake-home';
		assert.equal(
			personalMacRoot(),
			join(userInfo().homedir, 'Library', 'Application Support', 'Saturday')
		);
	} finally {
		if (previous === undefined) delete process.env.HOME;
		else process.env.HOME = previous;
	}
});

test(
	'macOS profile protects a root, its canonical alias and ancestor renames',
	{ skip: process.platform !== 'darwin' },
	() => {
		const root = mkdtempSync(join(tmpdir(), 'saturday-profile-'));
		try {
			const alias = `${root}-alias`;
			symlinkSync(root, alias);
			try {
				const profile = macSandboxProfile([join(alias, 'missing-child')]);
				assert.match(profile, /deny file-read\* file-write\*/);
				assert.ok(profile.includes(`(subpath ${JSON.stringify(join(alias, 'missing-child'))})`));
				assert.ok(profile.includes(`(literal ${JSON.stringify(dirname(root))})`));
				assert.throws(() => assertOutsideProtectedRoots(join(alias, 'child'), [root]), /outside/);
				assert.throws(() => assertOutsideProtectedRoots(root, [root]), /outside/);
				assert.throws(() => assertOutsideProtectedRoots(join(root, '..child'), [root]), /outside/);
				assert.doesNotThrow(() => assertOutsideProtectedRoots(`${root}-sibling`, [root]));
			} finally {
				rmSync(alias);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
);

test(
	'OS sandbox denies personal-file access through Node, shell children, aliases and ancestor renames',
	{ skip: !['darwin', 'linux'].includes(process.platform) },
	async () => {
		// This is a fictional fixture seeded by the launcher, never the real installation.
		const root = process.env.SATURDAY_TEST_PROTECTED_FIXTURE;
		assert.ok(
			root,
			'Run macOS tests through npm test or node tests/run.mjs -- node --test <file>.'
		);
		const sentinel = join(root, 'sentinel.txt');
		const denied = (error) => ['EPERM', 'EACCES', 'EROFS', 'EBUSY', 'ENOENT'].includes(error.code);
		assert.throws(() => readFileSync(sentinel), denied);
		await assert.rejects(readFile(sentinel), denied);
		assert.throws(() => writeFileSync(sentinel, 'overwritten'), denied);
		assert.throws(() => writeFileSync(join(root, 'new.txt'), 'created'), denied);
		assert.throws(() => rmSync(sentinel), denied);
		assert.throws(() => renameSync(root, `${root}-moved`), denied);
		assert.throws(() => renameSync(dirname(root), `${dirname(root)}-moved`), denied);
		const alias = join(tmpdir(), `saturday-protected-alias-${process.pid}`);
		symlinkSync(root, alias);
		try {
			assert.throws(() => readFileSync(join(alias, 'sentinel.txt')), denied);
		} finally {
			rmSync(alias);
		}
		const child = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				'import fs from "node:fs"; fs.readFileSync(process.argv[1]);',
				sentinel
			],
			{ env: {}, encoding: 'utf8' }
		);
		assert.notEqual(child.status, 0);
		assert.match(child.stderr, /EPERM|EACCES/);
		const shell = spawnSync(
			'/bin/sh',
			['-c', 'cat "$1"; printf changed > "$1"', 'test', sentinel],
			{ env: {}, encoding: 'utf8' }
		);
		assert.notEqual(shell.status, 0);
		assert.match(shell.stderr, /Operation not permitted|Permission denied/);
		if (process.platform === 'darwin') {
			const { default: puppeteer } = await import('puppeteer');
			const browser = await puppeteer.launch({ headless: true });
			try {
				const page = await browser.newPage();
				await assert.rejects(page.goto(pathToFileURL(sentinel).href), /net::ERR_/);
			} finally {
				await browser.close();
			}
		}
	}
);
