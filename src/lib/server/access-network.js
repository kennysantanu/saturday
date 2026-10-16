// Literal interface addresses only. Never trust forwarded headers for origin or locality.
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
export function phoneAddresses(port, interfaces = networkInterfaces()) {
	return Object.entries(interfaces)
		.flatMap(([name, entries]) =>
			(entries ?? [])
				.filter((entry) => !entry.internal && isIP(entry.address) === 4)
				.map((entry) => ({
					interface: name,
					address: entry.address,
					url: `http://${entry.address}:${port}`,
					virtual: /^(utun|tun|tap|wg|tailscale|docker|veth|virbr|bridge|vmnet)/i.test(name)
				}))
		)
		.sort(
			(a, b) => Number(a.virtual) - Number(b.virtual) || a.interface.localeCompare(b.interface)
		);
}
export function allowedRequestHost(host, port, allowLan, interfaces) {
	if (typeof host !== 'string' || /[\s/\\@?#]/.test(host)) return false;
	try {
		const url = new URL(`http://${host}`);
		if (Number(url.port || 80) !== port) return false;
		return (
			['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
			(allowLan && phoneAddresses(port, interfaces).some((entry) => entry.address === url.hostname))
		);
	} catch {
		return false;
	}
}
