import {
	tagPickerData,
	tagFormValues,
	tagFormFailure,
	tagFailureSelection
} from '$lib/server/tag-forms.js';
import { jobReturn, jobDetailUrl } from '$lib/job-navigation.js';
import { fail, redirect } from '@sveltejs/kit';
import { createJob, getNetwork } from '$lib/server/application.js';
import { ServiceError, ValidationError } from '$lib/server/validation.js';
import { PossibleDuplicateJobError } from '$lib/domain/job-duplicates.js';
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
		const submitted = await request.formData();
		const values = tagFormValues(submitted);
		delete values.allow_duplicate;
		let job;
		try {
			job = await createJob({
				...values,
				allow_duplicate: submitted.get('allow_duplicate') === 'true'
			});
		} catch (error) {
			if (error instanceof PossibleDuplicateJobError)
				return fail(409, {
					errors: {},
					values,
					duplicateJobs: error.matches,
					duplicateTotal: error.total,
					tagSelection: await tagFailureSelection('job', values)
				});
			const failure = await tagFormFailure(
				error,
				'job',
				values,
				'Saturday could not save this job. Try again.'
			);
			return fail(failure.status, { ...failure.data, duplicateJobs: [], duplicateTotal: 0 });
		}
		const person = await findPerson(url.searchParams.get('person_id'));
		if (person) redirect(303, `/networks/${person.id}?link_job=1&job=${job.id}`);
		redirect(303, jobDetailUrl(job.id, url.searchParams.get('return_to'), 'job'));
	}
};
