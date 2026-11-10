// Public entry point for automated checks. Application imports belong in children.
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	rmSync,
	chmodSync,
	existsSync
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
	isolatedEnvironment,
	macSandboxProfile,
	personalInstallationRoots,
	assertOutsideProtectedRoots,
	assertDisjointFromProtectedRoots
} from './helpers/test-isolation.mjs';
import { linuxSandboxCommand } from './helpers/linux-sandbox.mjs';
import { runWindowsSandbox } from './helpers/windows-sandbox.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const windowsGuest = process.argv[2] === '--windows-sandbox';
const [task, ...extra] = process.argv.slice(windowsGuest ? 3 : 2);
if (windowsGuest) {
	if (
		process.platform !== 'win32' ||
		userInfo().username.toLowerCase() !== 'wdagutilityaccount' ||
		project.toLowerCase() !== 'c:\\saturdaytestwork\\source'
	)
		throw new Error('The guest test entry is only available in the generated Windows Sandbox.');
	const job = JSON.parse(readFileSync('C:\\SaturdayTestInput\\job.json', 'utf8'));
	if (process.env.SATURDAY_TEST_WINDOWS_SANDBOX !== job.token || job.task !== task)
		throw new Error('Windows Sandbox test job does not match.');
}
const npm = (...args) => [process.execPath, process.env.npm_execpath, ...args];
const node = (...args) => [process.execPath, ...args];
const tests = (suffix) =>
	readdirSync(join(project, 'tests'))
		.filter((name) => name.endsWith(suffix))
		.sort()
		.map((name) => `tests/${name}`);
const unit = () => [npm('run', 'build:mcp'), node('--test', ...tests('.test.mjs'))];
const web = () => [
	npm('run', 'build'),
	node(
		'--test',
		...tests('.integration.mjs').filter(
			(path) =>
				!path.endsWith('/cloudflare.integration.mjs') &&
				!path.endsWith('/files.large.integration.mjs')
		),
		'tests/access.browser.mjs'
	)
];
const commands = {
	check: () => [
		npm('run', 'check:release'),
		npm('run', 'check:scripts'),
		npm('run', 'extensions:generate'),
		node('node_modules/@sveltejs/kit/svelte-kit.js', 'sync'),
		node('node_modules/svelte-check/bin/svelte-check', '--tsconfig', './tsconfig.json')
	],
	unit,
	contracts: () => [
		node('--test', 'tests/application.test.mjs', 'tests/application-contract.test.mjs')
	],
	cloudflare: () => [node('--test', 'tests/cloudflare.integration.mjs')],
	web,
	beta: () => [
		...(windowsGuest && !existsSync(join(project, 'build', 'index.js'))
			? [npm('run', 'build')]
			: []),
		node('scripts/review-documents.mjs')
	],
	large: () => [node('--max-old-space-size=128', '--test', 'tests/files.large.integration.mjs')],
	verify: () => [
		npm('run', 'lint'),
		...commands.check(),
		...unit(),
		...commands.cloudflare(),
		...web(),
		...commands.beta()
	],
	'--': () => [extra[0] === 'npm' && process.env.npm_execpath ? npm(...extra.slice(1)) : extra]
};

if (!Object.hasOwn(commands, task) || (task === '--' && !extra.length)) {
	console.error(
		'Use npm test, npm run test:<suite>, npm run verify, or node tests/run.mjs -- <command> [args].'
	);
	process.exit(1);
}
if (task !== '--' && !process.env.npm_execpath) {
	console.error('Run named suites through npm, or use -- followed by an explicit test command.');
	process.exit(1);
}

const platform = process.platform;
const sandbox = ['darwin', 'linux'].includes(platform);
const protectedRoots = personalInstallationRoots();
// Check before any mkdir: TMPDIR may itself have been inherited from an installation.
assertOutsideProtectedRoots(tmpdir(), protectedRoots);
assertOutsideProtectedRoots(project, protectedRoots);
if (platform === 'linux' || (platform === 'win32' && !windowsGuest))
	assertDisjointFromProtectedRoots(project, protectedRoots);
const scratch = mkdtempSync(join(tmpdir(), 'saturday-test-run-'));
assertDisjointFromProtectedRoots(scratch, protectedRoots);
const work = join(scratch, 'work');
const fictional = join(scratch, 'fictional personal installation');
mkdirSync(work);
mkdirSync(fictional);
const sentinel = join(fictional, 'sentinel.txt');
const sentinelText = 'Fictional personal files must remain untouched.\n';
writeFileSync(sentinel, sentinelText);
const env = isolatedEnvironment(process.env, work, project);
const hidden = join(scratch, 'hidden');
if (platform === 'linux') {
	mkdirSync(hidden, { mode: 0 });
	for (const name of ['home', 'tmp', 'cache', 'config', 'data', 'npm-cache'])
		mkdirSync(join(work, name));
	Object.assign(env, {
		HOME: join(work, 'home'),
		TMPDIR: join(work, 'tmp'),
		TMP: join(work, 'tmp'),
		TEMP: join(work, 'tmp'),
		XDG_CACHE_HOME: join(work, 'cache'),
		XDG_CONFIG_HOME: join(work, 'config'),
		XDG_DATA_HOME: join(work, 'data'),
		npm_config_cache: join(work, 'npm-cache'),
		PUPPETEER_CACHE_DIR:
			process.env.PUPPETEER_CACHE_DIR || join(userInfo().homedir, '.cache', 'puppeteer')
	});
	assertOutsideProtectedRoots(env.PUPPETEER_CACHE_DIR, protectedRoots);
}
if (sandbox) {
	env.SATURDAY_TEST_PROTECTED_FIXTURE = fictional;
	// Chrome retains the enclosing OS filesystem boundary instead of attempting
	// its own nested OS sandbox, which some sandbox hosts cannot initialize.
	const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
	const browser = join(work, 'test-chrome');
	writeFileSync(
		browser,
		[
			'#!/bin/sh',
			'unset PUPPETEER_EXECUTABLE_PATH',
			`chrome_path=$(${quote(process.execPath)} ${quote(join(project, 'tests/helpers/test-chrome-path.mjs'))}) || exit $?`,
			'exec "$chrome_path" --no-sandbox "$@"',
			''
		].join('\n'),
		{ mode: 0o700 }
	);
	env.PUPPETEER_EXECUTABLE_PATH = browser;
}
const profile = platform === 'darwin' ? macSandboxProfile([...protectedRoots, fictional]) : null;
let active;
let interrupted = false;
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'])
	process.on(signal, () => {
		interrupted = true;
		abort.abort();
		active?.kill(signal);
	});

console.log(`Test workspace: ${work}`);
if (sandbox)
	console.log(
		`${platform === 'darwin' ? 'macOS sandbox' : 'Linux Bubblewrap'}: personal Saturday installations are inaccessible to checks and their children.`
	);
try {
	if (platform === 'win32' && !windowsGuest) {
		process.exitCode = await runWindowsSandbox({
			project,
			scratch,
			roots: protectedRoots,
			task,
			extra,
			signal: abort.signal
		});
	} else
		for (const command of commands[task]()) {
			const [executable, ...args] =
				platform === 'darwin'
					? ['/usr/bin/sandbox-exec', '-p', profile, ...command]
					: platform === 'linux'
						? linuxSandboxCommand({
								project,
								scratch,
								hidden,
								roots: protectedRoots,
								fixtures: [fictional],
								command
							})
						: command;
			const code = await new Promise((resolve, reject) => {
				active = spawn(executable, args, { cwd: project, env, stdio: 'inherit' });
				active.once('error', reject);
				active.once('exit', (code) => resolve(code ?? 1));
			});
			active = null;
			if (readFileSync(sentinel, 'utf8') !== sentinelText)
				throw new Error('Test isolation sentinel changed.');
			if (code !== 0 || interrupted) {
				process.exitCode = code || 1;
				break;
			}
		}
} catch (error) {
	console.error(
		`Checks stopped: ${error.message}${platform === 'linux' ? ' Protected Linux tests require Bubblewrap (bwrap) and permitted user/mount namespaces; there is no unprotected fallback.' : ''}`
	);
	process.exitCode = 1;
} finally {
	// Never fall back to an unguarded command when sandbox-exec is unavailable/denied.
	if (platform === 'linux') chmodSync(hidden, 0o700);
	try {
		rmSync(scratch, { recursive: true, force: true });
	} catch (error) {
		console.error(`Temporary test evidence retained at ${scratch}: ${error.message}`);
		process.exitCode = 1;
	}
}
