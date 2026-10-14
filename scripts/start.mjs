import {
	getInstallation,
	installationEnvironment,
	assertInstallationStorage
} from '../src/lib/server/installation.js';
// Starts the production web server bound to loopback only.
// Usage: npm run start   (PORT overrides the default 3000)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const installation = getInstallation();
assertInstallationStorage();
const root = installation.code_root;
const entry = join(root, 'build', 'index.js');

if (!existsSync(entry)) {
	console.error('Saturday is not built yet. Run "npm run build" first.');
	process.exit(1);
}

const host = '127.0.0.1';
const port = process.env.PORT || String(installation.port);

console.log(`Starting Saturday at http://${host}:${port}`);
console.log('Press Ctrl-C to stop.');

const child = spawn(installation.node_path, [entry], {
	cwd: root,
	stdio: 'inherit',
	env: {
		...installationEnvironment(installation),
		HOST: host,
		PORT: port,
		ORIGIN: `http://${host}:${port}`,
		BODY_SIZE_LIMIT: 'Infinity',
		SATURDAY_PROJECT_ROOT: root
	}
});

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.on(signal, () => {
		child.kill(signal);
	});
}
child.on('exit', (code) => process.exit(code ?? 0));
