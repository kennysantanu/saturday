import { error, fail, redirect } from '@sveltejs/kit';
import { editJob, getJob, ServiceError, ValidationError } from '$lib/server/services.js';

export function load({ params }) {
	const job = getJob(params.id);
	if (!job) error(404, 'Job not found');
	return { job };
}

export const actions = {
	default: async ({ params, request }) => {
		const data = await request.formData();
		const values = Object.fromEntries(
			Array.from(data.entries(), ([key, value]) => [key, typeof value === 'string' ? value : ''])
		);
		try {
			editJob(params.id, values);
		} catch (error) {
			if (error instanceof ValidationError) return fail(400, { errors: error.fieldErrors, values });
			if (error instanceof ServiceError)
				return fail(400, { errors: { form: error.message }, values });
			console.error('Could not edit job:', error);
			return fail(500, {
				errors: { form: 'Saturday could not save these changes. Try again.' },
				values
			});
		}
		redirect(303, `/jobs/${params.id}?saved=job`);
	}
};
