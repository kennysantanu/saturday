import { tagPickerData, tagFormValues, tagFailureSelection } from '$lib/server/tag-forms.js';
import { fail, redirect } from '@sveltejs/kit';
import { createNetwork } from '$lib/server/networks.js';
import { getJob } from '$lib/server/services.js';
import { ValidationError, ServiceError } from '$lib/server/validation.js';
import { jobReturn, jobDetailUrl } from '$lib/job-navigation.js';
function findJob(id) {
	if (!id) return null;
	try {
		return getJob(id);
	} catch (e) {
		if (e instanceof ValidationError) return null;
		throw e;
	}
}
export function load({ url }) {
	const jobId = url.searchParams.get('job_id');
	const job = findJob(jobId);
	return {
		tagOptions: tagPickerData('person'),
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
			person = createNetwork(values, 'manual');
		} catch (e) {
			if (e instanceof ValidationError)
				return fail(400, {
					errors: e.fieldErrors,
					tagSelection: tagFailureSelection('person', values),
					values
				});
			if (e instanceof ServiceError)
				return fail(400, {
					errors: { form: e.message },
					tagSelection: tagFailureSelection('person', values),
					values
				});
			console.error('Could not save person:', e);
			return fail(500, {
				errors: { form: 'Saturday could not save this person. Try again.' },
				values
			});
		}
		const jobId = url.searchParams.get('job_id');
		if (jobId && findJob(jobId)) {
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
