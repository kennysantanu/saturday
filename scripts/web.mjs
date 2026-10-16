// Production HTTP entry: dynamic literal-IP origins with trusted, socket-based identity.
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getInstallation } from '../src/lib/server/installation.js';
import { initializeAccessSettings } from '../src/lib/server/access-settings.js';
import { allowedRequestHost } from '../src/lib/server/access-network.js';
const settings = await initializeAccessSettings();
const allowLan =
	process.env.SATURDAY_RUNNING_ALLOW_LAN === undefined
		? settings.allow_lan
		: process.env.SATURDAY_RUNNING_ALLOW_LAN === 'true';
const port = Number(process.env.PORT || getInstallation().port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port.');
for (const key of ['ORIGIN', 'ADDRESS_HEADER', 'HOST_HEADER', 'PORT_HEADER', 'XFF_DEPTH'])
	delete process.env[key];
process.env.PROTOCOL_HEADER = 'x-saturday-protocol';
process.env.SATURDAY_RUNNING_ALLOW_LAN = String(allowLan);
process.env.SATURDAY_LOCAL_ORIGIN = `http://127.0.0.1:${port}`;
process.env.BODY_SIZE_LIMIT = 'Infinity';
const { handler } = await import(
	pathToFileURL(join(getInstallation().code_root, 'build/handler.js')).href
);
const server = createServer((request, response) => {
	if (!allowedRequestHost(request.headers.host, port, allowLan)) {
		response.writeHead(421, { 'cache-control': 'no-store' });
		response.end('Use Saturday’s local or displayed phone address.');
		return;
	}
	// This value is overwritten on every request, including forged proxy requests.
	request.headers['x-saturday-protocol'] = 'http';
	for (const key of [
		'forwarded',
		'x-forwarded-for',
		'x-forwarded-host',
		'x-forwarded-proto',
		'x-forwarded-port'
	])
		delete request.headers[key];
	handler(request, response);
});
server.listen(port, allowLan ? '0.0.0.0' : '127.0.0.1', () =>
	console.log(`Listening on http://${allowLan ? '0.0.0.0' : '127.0.0.1'}:${port}`)
);
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'])
	process.on(signal, () => {
		if (closing) return;
		closing = true;
		const timeout = setTimeout(() => {
			server.closeAllConnections();
			process.exit(0);
		}, 7000);
		timeout.unref();
		server.close(() => {
			clearTimeout(timeout);
			process.exit(0);
		});
		server.closeIdleConnections();
	});
