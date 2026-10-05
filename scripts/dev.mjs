import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(process.execPath, [vite, 'dev', '--host', '127.0.0.1'], {
	cwd: root,
	stdio: 'inherit',
	env: { ...process.env, SATURDAY_PROJECT_ROOT: root }
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
