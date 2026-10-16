import test from 'node:test';
import assert from 'node:assert/strict';
import { phoneAddresses, allowedRequestHost } from '../src/lib/server/access-network.js';
import { localBrowser } from '../src/lib/server/access-settings.js';
test('network addresses label VPN candidates, refresh interfaces, and reject arbitrary origins', () => {
	const interfaces = {
		lo: [{ address: '127.0.0.1', internal: true }],
		utun3: [{ address: '100.64.1.2', internal: false }],
		en0: [
			{ address: '192.168.1.10', internal: false },
			{ address: 'fe80::1', internal: false }
		]
	};
	const addresses = phoneAddresses(3123, interfaces);
	assert.deepEqual(
		addresses.map((a) => [a.url, a.virtual]),
		[
			['http://192.168.1.10:3123', false],
			['http://100.64.1.2:3123', true]
		]
	);
	for (const host of ['127.0.0.1:3123', 'localhost:3123', '[::1]:3123'])
		assert.equal(allowedRequestHost(host, 3123, false, interfaces), true);
	assert.equal(allowedRequestHost('192.168.1.10:3123', 3123, false, interfaces), false);
	assert.equal(allowedRequestHost('192.168.1.10:3123', 3123, true, interfaces), true);
	for (const host of [
		'evil.example:3123',
		'127.0.0.1:99',
		'192.168.1.11:3123',
		'evil@127.0.0.1:3123',
		'127.0.0.1:3123/x'
	])
		assert.equal(allowedRequestHost(host, 3123, true, interfaces), false);
	assert.deepEqual(phoneAddresses(3123, {}), []);
	assert.equal(allowedRequestHost('192.168.1.10:3123', 3123, true, {}), false);
	const event = {
		getClientAddress: () => '192.168.1.20',
		url: new URL('http://127.0.0.1:3123'),
		request: new Request('http://127.0.0.1:3123', { headers: { 'x-forwarded-for': '127.0.0.1' } })
	};
	assert.equal(
		localBrowser(event),
		false,
		'forged headers do not turn a remote socket into a local browser'
	);
});
