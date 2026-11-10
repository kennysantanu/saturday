// Only a disposable copy is shared into this fresh Windows Sandbox guest.
import { readFile, cp, writeFile, rename, readdir } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { userInfo, tmpdir } from 'node:os';
import { join } from 'node:path';

const input = 'C:\\SaturdayTestInput';
const output = 'C:\\SaturdayTestOutput';
const project = 'C:\\SaturdayTestWork\\source';
if (process.platform !== 'win32' || userInfo().username.toLowerCase() !== 'wdagutilityaccount')
	throw new Error('This helper must run inside Windows Sandbox.');
const job = JSON.parse(await readFile(`${input}\\job.json`, 'utf8'));
const log = createWriteStream(`${output}\\tests.log`);
let code = 1,
	error;
try {
	await cp(`${input}\\source`, project, { recursive: true });
	const env = {
		...process.env,
		npm_execpath: `${input}\\node\\node_modules\\npm\\bin\\npm-cli.js`,
		SATURDAY_TEST_WINDOWS_SANDBOX: job.token
	};
	if (existsSync(`${input}\\chrome`)) env.PUPPETEER_CACHE_DIR = `${input}\\chrome`;
	const child = spawn(
		process.execPath,
		['tests/run.mjs', '--windows-sandbox', job.task, ...job.extra],
		{ cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] }
	);
	child.stdout.pipe(log, { end: false });
	child.stderr.pipe(log, { end: false });
	code = await new Promise((done, fail) => {
		child.once('error', fail);
		child.once('close', (status) => done(status ?? 1));
	});
} catch (failure) {
	error = failure.message;
}
try {
	for (const name of await readdir(tmpdir())) {
		if (name.startsWith('saturday-documents-ui-'))
			await cp(join(tmpdir(), name), `${output}\\${name}`, { recursive: true });
	}
} catch (failure) {
	code = 1;
	error = `Could not retain test evidence: ${failure.message}`;
}
await new Promise((done) => log.end(done));
await writeFile(`${output}\\result.pending`, JSON.stringify({ token: job.token, code, error }));
await rename(`${output}\\result.pending`, `${output}\\result.json`);
// Power off this disposable VM after the host has a durable result.
spawn('shutdown.exe', ['/s', '/t', '0'], { stdio: 'ignore' });
