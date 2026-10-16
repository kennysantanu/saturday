import { accessCookieName, localBrowser } from '$lib/server/access-settings.js';
import { json } from '@sveltejs/kit';
import { operationStatus } from '$lib/server/installation-operations.js';
import { validServerSession } from '$lib/server/server-lifecycle.js';
export function GET(event) {
	const { cookies } = event;
	if (!localBrowser(event) || !validServerSession(cookies.get(accessCookieName('control'))))
		return json({ error: 'Use the local installation session.' }, { status: 403 });
	return json(operationStatus(), { headers: { 'cache-control': 'no-store' } });
}
