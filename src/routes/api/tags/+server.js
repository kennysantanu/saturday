import { json } from '@sveltejs/kit';
import * as tags from '$lib/server/application.js';
import { sameOrigin } from '$lib/server/access-settings.js';
import { ServiceError, ValidationError } from '$lib/server/validation.js';
function failure(error) {
	if (error instanceof SyntaxError)
		return json({ error: 'Send a valid JSON tag request.' }, { status: 400 });
	if (error instanceof ValidationError)
		return json(
			{ error: error.message, errors: error.fieldErrors, existingTag: error.existingTag },
			{ status: 400 }
		);
	if (error instanceof ServiceError)
		return json({ error: error.message }, { status: error.code === 'not_found' ? 404 : 400 });
	console.error('Tag request failed:', error);
	return json({ error: 'Tags are unavailable. Try again.' }, { status: 500 });
}
export async function GET({ url }) {
	try {
		return json({
			...(await tags.listTags(Object.fromEntries(url.searchParams))),
			selectedTags: await tags.getTagSelection({
				collection: url.searchParams.get('collection'),
				tag_ids: url.searchParams.getAll('selected')
			})
		});
	} catch (error) {
		return failure(error);
	}
}
export async function POST(event) {
	if (!sameOrigin(event))
		return json({ error: 'Use Saturday’s own page to change tags.' }, { status: 403 });
	const operations = {
		create: tags.createTag,
		edit: tags.editTag,
		delete: tags.deleteTag,
		merge: tags.mergeTags,
		assign: tags.setTagAssignments
	};
	try {
		const input = await event.request.json();
		if (!input || typeof input !== 'object' || !Object.hasOwn(operations, input.action))
			return json({ error: 'Unknown tag action.' }, { status: 400 });
		return json(await operations[input.action](input));
	} catch (error) {
		return failure(error);
	}
}
