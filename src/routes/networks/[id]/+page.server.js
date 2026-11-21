import { tagPickerData } from '$lib/server/tag-forms.js';
import { reminderActions, loadReminders, optionalReminder } from '$lib/server/reminder-actions.js';
import { error, fail } from '@sveltejs/kit';
import * as networks from '$lib/server/application.js';
import { getJob, searchJobs } from '$lib/server/application.js';
import { ServiceError, ValidationError, localCalendarDate } from '$lib/server/validation.js';
import { networkReturn, networkDetailUrl } from '$lib/network-navigation.js';
import { recordDeletionAction } from '$lib/server/record-deletion-actions.js';
import { confirmedUnlink } from '$lib/server/note-loss-confirmation.js';
import { settled } from '$lib/server/settled.js';
export async function load({ params, url }) {
	let person;
	try {
		person = await networks.getNetwork(params.id);
	} catch (e) {
		if (e instanceof ServiceError || e instanceof ValidationError) error(404, 'Person not found');
		throw e;
	}
	const query = Object.fromEntries(url.searchParams);
	let returnTo = networkReturn(query.return_to);
	let missingJob = query.missing_job === '1';
	if (returnTo.startsWith('/jobs/')) {
		try {
			if (!(await getJob(new URL(returnTo, url).pathname.split('/')[2]))) {
				returnTo = '/networks';
				missingJob = true;
			}
		} catch (e) {
			if (!(e instanceof ServiceError || e instanceof ValidationError)) throw e;
			returnTo = '/networks';
			missingJob = true;
		}
	}
	let linkedJobs,
		history,
		picker = null,
		errors = {};
	try {
		linkedJobs = await networks.listNetworkJobs({ network_id: params.id, page: query.jobs_page });
		history = await networks.listNetworkUpdates({
			network_id: params.id,
			page: query.updates_page
		});
		if (query.link_job === '1')
			picker = await searchJobs({
				view: 'all',
				query: query.job_query ?? '',
				page: query.picker_page,
				limit: 5
			});
	} catch (e) {
		if (!(e instanceof ValidationError)) throw e;
		errors = e.fieldErrors;
		linkedJobs ??= await networks.listNetworkJobs({ network_id: params.id });
		history ??= await networks.listNetworkUpdates({ network_id: params.id });
		if (query.link_job === '1') picker = await searchJobs({ view: 'all', limit: 5 });
	}
	let selectedJob = null;
	if (picker && query.job) {
		try {
			selectedJob = await getJob(query.job);
		} catch (e) {
			if (!(e instanceof ServiceError || e instanceof ValidationError)) throw e;
			errors = { ...errors, job: 'The selected job was not found.' };
		}
	}
	return {
		tagOptions: await tagPickerData(
			'person',
			person.tags.map((tag) => tag.id)
		),
		reminderData: await loadReminders({ network_id: params.id }, url.searchParams),
		person,
		returnTo,
		linkedJobs,
		history,
		picker,
		selectedJob,
		linkedIds: picker ? await networks.networkLinkIds({ network_id: params.id }) : [],
		query,
		errors,
		today: localCalendarDate(),
		missingJob
	};
}
function action(operation, saved, fragment) {
	return async (event) => {
		const { params, request, url } = event;
		const values = Object.fromEntries(
			Array.from((await request.formData()).entries(), ([key, value]) => [
				key,
				typeof value === 'string' ? value : ''
			])
		);
		const actionName = url.searchParams.has('/addInteraction')
			? 'addInteraction'
			: url.searchParams.has('/editInteraction')
				? 'editInteraction'
				: url.searchParams.has('/deleteInteraction')
					? 'deleteInteraction'
					: saved;
		try {
			await operation({ ...values, network_id: params.id });
		} catch (e) {
			if (e instanceof ValidationError)
				return fail(400, { action: actionName, errors: e.fieldErrors, values });
			if (e instanceof ServiceError)
				return fail(400, { action: actionName, errors: { form: e.message }, values });
			console.error('Could not save Network change:', e);
			return fail(500, {
				action: actionName,
				errors: { form: 'Saturday could not save this change. Try again.' },
				values
			});
		}
		return settled(
			event,
			{ saved },
			`${networkDetailUrl(params.id, url.searchParams.get('return_to'), url.searchParams, saved)}${fragment}`
		);
	};
}
export const actions = {
	...reminderActions('person'),
	deletePerson: recordDeletionAction('person', networks.deleteNetwork),
	link: action(
		async (i) => await networks.linkJobNetwork(i),
		'network-linked',
		'#person-linked-jobs'
	),
	note: action(networks.editJobNetwork, 'network-note', '#person-linked-jobs'),
	unlink: confirmedUnlink('person', 'network-unlinked', {
		redirectTo: ({ params, url, saved }) =>
			`${networkDetailUrl(params.id, url.searchParams.get('return_to'), url.searchParams, saved)}#person-linked-jobs`
	}),
	addInteraction: action(
		async (i) => await networks.addNetworkUpdate({ ...i, ...optionalReminder(i) }),
		'interaction',
		'#person-interactions'
	),
	editInteraction: action(
		networks.editNetworkUpdate,
		'interaction-corrected',
		'#person-interactions'
	),
	deleteInteraction: action(
		async (i) => await networks.deleteNetworkUpdate({ ...i, confirm: i.confirm === 'true' }),
		'interaction-deleted',
		'#person-interactions'
	)
};
