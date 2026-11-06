import { fail, redirect } from '@sveltejs/kit';
import { localScheduleNow } from '$lib/domain/reminders.js';
import { dismissReminder, editReminder, getDashboardStats } from '$lib/server/application.js';
import { ServiceError, ValidationError } from '$lib/server/validation.js';
import { todayIso } from '$lib/format.js';
export async function load({ url }) {
	const today = todayIso();
	const pipelinePages = Object.fromEntries(
		[...url.searchParams]
			.filter(([key]) => /^pipeline_page_[1-9]\d*$/.test(key))
			.map(([key, value]) => [key.slice('pipeline_page_'.length), value])
	);
	const dashboard = await getDashboardStats({ today, pipelinePages });
	return { ...dashboard, today, now: localScheduleNow() };
}

// Dismiss (and its Undo) from the Needs attention list. Scripts send `enhanced=1` and get data back
// so the page can offer Undo; a plain form post redirects with a confirmation toast.
function reminderAction(operation, saved) {
	return async ({ request, url }) => {
		const values = Object.fromEntries(await request.formData());
		const owner = values.job_id ? { job_id: values.job_id } : { network_id: values.network_id };
		try {
			await operation({ ...owner, reminder_id: values.reminder_id });
		} catch (error) {
			if (error instanceof ValidationError || error instanceof ServiceError)
				return fail(400, {
					action: saved,
					error:
						error instanceof ValidationError ? 'Check the reminder and try again.' : error.message
				});
			console.error('Could not update reminder:', error);
			return fail(500, { action: saved, error: 'Saturday could not update this reminder.' });
		}
		if (values.enhanced === '1') return { action: saved, ok: true };
		const query = new URLSearchParams(url.searchParams);
		for (const key of [...query.keys()]) if (key.startsWith('/')) query.delete(key);
		query.set('saved', saved);
		redirect(303, `/?${query}#needs-attention`);
	};
}
export const actions = {
	dismiss: reminderAction(dismissReminder, 'reminder-dismissed'),
	restore: reminderAction((input) => editReminder({ ...input, is_active: true }), 'reminder')
};
