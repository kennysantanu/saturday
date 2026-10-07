import { listDocuments } from '$lib/server/files/documents.js';
import { error, fail, redirect } from '@sveltejs/kit';
import {
	setJobFollowUp,
	setJobStarred,
	addJobUpdate,
	correctJobUpdate,
	dismissJob,
	getJob,
	reopenJob,
	ServiceError,
	ValidationError
} from '$lib/server/services.js';
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
		return fail(400, { action, errors: { form: error.message }, values });
	console.error('Could not save job update:', error);
	return fail(500, {
		action,
		errors: { form: 'Saturday could not save this change. Try again.' },
		values
	});
}

export async function load({ params }) {
	const job = getJob(params.id);
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
	return { job, today: todayIso(), documents, documentCount, documentsError };
}

export const actions = {
	followUp: async ({ params, request }) => {
		const values = formValues(await request.formData());
		try {
			setJobFollowUp(params.id, values.follow_up_date || null, values.follow_up_comment);
		} catch (error) {
			return actionError(error, values, 'followUp');
		}
		redirect(303, `/jobs/${params.id}?saved=follow-up`);
	},
	clearFollowUp: async ({ params }) => {
		try {
			setJobFollowUp(params.id, null);
		} catch (error) {
			return actionError(error, {}, 'followUp');
		}
		redirect(303, `/jobs/${params.id}?saved=follow-up-cleared`);
	},
	star: async ({ params, request }) => {
		const values = formValues(await request.formData());
		try {
			setJobStarred(params.id, values.is_starred === '1');
		} catch (error) {
			return actionError(error, values, 'star');
		}
		redirect(303, `/jobs/${params.id}?saved=starred`);
	},
	addUpdate: async ({ params, request }) => {
		const values = formValues(await request.formData());
		try {
			addJobUpdate(
				{
					...values,
					job_id: params.id,
					event_type: values.event_type === 'note' || !values.event_type ? null : values.event_type
				},
				'manual'
			);
		} catch (error) {
			return actionError(error, values, 'addUpdate');
		}
		redirect(303, `/jobs/${params.id}?saved=update`);
	},
	correctUpdate: async ({ params, request }) => {
		const values = formValues(await request.formData());
		try {
			correctJobUpdate(values.update_id, {
				remove: values.remove,
				event_type: values.event_type,
				event_date: values.event_date,
				note: values.note
			});
		} catch (error) {
			return actionError(error, values, 'correctUpdate');
		}
		redirect(303, `/jobs/${params.id}?saved=${values.remove ? 'removed' : 'correction'}`);
	},
	dismiss: async ({ params, request }) => {
		const values = formValues(await request.formData());
		try {
			dismissJob(params.id, values.event_date || undefined, 'manual');
		} catch (error) {
			return actionError(error, values, 'dismiss');
		}
		redirect(303, `/jobs/${params.id}?saved=dismissed`);
	},
	reopen: async ({ params, request }) => {
		const values = formValues(await request.formData());
		try {
			reopenJob(params.id, values.event_date || undefined, 'manual');
		} catch (error) {
			return actionError(error, values, 'reopen');
		}
		redirect(303, `/jobs/${params.id}?saved=reopened`);
	}
};
