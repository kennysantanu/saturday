import { cp, mkdir, lstat, readFile, writeFile, realpath, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join, dirname, win32, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
	assertDisjointFromProtectedRoots,
	assertOutsideProtectedRoots
} from './test-isolation.mjs';

const exec = promisify(execFile);
const xml = (value) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');

export function windowsSandboxConfig(input, output) {
	for (const path of [input, output]) {
		if (!win32.isAbsolute(path)) throw new Error('Windows Sandbox shares must use absolute paths.');
	}
	return `<Configuration>
<VGpu>Disable</VGpu><Networking>Enable</Networking>
<ClipboardRedirection>Disable</ClipboardRedirection><PrinterRedirection>Disable</PrinterRedirection>
<AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput>
<MappedFolders>
<MappedFolder><HostFolder>${xml(input)}</HostFolder><SandboxFolder>C:\\SaturdayTestInput</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
<MappedFolder><HostFolder>${xml(output)}</HostFolder><SandboxFolder>C:\\SaturdayTestOutput</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
</MappedFolders>
<LogonCommand><Command>cmd.exe /d /c C:\\SaturdayTestInput\\run.cmd</Command></LogonCommand>
</Configuration>\n`;
}

export async function copyTestTree(source, target, roots) {
	assertOutsideProtectedRoots(source, roots);
	// Reject junctions/symlinks rather than exposing their host targets in a share.
	await cp(source, target, {
		recursive: true,
		filter: async (path) => {
			if ((await lstat(path)).isSymbolicLink())
				throw new Error(`Test bundle cannot include a symbolic link or junction: ${path}`);
			assertOutsideProtectedRoots(await realpath(path), roots);
			return true;
		}
	});
}

export async function readSandboxOutput(output, name, roots) {
	if (!['result.json', 'tests.log'].includes(name))
		throw new Error('Unexpected sandbox output name.');
	const path = join(output, name);
	for (const entry of [output, path]) {
		if ((await lstat(entry)).isSymbolicLink())
			throw new Error('Sandbox output cannot contain a symbolic link or junction.');
		assertOutsideProtectedRoots(await realpath(entry), roots);
	}
	const difference = relative(await realpath(output), await realpath(path));
	if (isAbsolute(difference) || difference === '..' || difference.startsWith(`..${sep}`))
		throw new Error('Sandbox result escaped its output directory.');
	if (!(await lstat(path)).isFile()) throw new Error('Sandbox result must be a regular file.');
	return readFile(path, 'utf8');
}

export async function runWindowsSandbox({ project, scratch, roots, task, extra, signal }) {
	const launcher = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsSandbox.exe');
	assertOutsideProtectedRoots(launcher, roots);
	if (!existsSync(launcher))
		throw new Error(
			'Windows Sandbox is required for protected Windows tests. Enable the Windows Sandbox optional feature on a supported Windows edition; tests will not run on the host as a fallback.'
		);
	assertDisjointFromProtectedRoots(project, roots);
	assertDisjointFromProtectedRoots(scratch, roots);
	assertDisjointFromProtectedRoots(scratch, [project]);
	const input = join(scratch, 'input'),
		output = join(scratch, 'output');
	await mkdir(join(input, 'source'), { recursive: true });
	await mkdir(output);
	const tracked = await exec(
		'git',
		['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
		{ cwd: project, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
	);
	console.log('Preparing a disposable Windows test snapshot (including development dependencies)…');
	for (const name of tracked.stdout.split('\0').filter(Boolean)) {
		const source = join(project, name),
			target = join(input, 'source', name);
		if (!existsSync(source)) continue; // Locally deleted tracked files stay deleted.
		await mkdir(dirname(target), { recursive: true });
		await copyTestTree(source, target, roots);
	}
	// A real repository is needed by archive/clone/update tests. A linked worktree
	// would reference directories not shared with the guest, so refuse it explicitly.
	const gitDirectory = join(project, '.git');
	if (!(await lstat(gitDirectory)).isDirectory())
		throw new Error(
			'Windows Sandbox tests require an ordinary Git checkout, not a linked worktree.'
		);
	await copyTestTree(gitDirectory, join(input, 'source', '.git'), roots);
	await copyTestTree(join(project, 'node_modules'), join(input, 'source', 'node_modules'), roots);
	for (const name of ['build', '.svelte-kit'])
		if (existsSync(join(project, name)))
			await copyTestTree(join(project, name), join(input, 'source', name), roots);
	await mkdir(join(input, 'node'));
	await copyTestTree(process.execPath, join(input, 'node', 'node.exe'), roots);
	const npmRoot = dirname(
		dirname(
			process.env.npm_execpath ||
				join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
		)
	);
	await copyTestTree(npmRoot, join(input, 'node', 'node_modules', 'npm'), roots);
	const located = await exec('where.exe', ['git.exe'], { encoding: 'utf8' });
	let gitRoot = dirname(located.stdout.trim().split(/\r?\n/)[0]);
	while (!existsSync(join(gitRoot, 'cmd', 'git.exe'))) {
		const parent = dirname(gitRoot);
		if (parent === gitRoot)
			throw new Error('Protected Windows tests require a standard Git for Windows installation.');
		gitRoot = parent;
	}
	await copyTestTree(gitRoot, join(input, 'git'), roots);
	const cache =
		process.env.PUPPETEER_CACHE_DIR ||
		join((await import('node:os')).userInfo().homedir, '.cache', 'puppeteer');
	assertOutsideProtectedRoots(cache, roots);
	if (existsSync(cache)) await copyTestTree(cache, join(input, 'chrome'), roots);
	const token = randomUUID();
	await writeFile(join(input, 'job.json'), JSON.stringify({ task, extra, token }));
	await cp(
		fileURLToPath(new URL('./windows-sandbox-guest.mjs', import.meta.url)),
		join(input, 'guest.mjs')
	);
	await writeFile(
		join(input, 'run.cmd'),
		'@echo off\r\nset "PATH=C:\\SaturdayTestInput\\node;C:\\SaturdayTestInput\\git\\cmd;C:\\SaturdayTestInput\\git\\bin;%SystemRoot%\\System32;%SystemRoot%"\r\n"C:\\SaturdayTestInput\\node\\node.exe" "C:\\SaturdayTestInput\\guest.mjs"\r\n'
	);
	const config = join(scratch, 'tests.wsb');
	await writeFile(config, windowsSandboxConfig(await realpath(input), await realpath(output)));
	console.log('Windows Sandbox: only the disposable input bundle and results folder are shared.');
	let launchError;
	const child = spawn(launcher, [await realpath(config)], { stdio: 'inherit', signal });
	child.on('error', (error) => {
		launchError = error;
	});
	const deadline = Date.now() + 30 * 60 * 1000;
	try {
		while (Date.now() < deadline) {
			if (launchError) throw launchError;
			if (signal?.aborted) throw new Error('Windows Sandbox test run interrupted.');
			if (child.exitCode !== null && child.exitCode !== 0)
				throw new Error(`Windows Sandbox failed to start (exit ${child.exitCode}).`);
			try {
				const result = JSON.parse(await readSandboxOutput(output, 'result.json', roots));
				if (result.token !== token || !Number.isInteger(result.code))
					throw new Error('Invalid Windows Sandbox test result.');
				console.log(await readSandboxOutput(output, 'tests.log', roots));
				if (result.error) console.error(result.error);
				const evidence = await mkdtemp(join(tmpdir(), 'saturday-windows-test-results-'));
				await copyTestTree(output, evidence, roots);
				console.log(`Windows test evidence: ${evidence}`);
				return result.code;
			} catch (error) {
				if (error.code !== 'ENOENT') throw error;
			}
			await new Promise((done) => setTimeout(done, 250));
		}
		throw new Error(
			'Windows Sandbox did not report a result within 30 minutes. Close this test sandbox window; no host-test fallback was run.'
		);
	} finally {
		// Never stop other Sandbox instances by process name.
		if (child.exitCode === null && child.signalCode === null) child.kill();
	}
}
