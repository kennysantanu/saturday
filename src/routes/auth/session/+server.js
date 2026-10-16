import { json } from '@sveltejs/kit';
export function GET({ locals }) {
	return json(
		{
			authenticated: locals.access.authenticated,
			password_enabled: locals.access.password_enabled,
			idle_timeout_seconds: locals.access.idle_timeout_seconds
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
}
