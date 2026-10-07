import { error, fail, redirect } from '@sveltejs/kit';
import { getNetwork, editNetwork } from '$lib/server/networks.js';
import { ValidationError, ServiceError } from '$lib/server/validation.js';
export function load({ params }) {
	try {
		return { person: getNetwork(params.id) };
	} catch (e) {
		if (e instanceof ServiceError || e instanceof ValidationError) error(404, 'Person not found');
		throw e;
	}
}
export const actions = {
	default: async ({ request, params }) => {
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
		redirect(303, `/networks/${params.id}?saved=person`);
	}
};
