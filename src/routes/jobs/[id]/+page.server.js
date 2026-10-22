import { searchFromUrl } from '$lib/job-search.js';
import { jobReturn, jobDetailUrl } from '$lib/job-navigation.js';
import * as networks from '$lib/server/networks.js';
import { listDocuments } from '$lib/server/files/documents.js';
import { error, fail, redirect } from '@sveltejs/kit';
import {
	setJobFollowUp,
	moveJobStage,
	addJobUpdate,
	correctJobUpdate,
	setJobStarred,
	getJob,
	searchJobs,
	ServiceError,
	ValidationError
} from '$lib/server/services.js';
import { listWorkflowStages } from '$lib/server/workflow.js';
import { todayIso } from '$lib/format.js';

function formValues(formData) {
	return Object.fromEntries(
		Array.from(formData.entries(), ([key, value]) => [key, typeof value === 'string' ? value : ''])
	);
}

function actionError(error, values, action) {
	if (error instanceof ValidationError)
		return fail(400, { action, errors: error.fieldErrors, values });
	if (error instanceof ServiceError)
		return fail(400, {
			action,
			errors: { form: error.message },
			values,
			moveFirst: error.code === 'current_stage_evidence'
		});
	console.error('Could not save job update:', error);
	return fail(500, {
		action,
		errors: { form: 'Saturday could not save this change. Try again.' },
		values
	});
}

export async function load({ params, url }) {
	let job;
	try {
		job = getJob(params.id);
	} catch (e) {
		if (e instanceof ValidationError) error(404, 'Job not found');
		throw e;
	}
	if (!job) error(404, 'Job not found');
	let documents = [],
		documentCount = 0,
		documentsError = null;
	try {
		const listing = await listDocuments({ scope: params.id, limit: 50 });
		documents = listing.documents;
		documentCount = listing.total;
	} catch (e) {
		documentsError = e.code ? e.message : 'Document store unavailable.';
	}
	const networkQuery = Object.fromEntries(url.searchParams);
	let people,
		personPicker = null,
		networkErrors = {};
	try {
		people = networks.listNetworks({ job_id: params.id, page: networkQuery.network_page });
		if (networkQuery.link_person === '1')
			personPicker = networks.listNetworks({
				query: networkQuery.person_query,
				page: networkQuery.person_page,
				limit: 5
			});
	} catch (e) {
		if (!(e instanceof ValidationError)) throw e;
		networkErrors = e.fieldErrors;
		people ??= networks.listNetworks({ job_id: params.id });
		if (networkQuery.link_person === '1') personPicker = networks.listNetworks({ limit: 5 });
	}
	let selectedPerson = null;
	if (networkQuery.person) {
		try {
			selectedPerson = networks.getNetwork(networkQuery.person);
		} catch (e) {
			if (!(e instanceof ServiceError || e instanceof ValidationError)) throw e;
			networkErrors = { ...networkErrors, person: 'The selected person was not found.' };
		}
	}
	const returnTo = jobReturn(url.searchParams.get('return_to'));
	let outsideResults = false;
	if (returnTo.startsWith('/jobs')) {
		try {
			outsideResults =
				searchJobs(searchFromUrl(new URL(returnTo, url).searchParams), { jobId: job.id }).total ===
				0;
		} catch {
			/* Invalid old filter URLs do not block detail. */
		}
	}
	return {
		job,
		outsideResults,
		returnTo: jobReturn(url.searchParams.get('return_to')),
		today: todayIso(),
		stages: listWorkflowStages(),
		documents,
		documentCount,
		documentsError,
		people,
		personPicker,
		networkQuery,
		networkErrors,
		selectedPerson,
		linkedPersonIds: personPicker ? networks.networkLinkIds({ job_id: params.id }) : []
	};
}

function networkAction(operation, saved) {
	return async ({ params, request, url }) => {
		const values = formValues(await request.formData());
		try {
			operation({ ...values, job_id: params.id });
		} catch (e) {
			return actionError(e, values, saved);
		}
		const query = new URLSearchParams(url.searchParams);
		for (const key of [...query.keys()])
			if (
				key.startsWith('/') ||
				key === 'person' ||
				key.startsWith('person_') ||
				key === 'link_person'
			)
				query.delete(key);
		query.set('saved', saved);
		redirect(303, `${url.pathname}?${query}`);
	};
}
function historyAction(mode) {
	return async ({ params, request, url }) => {
		const values = formValues(await request.formData());
		let saved =
			mode === 'changeStage' ? 'stage-changed' : mode === 'addHistory' ? 'update' : 'correction';
		try {
			if (mode === 'changeStage') {
				const changed = moveJobStage(params.id, values, 'manual');
				saved = changed.unchanged
					? 'stage-unchanged'
					: changed.isActive
						? 'stage-changed'
						: 'job-closed';
			} else if (mode === 'addHistory') {
				addJobUpdate({ ...values, job_id: params.id, stage_id: values.stage_id || null }, 'manual');
			} else {
				// The route owns the job; the service scopes the entry to that job.
				correctJobUpdate(values.update_id, {
					...values,
					job_id: params.id,
					stage_id: values.stage_id || null,
					remove: mode === 'deleteHistory'
				});
				if (mode === 'deleteHistory') saved = 'removed';
			}
		} catch (e) {
			return actionError(e, values, mode);
		}
		redirect(303, jobDetailUrl(params.id, url.searchParams.get('return_to'), saved));
	};
}
export const actions = {
	changeStage: historyAction('changeStage'),
	addHistory: historyAction('addHistory'),
	editHistory: historyAction('editHistory'),
	deleteHistory: historyAction('deleteHistory'),
	networkLink: networkAction((i) => networks.linkJobNetwork(i, 'manual'), 'network-linked'),
	networkNote: networkAction(networks.editJobNetwork, 'network-note'),
	networkUnlink: networkAction(networks.unlinkJobNetwork, 'network-unlinked'),
	followUp: async ({ params, request, url }) => {
		const values = formValues(await request.formData());
		try {
			setJobFollowUp(params.id, values.follow_up_date || null, values.follow_up_comment);
		} catch (error) {
			return actionError(error, values, 'followUp');
		}
		redirect(303, jobDetailUrl(params.id, url.searchParams.get('return_to'), `follow-up`));
	},
	clearFollowUp: async ({ params, request, url }) => {
		const values = formValues(await request.formData());
		try {
			setJobFollowUp(params.id, null);
		} catch (error) {
			return actionError(error, values, 'followUp');
		}
		redirect(303, jobDetailUrl(params.id, url.searchParams.get('return_to'), `follow-up-cleared`));
	},
	star: async ({ params, request, url }) => {
		const values = formValues(await request.formData());
		try {
			setJobStarred(params.id, values.is_starred === '1');
		} catch (error) {
			return actionError(error, values, 'star');
		}
		redirect(303, jobDetailUrl(params.id, url.searchParams.get('return_to'), `starred`));
	}
};
