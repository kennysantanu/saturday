import {
	getInstallation,
	installationEnvironment,
	assertInstallationStorage
} from '../src/lib/server/installation.js';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
// Developer preview is loopback-only; apply LAN preferences through Open Saturday.
process.env.SATURDAY_RUNNING_ALLOW_LAN = 'false';

const installation = getInstallation();
assertInstallationStorage();
const root = installation.code_root;
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(installation.node_path, [vite, 'dev', '--host', '127.0.0.1'], {
	cwd: root,
	stdio: 'inherit',
	env: { ...installationEnvironment(installation), SATURDAY_PROJECT_ROOT: root }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		child.kill(signal);
	});
}
child.on('exit', (code) => process.exit(code ?? 0));
