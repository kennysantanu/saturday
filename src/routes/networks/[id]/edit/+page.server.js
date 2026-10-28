import { tagPickerData, tagFormValues, tagFormFailure } from '$lib/server/tag-forms.js';
import { error, redirect } from '@sveltejs/kit';
import { getNetwork, editNetwork } from '$lib/server/application.js';
import { ValidationError, ServiceError } from '$lib/server/validation.js';
import { networkEditReturn } from '$lib/network-navigation.js';
export async function load({ params, url }) {
	try {
		const person = await getNetwork(params.id);
		return {
			person,
			tagOptions: await tagPickerData(
				'person',
				person.tags.map((tag) => tag.id)
			),
			back: networkEditReturn(url.searchParams.get('return_to'), params.id)
		};
	} catch (e) {
		if (e instanceof ServiceError || e instanceof ValidationError) error(404, 'Person not found');
		throw e;
	}
}
export const actions = {
	default: async ({ request, params, url }) => {
		const values = tagFormValues(await request.formData());
		try {
			await editNetwork(params.id, values);
		} catch (e) {
			return tagFormFailure(e, 'person', values, 'Saturday could not save this person. Try again.');
		}
		const back = new URL(networkEditReturn(url.searchParams.get('return_to'), params.id), url);
		back.searchParams.set('saved', 'person');
		redirect(303, back.pathname + back.search);
	}
};
