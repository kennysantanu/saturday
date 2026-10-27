import { tagPickerData, tagFormValues, tagFailureSelection } from '$lib/server/tag-forms.js';
import { error, fail, redirect } from '@sveltejs/kit';
import { getNetwork, editNetwork } from '$lib/server/application.js';
import { ValidationError, ServiceError } from '$lib/server/validation.js';
import { networkEditReturn } from '$lib/network-navigation.js';
export async function load({ params, url }) {
	try {
		return {
			person: await getNetwork(params.id),
			tagOptions: await tagPickerData(
				'person',
				(await getNetwork(params.id)).tags.map((tag) => tag.id)
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
			if (e instanceof ValidationError)
				return fail(400, {
					errors: e.fieldErrors,
					tagSelection: await tagFailureSelection('person', values),
					values
				});
			if (e instanceof ServiceError)
				return fail(400, {
					errors: { form: e.message },
					tagSelection: await tagFailureSelection('person', values),
					values
				});
			console.error('Could not edit person:', e);
			return fail(500, {
				errors: { form: 'Saturday could not save this person. Try again.' },
				values
			});
		}
		const back = new URL(networkEditReturn(url.searchParams.get('return_to'), params.id), url);
		back.searchParams.set('saved', 'person');
		redirect(303, back.pathname + back.search);
	}
};
