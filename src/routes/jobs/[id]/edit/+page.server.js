import { tagPickerData, tagFormValues, tagFormFailure } from '$lib/server/tag-forms.js';
import { jobReturn, jobDetailUrl } from '$lib/job-navigation.js';
import { error, redirect } from '@sveltejs/kit';
import { editJob, getJob } from '$lib/server/application.js';
import { ValidationError } from '$lib/domain/validation.js';
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
			return tagFormFailure(
				error,
				'job',
				values,
				'Saturday could not save these changes. Try again.'
			);
		}
		redirect(303, jobDetailUrl(params.id, url.searchParams.get('return_to'), 'job'));
	}
};
