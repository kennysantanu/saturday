import { tagPickerData, tagFormValues, tagFormFailure } from '$lib/server/tag-forms.js';
import { jobReturn, jobDetailUrl } from '$lib/job-navigation.js';
import { redirect } from '@sveltejs/kit';
import { createJob, getNetwork } from '$lib/server/application.js';
import { ServiceError, ValidationError } from '$lib/server/validation.js';
// "Add job" from a person's Link to job picker carries the person; anything invalid is ignored.
async function findPerson(id) {
	if (!id) return null;
	try {
		const person = await getNetwork(id);
		return { id: person.id, name: person.name };
	} catch (e) {
		if (e instanceof ServiceError || e instanceof ValidationError) return null;
		throw e;
	}
}
export async function load({ url }) {
	const person = await findPerson(url.searchParams.get('person_id'));
	return {
		tagOptions: await tagPickerData('job'),
		returnTo: person ? `/networks/${person.id}` : jobReturn(url.searchParams.get('return_to')),
		person
	};
}
export const actions = {
	default: async ({ request, url }) => {
		const values = tagFormValues(await request.formData());
		let job;
		try {
			job = await createJob(values);
		} catch (error) {
			return tagFormFailure(error, 'job', values, 'Saturday could not save this job. Try again.');
		}
		const person = await findPerson(url.searchParams.get('person_id'));
		if (person) redirect(303, `/networks/${person.id}?link_job=1&job=${job.id}`);
		redirect(303, jobDetailUrl(job.id, url.searchParams.get('return_to'), 'job'));
	}
};
