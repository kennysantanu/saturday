import { error, fail, redirect } from '@sveltejs/kit';
import { getNetwork, editNetwork } from '$lib/server/networks.js';
import { ValidationError, ServiceError } from '$lib/server/validation.js';
import { networkEditReturn } from '$lib/network-navigation.js';
export function load({ params, url }) {
	try {
		return {
			person: getNetwork(params.id),
			back: networkEditReturn(url.searchParams.get('return_to'), params.id)
		};
	} catch (e) {
		if (e instanceof ServiceError || e instanceof ValidationError) error(404, 'Person not found');
		throw e;
	}
}
export const actions = {
	default: async ({ request, params, url }) => {
		const values = Object.fromEntries(
			Array.from((await request.formData()).entries(), ([key, value]) => [
				key,
				typeof value === 'string' ? value : ''
			])
		);
		try {
			editNetwork(params.id, values);
		} catch (e) {
			if (e instanceof ValidationError) return fail(400, { errors: e.fieldErrors, values });
			if (e instanceof ServiceError) return fail(400, { errors: { form: e.message }, values });
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
