import { getInstallation, assertInstallationStorage } from '../src/lib/server/installation.js';
const json = process.argv.includes('--json');
try {
	const installation = getInstallation();
	assertInstallationStorage();
	const port = Number(process.env.PORT || installation.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error('Choose a valid server port.');
	const url = `http://127.0.0.1:${port}`;
	const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
	const result = await response.json();
	if (
		!response.ok ||
		result.app !== 'saturday' ||
		result.status !== 'ready' ||
		result.installation_id !== installation.installation_id ||
		typeof result.build?.id !== 'string'
	)
		throw new Error('The server does not identify this ready Saturday installation.');
	if (installation.build?.id && result.build.id !== installation.build.id)
		throw new Error(
			'The running build differs from this installation. Rebuild/restart with the matching setup.'
		);
	if (json) console.log(JSON.stringify({ ok: true, url, ...result }));
	else console.log(`Saturday is running at ${url} (${result.build.id}).`);
} catch (e) {
	if (json)
		console.log(JSON.stringify({ ok: false, error: { code: 'NOT_READY', message: e.message } }));
	else
		console.error(
			`Saturday is not ready: ${e.message}\nStart it with npm run start, or set PORT if you used another port.`
		);
	process.exitCode = 1;
}
