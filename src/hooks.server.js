import { registerExtensionRuntime } from '$lib/server/extensions.js';
// Record web startup even before the first request. Stale PID leases are reclaimed offline.
export async function init() {
	try {
		await registerExtensionRuntime();
	} catch (e) {
		console.error(`Extension runtime registration failed: ${e.message}`);
	}
}
