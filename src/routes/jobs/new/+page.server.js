import { fail, redirect } from '@sveltejs/kit';
import { createJob, ServiceError, ValidationError } from '$lib/server/services.js';

function formValues(formData) {
	return Object.fromEntries(
		Array.from(formData.entries(), ([key, value]) => [key, typeof value === 'string' ? value : ''])
	);
}

export const actions = {
	default: async ({ request }) => {
		const values = formValues(await request.formData());
		let job;
		try {
			job = createJob(values, 'manual');
		} catch (error) {
			if (error instanceof ValidationError) return fail(400, { errors: error.fieldErrors, values });
			if (error instanceof ServiceError)
				return fail(400, { errors: { form: error.message }, values });
			console.error('Could not save job:', error);
			return fail(500, {
				errors: { form: 'Saturday could not save this job. Try again.' },
				values
			});
		}
		redirect(303, `/jobs/${job.id}?saved=job`);
	}
};
