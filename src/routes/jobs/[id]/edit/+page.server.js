import { tagPickerData, tagFormValues, tagFailureSelection } from '$lib/server/tag-forms.js';
import { jobReturn, jobDetailUrl } from '$lib/job-navigation.js';
import { error, fail, redirect } from '@sveltejs/kit';
import { editJob, getJob } from '$lib/server/application.js';
import { ServiceError, ValidationError } from '$lib/domain/validation.js';
export async function load({ params, url }) {
	let job;
	try {
		job = await getJob(params.id);
	} catch (e) {
		if (e instanceof ValidationError) error(404, 'Job not found');
		throw e;
	}
	if (!job) error(404, 'Job not found');
	return {
		tagOptions: await tagPickerData(
			'job',
			job.tags.map((tag) => tag.id)
		),
		job,
		returnTo: jobReturn(url.searchParams.get('return_to'))
	};
}
export const actions = {
	default: async ({ params, request, url }) => {
		const data = await request.formData();
		const values = tagFormValues(data);
		try {
			await editJob(params.id, values);
		} catch (error) {
			if (error instanceof ValidationError)
				return fail(400, {
					errors: error.fieldErrors,
					tagSelection: await tagFailureSelection('job', values),
					values
				});
			if (error instanceof ServiceError)
				return fail(400, {
					errors: { form: error.message },
					tagSelection: await tagFailureSelection('job', values),
					values
				});
			console.error('Could not edit job:', error);
			return fail(500, {
				errors: { form: 'Saturday could not save these changes. Try again.' },
				values
			});
		}
		redirect(303, jobDetailUrl(params.id, url.searchParams.get('return_to'), 'job'));
	}
};
