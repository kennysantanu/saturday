import { redirect } from '@sveltejs/kit';

export function settled(event, payload, location) {
	const accept = event.request.headers.get('accept') ?? '';
	// Action POSTs are never data requests; the Accept header distinguishes enhanced submits.
	if (event.isDataRequest || /\bapplication\/json\b/i.test(accept)) return payload;
	redirect(303, location);
}
