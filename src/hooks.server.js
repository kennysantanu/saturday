import { withServerActivity, commitServerControl } from '$lib/server/server-lifecycle.js';
import { registerExtensionRuntime } from '$lib/server/extensions.js';
// Record web startup even before the first request. Stale PID leases are reclaimed offline.
export async function init() {
	try {
		await registerExtensionRuntime();
	} catch (e) {
		console.error(`Extension runtime registration failed: ${e.message}`);
	}
}

export async function handle({ event, resolve }) {
	if (
		process.env.SATURDAY_SERVER_TOKEN &&
		event.url.origin === process.env.ORIGIN &&
		event.request.method === 'GET'
	)
		event.cookies.set('saturday-server-session', process.env.SATURDAY_SERVER_TOKEN, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: false
		});
	if (
		!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method) &&
		[...event.url.searchParams.keys()].find((key) => key.startsWith('/')) !== '/serverControl'
	) {
		try {
			return await withServerActivity(() => resolve(event));
		} catch (e) {
			if (e.code === 'BUSY')
				return new Response('Saturday is stopping or restarting. Retry when ready.', {
					status: 409
				});
			throw e;
		}
	}
	const response = await resolve(event);
	const generation = response.headers.get('x-saturday-server-operation');
	if (!generation || !response.body) return response;
	const reader = response.body.getReader();
	return new Response(
		new ReadableStream({
			async pull(controller) {
				const result = await reader.read();
				if (result.done) {
					controller.close();
					setTimeout(
						() =>
							void commitServerControl(generation).catch((e) =>
								console.error('Server operation was not committed:', e.message)
							),
						10
					);
				} else controller.enqueue(result.value);
			},
			cancel(reason) {
				return reader.cancel(reason);
			}
		}),
		{ status: response.status, headers: response.headers }
	);
}
