import {
	startServer,
	controlServer,
	serverSummary,
	runSupervisor
} from '../src/lib/server/server-lifecycle.js';
const args = process.argv.slice(2),
	json = args.includes('--json');
try {
	if (args[0] === '--supervise') {
		await runSupervisor(Number(args[1]));
	} else {
		const action = args.find((a) => !a.startsWith('--')) ?? 'start';
		if (
			args.some((a) => a.startsWith('--') && !['--json', '--background', '--open'].includes(a)) ||
			!['start', 'open', 'stop', 'restart'].includes(action)
		)
			throw new Error('Use start/open/stop/restart with --json or --background.');
		const result = ['stop', 'restart'].includes(action)
			? await controlServer(action)
			: await startServer({ open: action === 'open' || args.includes('--open') });
		if (json) console.log(JSON.stringify({ ok: true, ...result }));
		else
			console.log(
				`${action === 'stop' ? 'Stopping' : action === 'restart' ? 'Restarting' : 'Saturday is ready'}${result.url ? ` at ${result.url}` : ''}.`
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
