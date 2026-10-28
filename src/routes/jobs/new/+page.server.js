import { tagPickerData, tagFormValues, tagFormFailure } from '$lib/server/tag-forms.js';
import { jobReturn, jobDetailUrl } from '$lib/job-navigation.js';
export async function load({ url }) {
	return {
		tagOptions: await tagPickerData('job'),
		returnTo: jobReturn(url.searchParams.get('return_to'))
	};
}
import { redirect } from '@sveltejs/kit';
import { createJob } from '$lib/server/application.js';
export const actions = {
	default: async ({ request, url }) => {
		const values = tagFormValues(await request.formData());
		let job;
		try {
			job = await createJob(values);
		} catch (error) {
			return tagFormFailure(error, 'job', values, 'Saturday could not save this job. Try again.');
		}
		redirect(303, jobDetailUrl(job.id, url.searchParams.get('return_to'), 'job'));
	}
};
