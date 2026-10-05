// Starts the production web server bound to loopback only.
// Usage: npm run start   (PORT overrides the default 3000)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'build', 'index.js');

if (!existsSync(entry)) {
	console.error('Saturday is not built yet. Run "npm run build" first.');
	process.exit(1);
}

const host = '127.0.0.1';
const port = process.env.PORT || '3000';

console.log(`Starting Saturday at http://${host}:${port}`);
console.log('Press Ctrl-C to stop.');

const child = spawn(process.execPath, [entry], {
	cwd: root,
	stdio: 'inherit',
	env: {
		...process.env,
		HOST: host,
		PORT: port,
		ORIGIN: `http://${host}:${port}`,
		BODY_SIZE_LIMIT: String(101 * 1024 * 1024),
		SATURDAY_PROJECT_ROOT: root
	}
});

const worker = spawn(process.execPath, [join(root, 'scripts', 'backup-worker.mjs')], {
	cwd: root,
	stdio: ['ignore', 'ignore', 'inherit'],
	env: { ...process.env, SATURDAY_PROJECT_ROOT: root }
});
worker.on('error', (error) => console.error(`Automatic backups could not start: ${error.message}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		child.kill(signal);
		worker.kill(signal);
	});
}
child.on('exit', (code) => {
	worker.kill('SIGTERM');
	worker.once('exit', () => process.exit(code ?? 0));
	if (worker.exitCode !== null || worker.signalCode !== null) process.exit(code ?? 0);
});
