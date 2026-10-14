import {
	startServer,
	controlServer,
	serverSummary,
	runSupervisor
} from '../src/lib/server/server-lifecycle.js';
import { loginStartupStatus, setLoginStartup } from '../src/lib/server/installation.js';
const args = process.argv.slice(2);
const descriptorIndex = args.indexOf('--installation');
if (descriptorIndex >= 0) {
	const path = args[descriptorIndex + 1];
	if (!path || path.startsWith('--')) throw new Error('--installation requires a descriptor path.');
	for (const name of [
		'SATURDAY_PROJECT_ROOT',
		'SATURDAY_DB_PATH',
		'SATURDAY_FILES_PATH',
		'SATURDAY_EXTENSION_STATE_PATH',
		'SATURDAY_EXTENSIONS_PATH'
	])
		delete process.env[name];
	process.env.SATURDAY_INSTALLATION_PATH = path;
	args.splice(descriptorIndex, 2);
}
const json = args.includes('--json');
try {
	if (args[0] === '--supervise') {
		await runSupervisor(Number(args[1]));
	} else {
		const action = args.find((a) => !a.startsWith('--')) ?? 'start';
		if (
			args.some(
				(a) =>
					a.startsWith('--') &&
					!['--json', '--background', '--open', '--enable', '--disable'].includes(a)
			) ||
			!['start', 'open', 'stop', 'restart', 'login'].includes(action)
		)
			throw new Error('Use start/open/stop/restart, or login with --enable/--disable and --json.');
		if (
			(args.includes('--enable') && args.includes('--disable')) ||
			(action !== 'login' && (args.includes('--enable') || args.includes('--disable')))
		)
			throw new Error('--enable/--disable apply only to login and are mutually exclusive.');
		const result =
			action === 'login'
				? args.includes('--enable') || args.includes('--disable')
					? await setLoginStartup(args.includes('--enable'))
					: await loginStartupStatus()
				: ['stop', 'restart'].includes(action)
					? await controlServer(action)
					: await startServer({ open: action === 'open' || args.includes('--open') });
		if (action === 'login' && !result.available) throw new Error(result.error);
		if (json) console.log(JSON.stringify({ ok: true, ...result }));
		else
			console.log(
				`${action === 'login' ? `Login startup ${result.available ? (result.enabled ? 'enabled' : 'disabled') : 'unavailable'}` : action === 'stop' ? 'Stopping' : action === 'restart' ? 'Restarting' : 'Saturday is ready'}${result.url ? ` at ${result.url}` : ''}.`
			);
		if (
			action === 'start' &&
			!args.includes('--background') &&
			!args.includes('--open') &&
			!json &&
			result.created
		) {
			console.log('Press Ctrl-C to stop this server. Use npm run open for background use.');
			const stop = async () => {
				try {
					await controlServer('stop');
					const deadline = Date.now() + 15000;
					while (serverSummary().managed && Date.now() < deadline)
						await new Promise((res) => setTimeout(res, 100));
				} catch (e) {
					console.error(`Server stop was not completed: ${e.message}`);
					process.exit(1);
				}
				process.exit(0);
			};
			process.once('SIGINT', stop);
			process.once('SIGTERM', stop);
			while (serverSummary().managed) await new Promise((res) => setTimeout(res, 250));
		}
	}
} catch (e) {
	if (json)
		console.log(
			JSON.stringify({ ok: false, error: { code: e.code ?? 'SERVER_FAILED', message: e.message } })
		);
	else console.error(e.message);
	process.exitCode = 1;
}
