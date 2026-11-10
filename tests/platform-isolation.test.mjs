import test from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	rmSync,
	symlinkSync,
	existsSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
	personalInstallationRoots,
	assertDisjointFromProtectedRoots
} from './helpers/test-isolation.mjs';
import { linuxSandboxCommand } from './helpers/linux-sandbox.mjs';
import {
	windowsSandboxConfig,
	copyTestTree,
	readSandboxOutput
} from './helpers/windows-sandbox.mjs';

test('internal Windows guest entry refuses an ordinary host process or missing job capability', () => {
	const result = spawnSync(process.execPath, ['tests/run.mjs', '--windows-sandbox', 'unit'], {
		cwd: process.cwd(),
		env: process.env,
		encoding: 'utf8',
		timeout: 10000
	});
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /guest test entry|test job does not match/);
});

test(
	'Linux stops before the requested command when Bubblewrap is unavailable',
	{ skip: process.platform !== 'linux' },
	() => {
		const root = mkdtempSync(join(tmpdir(), 'saturday-no-bwrap-'));
		const marker = join(root, 'must-not-exist');
		try {
			const result = spawnSync(
				process.execPath,
				[
					'tests/run.mjs',
					'--',
					process.execPath,
					'-e',
					`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unguarded')`
				],
				{
					cwd: process.cwd(),
					env: { ...process.env, PATH: join(root, 'no-tools') },
					encoding: 'utf8',
					timeout: 10000
				}
			);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /bwrap.*ENOENT/);
			assert.match(result.stderr, /no unprotected fallback/);
			assert.equal(existsSync(marker), false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
);

test('protected roots include Windows current/legacy/redirected and Linux default/configured paths', () => {
	assert.deepEqual(
		personalInstallationRoots('win32', 'C:\\Users\\Tester', {
			LOCALAPPDATA: 'C:\\Redirected\\Local'
		}),
		[
			'C:\\Users\\Tester\\Saturday',
			'C:\\Users\\Tester\\AppData\\Local\\Saturday',
			'C:\\Redirected\\Local\\Saturday'
		]
	);
	assert.deepEqual(
		personalInstallationRoots('linux', '/home/tester', { XDG_DATA_HOME: '/external/data' }),
		['/home/tester/.local/share/saturday', '/external/data/saturday']
	);
	assert.deepEqual(
		personalInstallationRoots('linux', '/home/tester', {
			HOME: '/fake',
			XDG_DATA_HOME: 'relative'
		}),
		['/home/tester/.local/share/saturday']
	);
	assert.throws(
		() => personalInstallationRoots('unknown', '/fake', {}),
		/No test filesystem protection/
	);
});

test('Linux view is read-only except project and scratch, masks present roots and preserves missing roots as read-only', () => {
	const root = mkdtempSync(join(tmpdir(), 'saturday-linux-policy-'));
	try {
		const personal = join(root, 'personal'),
			missing = join(root, 'absent');
		const project = join(root, 'project'),
			scratch = join(root, 'scratch'),
			hidden = join(scratch, 'hidden');
		mkdirSync(personal);
		mkdirSync(project);
		mkdirSync(scratch);
		mkdirSync(hidden);
		const command = linuxSandboxCommand({
			project,
			scratch,
			hidden,
			roots: [personal, missing],
			command: ['node', '--test', 'fictional.mjs']
		});
		assert.equal(command[0], 'bwrap');
		const triples = command.flatMap((value, index) =>
			['--bind', '--ro-bind'].includes(value) ? [command.slice(index, index + 3)] : []
		);
		assert.deepEqual(
			triples.filter(([flag]) => flag === '--bind'),
			[
				['--bind', project, project],
				['--bind', scratch, scratch]
			]
		);
		assert.ok(
			triples.some(([flag, from, to]) => flag === '--ro-bind' && from === '/' && to === '/')
		);
		assert.ok(
			triples.some(([flag, from, to]) => flag === '--ro-bind' && from === hidden && to === personal)
		);
		assert.ok(!triples.some(([, , to]) => to === missing));
		assert.ok(command.includes('--unshare-pid'));
		assert.ok(command.includes('--unshare-user'));
		assert.deepEqual(command.slice(-4), ['--', 'node', '--test', 'fictional.mjs']);
		assert.throws(
			() =>
				linuxSandboxCommand({
					project: root,
					scratch,
					hidden,
					roots: [personal],
					command: ['node']
				}),
			/outside/
		);
		assert.throws(
			() => assertDisjointFromProtectedRoots(join(personal, 'child'), [personal]),
			/outside/
		);
		if (process.platform !== 'win32') {
			const alias = join(project, 'personal-alias');
			symlinkSync(personal, alias);
			assert.throws(() => assertDisjointFromProtectedRoots(project, [alias]), /outside/);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('Windows Sandbox maps only a disposable read-only bundle and results, with host integrations off', () => {
	const xml = windowsSandboxConfig('C:\\Temp\\a & b\\input', 'C:\\Temp\\a & b\\output');
	assert.equal((xml.match(/<HostFolder>/g) || []).length, 2);
	assert.match(xml, /a &amp; b/);
	assert.match(xml, /<ReadOnly>true<\/ReadOnly>/);
	assert.match(xml, /<ReadOnly>false<\/ReadOnly>/);
	for (const name of ['ClipboardRedirection', 'PrinterRedirection', 'AudioInput', 'VideoInput'])
		assert.ok(xml.includes(`<${name}>Disable</${name}>`));
	assert.ok(!xml.includes('USERPROFILE'));
	assert.ok(!xml.includes('AppData'));
	assert.throws(() => windowsSandboxConfig('relative', 'C:\\Temp\\output'), /absolute/);
});

test('host reads only regular sandbox result files and refuses returned personal-file aliases', async () => {
	const root = mkdtempSync(join(tmpdir(), 'saturday-output-policy-'));
	try {
		const output = join(root, 'output'),
			personal = join(root, 'personal');
		mkdirSync(output);
		mkdirSync(personal);
		writeFileSync(join(output, 'result.json'), '{"code":0}');
		writeFileSync(join(personal, 'private.log'), 'Fictional personal bytes');
		assert.equal(await readSandboxOutput(output, 'result.json', [personal]), '{"code":0}');
		await assert.rejects(
			readSandboxOutput(output, '../personal/private.log', [personal]),
			/Unexpected/
		);
		// Directory junctions work on Windows without symlink creation privileges.
		const alias = join(root, 'returned-alias');
		symlinkSync(personal, alias, process.platform === 'win32' ? 'junction' : 'dir');
		await assert.rejects(
			readSandboxOutput(alias, 'tests.log', [personal]),
			/symbolic link|junction/
		);
		if (process.platform !== 'win32') {
			symlinkSync(join(personal, 'private.log'), join(output, 'tests.log'));
			await assert.rejects(readSandboxOutput(output, 'tests.log', [personal]), /symbolic link/);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('Windows bundle copies regular fixture bytes and refuses personal roots and junction/symlink escape', async () => {
	const root = mkdtempSync(join(tmpdir(), 'saturday-bundle-policy-'));
	try {
		const source = join(root, 'source'),
			personal = join(root, 'personal');
		mkdirSync(source);
		mkdirSync(personal);
		const bytes = Buffer.from('Frozen fictional payload\r\n');
		writeFileSync(join(source, 'fixture'), bytes);
		writeFileSync(join(personal, 'sentinel'), 'untouched');
		await copyTestTree(source, join(root, 'copy'), [personal]);
		assert.deepEqual(readFileSync(join(root, 'copy', 'fixture')), bytes);
		await assert.rejects(copyTestTree(personal, join(root, 'forbidden'), [personal]), /outside/);
		assert.equal(existsSync(join(root, 'forbidden')), false);
		symlinkSync(
			personal,
			join(source, 'escape'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		await assert.rejects(
			copyTestTree(source, join(root, 'escaped-copy'), [personal]),
			/symbolic link|junction/
		);
		assert.equal(readFileSync(join(personal, 'sentinel'), 'utf8'), 'untouched');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
