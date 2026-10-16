import { building } from '$app/environment';
import { withServerActivity, commitServerControl } from '$lib/server/server-lifecycle.js';
import {
	initializeAccessSettings,
	readAccessSettings,
	accessCookieName,
	localBrowser,
	sameOrigin,
	safeReturnPath
} from '$lib/server/access-settings.js';
import { validLogin } from '$lib/server/access-auth.js';
import { registerExtensionRuntime } from '$lib/server/extensions.js';
import { allowedRequestHost } from '$lib/server/access-network.js';
let runtimeUnavailable = false;
// Record web startup even before the first request. Stale PID leases are reclaimed offline.
export async function init() {
	if (building) return;
	try {
		await initializeAccessSettings();
	} catch {
		console.error('Sign-in settings need local access recovery.');
	}
	try {
		await registerExtensionRuntime('web');
	} catch (e) {
		runtimeUnavailable = true;
		console.error(`Extension runtime registration failed: ${e.message}`);
	}
}

export async function handle({ event, resolve }) {
	if (runtimeUnavailable)
		return new Response('Saturday startup was blocked. Finish maintenance, then reopen Saturday.', {
			status: 503,
			headers: { 'cache-control': 'no-store' }
		});
	let settings;
	try {
		settings = readAccessSettings();
	} catch {
		return new Response(
			'Sign-in settings are unavailable. Use local access recovery; career records are preserved.',
			{ status: 503, headers: { 'cache-control': 'no-store' } }
		);
	}
	const path = event.url.pathname;
	if (
		!allowedRequestHost(
			event.request.headers.get('host'),
			Number(event.url.port || (event.url.protocol === 'https:' ? 443 : 80)),
			process.env.SATURDAY_RUNNING_ALLOW_LAN === 'true'
		)
	)
		return new Response('Use Saturday’s local or displayed phone address.', {
			status: 421,
			headers: { 'cache-control': 'no-store' }
		});
	const local = localBrowser(event);
	const passive =
		path === '/auth/session' || path === '/health' || path === '/settings/installation';
	const navigation =
		event.request.method === 'GET' &&
		event.request.headers.get('accept')?.includes('text/html') &&
		event.request.headers.get('sec-purpose') !== 'prefetch';
	const activity =
		!passive &&
		(path === '/auth/activity'
			? sameOrigin(event)
			: navigation || (event.request.method === 'POST' && sameOrigin(event)));
	const authenticated = validLogin(event, settings, activity);
	event.locals.access = {
		password_enabled: Boolean(settings.password),
		authenticated,
		idle_timeout_seconds: settings.idle_timeout_seconds,
		local
	};
	event.setHeaders({ 'cache-control': 'no-store' });
	if (path === '/health' && !local) return new Response('Not found', { status: 404 });
	const publicRoute =
		path === '/signin' || path === '/auth/session' || (path === '/health' && local);
	if (settings.password && !authenticated && !publicRoute) {
		if (
			event.request.method === 'GET' &&
			!event.isDataRequest &&
			event.request.headers.get('accept')?.includes('text/html')
		)
			return new Response(null, {
				status: 303,
				headers: {
					location: `/signin?next=${encodeURIComponent(safeReturnPath(event.url.pathname + event.url.search))}`,
					'cache-control': 'no-store'
				}
			});
		return new Response(
			JSON.stringify({
				type: 'failure',
				status: 401,
				auth_required: true,
				error: 'Session expired — sign in, then retry.'
			}),
			{
				status: 401,
				headers: {
					'content-type': 'application/json',
					'cache-control': 'no-store',
					'x-saturday-auth': 'required'
				}
			}
		);
	}
	if (path === '/signin' && event.request.method === 'GET' && (!settings.password || authenticated))
		return new Response(null, {
			status: 303,
			headers: {
				location: safeReturnPath(event.url.searchParams.get('next')),
				'cache-control': 'no-store'
			}
		});
	if (process.env.SATURDAY_SERVER_TOKEN && local && authenticated && event.request.method === 'GET')
		event.cookies.set(accessCookieName('control'), process.env.SATURDAY_SERVER_TOKEN, {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: event.url.protocol === 'https:'
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
