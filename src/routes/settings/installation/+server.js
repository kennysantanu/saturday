import { json } from '@sveltejs/kit';
import { operationStatus } from '$lib/server/installation-operations.js';
import { validServerSession } from '$lib/server/server-lifecycle.js';
export function GET({ cookies, url }) {
	if (
		url.origin !== process.env.ORIGIN ||
		!validServerSession(cookies.get('saturday-server-session'))
	)
		return json({ error: 'Use the local installation session.' }, { status: 403 });
	return json(operationStatus(), { headers: { 'cache-control': 'no-store' } });
}
