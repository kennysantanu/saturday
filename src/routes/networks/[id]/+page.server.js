import { error, fail, redirect } from '@sveltejs/kit';
import * as networks from '$lib/server/networks.js';
import { getJob, searchJobs } from '$lib/server/services.js';
import { ServiceError, ValidationError, localCalendarDate } from '$lib/server/validation.js';
import { networkReturn, networkDetailUrl } from '$lib/network-navigation.js';

export function load({ params, url }) {
	let person;
	try {
		person = networks.getNetwork(params.id);
	} catch (e) {
		if (e instanceof ServiceError || e instanceof ValidationError) error(404, 'Person not found');
		throw e;
	}
	const query = Object.fromEntries(url.searchParams);
	let returnTo = networkReturn(query.return_to);
	let missingJob = query.missing_job === '1';
	if (returnTo.startsWith('/jobs/')) {
		try {
			if (!getJob(new URL(returnTo, url).pathname.split('/')[2])) {
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
		linkedJobs = networks.listNetworkJobs({ network_id: params.id, page: query.jobs_page });
		history = networks.listNetworkUpdates({ network_id: params.id, page: query.updates_page });
		if (query.link_job === '1')
			picker = searchJobs({ view: 'all', query: query.job_query ?? '', page: query.picker_page });
	} catch (e) {
		if (!(e instanceof ValidationError)) throw e;
		errors = e.fieldErrors;
		linkedJobs ??= networks.listNetworkJobs({ network_id: params.id });
		history ??= networks.listNetworkUpdates({ network_id: params.id });
		if (query.link_job === '1') picker = searchJobs({ view: 'all' });
	}
	return {
		person,
		returnTo,
		linkedJobs,
		history,
		picker,
		linkedIds: picker ? networks.networkLinkIds({ network_id: params.id }) : [],
		query,
		errors,
		today: localCalendarDate(),
		missingJob
	};
}
function action(operation, saved) {
	return async ({ params, request, url }) => {
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
			operation({ ...values, network_id: params.id });
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
		redirect(
			303,
			networkDetailUrl(params.id, url.searchParams.get('return_to'), url.searchParams, saved)
		);
	};
}
export const actions = {
	followUp: action(networks.setNetworkFollowUp, 'follow-up'),
	clearFollowUp: action(
		(i) => networks.setNetworkFollowUp({ ...i, follow_up_date: null }),
		'follow-up-cleared'
	),
	link: action((i) => networks.linkJobNetwork(i, 'manual'), 'network-linked'),
	note: action(networks.editJobNetwork, 'network-note'),
	unlink: action(networks.unlinkJobNetwork, 'network-unlinked'),
	addInteraction: action((i) => networks.addNetworkUpdate(i, 'manual'), 'interaction'),
	editInteraction: action(networks.editNetworkUpdate, 'interaction-corrected'),
	deleteInteraction: action(
		(i) => networks.deleteNetworkUpdate({ ...i, confirm: i.confirm === 'true' }),
		'interaction-deleted'
	)
};
