import { tagPickerData, tagFormValues, tagFailureSelection } from '$lib/server/tag-forms.js';
import { jobReturn, jobDetailUrl } from '$lib/job-navigation.js';
export function load({ url }) {
	return {
		tagOptions: tagPickerData('job'),
		returnTo: jobReturn(url.searchParams.get('return_to'))
	};
}
import { fail, redirect } from '@sveltejs/kit';
import { createJob, ServiceError, ValidationError } from '$lib/server/services.js';

export const actions = {
	default: async ({ request, url }) => {
		const values = tagFormValues(await request.formData());
		let job;
		try {
			job = createJob(values, 'manual');
		} catch (error) {
			if (error instanceof ValidationError)
				return fail(400, {
					errors: error.fieldErrors,
					tagSelection: tagFailureSelection('job', values),
					values
				});
			if (error instanceof ServiceError)
				return fail(400, {
					errors: { form: error.message },
					tagSelection: tagFailureSelection('job', values),
					values
				});
			console.error('Could not save job:', error);
			return fail(500, {
				errors: { form: 'Saturday could not save this job. Try again.' },
				values
			});
		}
		redirect(303, jobDetailUrl(job.id, url.searchParams.get('return_to'), 'job'));
	}
};
