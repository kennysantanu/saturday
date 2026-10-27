import { tagPickerData, tagFormValues, tagFailureSelection } from '$lib/server/tag-forms.js';
import { fail, redirect } from '@sveltejs/kit';
import { createNetwork, getJob } from '$lib/server/application.js';
import { ValidationError, ServiceError } from '$lib/server/validation.js';
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
			console.error('Could not save person:', e);
			return fail(500, {
				errors: { form: 'Saturday could not save this person. Try again.' },
				values
			});
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
