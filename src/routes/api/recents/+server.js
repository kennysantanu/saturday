import { json } from '@sveltejs/kit';
import { listRecentViews, recordRecentView } from '$lib/server/application.js';
import { sameOrigin } from '$lib/server/access-settings.js';
import { ServiceError, ValidationError } from '$lib/server/validation.js';

function failure(error) {
	if (error instanceof SyntaxError || error instanceof ValidationError)
		return json({ error: 'Send a valid recently viewed request.' }, { status: 400 });
	if (error instanceof ServiceError)
		return json({ error: error.message }, { status: error.code === 'not_found' ? 404 : 409 });
	console.error('Recently viewed request failed:', error);
	return json({ error: 'Recently viewed is unavailable. Try again.' }, { status: 500 });
}

export async function GET() {
	try {
		return json(await listRecentViews());
	} catch (error) {
		return failure(error);
	}
}

export async function POST(event) {
	if (!sameOrigin(event))
		return json({ error: 'Use Saturday’s own page to record a view.' }, { status: 403 });
	try {
		return json(await recordRecentView(await event.request.json()));
	} catch (error) {
		return failure(error);
	}
}
