import { tagPickerData, tagFormValues, tagFormFailure } from '$lib/server/tag-forms.js';
import { redirect } from '@sveltejs/kit';
import { createNetwork, getJob } from '$lib/server/application.js';
import { ValidationError } from '$lib/server/validation.js';
import { jobReturn, jobDetailUrl } from '$lib/job-navigation.js';
async function findJob(id) {
	if (!id) return null;
	try {
		return await getJob(id);
	} catch (e) {
		if (e instanceof ValidationError) return null;
		throw e;
	}
}
export async function load({ url }) {
	const jobId = url.searchParams.get('job_id');
	const job = await findJob(jobId);
	return {
		tagOptions: await tagPickerData('person'),
		returnTo: jobReturn(url.searchParams.get('return_to')),
		job: job ? { id: job.id, title: job.title, company: job.company } : null,
		missingJob: !!jobId && !job
	};
}
export const actions = {
	default: async ({ request, url }) => {
		const values = tagFormValues(await request.formData());
		let person;
		try {
			person = await createNetwork(values);
		} catch (e) {
			return tagFormFailure(e, 'person', values, 'Saturday could not save this person. Try again.');
		}
		const jobId = url.searchParams.get('job_id');
		if (jobId && (await findJob(jobId))) {
			const destination = new URL(
				jobDetailUrl(jobId, url.searchParams.get('return_to'), 'person'),
				url
			);
			destination.searchParams.set('link_person', '1');
			destination.searchParams.set('person', String(person.id));
			redirect(303, destination.pathname + destination.search);
		}
		redirect(303, `/networks/${person.id}?saved=person${jobId ? '&missing_job=1' : ''}`);
	}
};
