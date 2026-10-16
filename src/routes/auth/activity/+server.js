import { json } from '@sveltejs/kit';
import { sameOrigin } from '$lib/server/access-settings.js';
export function POST(event) {
	if (!sameOrigin(event))
		return json({ error: 'Cross-origin activity is not allowed.' }, { status: 403 });
	return new Response(null, { status: 204 });
}
