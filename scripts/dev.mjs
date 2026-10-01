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

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => child.kill(signal));
}
child.on('exit', (code) => process.exit(code ?? 0));
