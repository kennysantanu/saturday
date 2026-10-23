import { fail, redirect } from '@sveltejs/kit';
import {
	createReminder,
	editReminder,
	dismissReminder,
	deleteReminder,
	listReminders,
	localScheduleNow
} from './reminders.js';
import { ServiceError, ValidationError } from './validation.js';

export function reminderFromForm(values) {
	return {
		scheduled_at: `${values.reminder_date ?? ''}T${values.reminder_time || '00:00'}`,
		note: values.reminder_note ?? null
	};
}
export function optionalReminder(values) {
	return values.add_reminder === 'on' ? { reminder: reminderFromForm(values) } : {};
}
export function loadReminders(owner, params) {
	const page = (key) =>
		/^[1-9]\d*$/.test(params.get(key) ?? '') && Number.isSafeInteger(Number(params.get(key)))
			? Number(params.get(key))
			: 1;
	return {
		active: listReminders({ ...owner, limit: 5, page: page('reminders_page') }),
		past: listReminders({
			...owner,
			view: 'inactive',
			limit: 5,
			page: page('past_reminders_page')
		}),
		now: localScheduleNow()
	};
}
export function reminderActions(kind) {
	const field = kind === 'job' ? 'job_id' : 'network_id';
	return Object.fromEntries(
		['create', 'edit', 'dismiss', 'delete'].map((mode) => {
			const name = `reminder${mode[0].toUpperCase() + mode.slice(1)}`;
			return [
				name,
				async ({ params, request, url }) => {
					const values = Object.fromEntries(await request.formData()),
						owner = { [field]: params.id };
					try {
						const identity = { ...owner, reminder_id: values.reminder_id };
						if (mode === 'create') createReminder({ ...owner, ...reminderFromForm(values) });
						if (mode === 'edit')
							editReminder({
								...identity,
								...reminderFromForm(values),
								...(values.active_changed === '1' ? { is_active: values.is_active === 'on' } : {})
							});
						if (mode === 'dismiss') dismissReminder(identity);
						if (mode === 'delete')
							deleteReminder({ ...identity, confirm: values.confirm === 'true' });
					} catch (error) {
						if (error instanceof ValidationError)
							return fail(400, { action: name, errors: error.fieldErrors, values });
						if (error instanceof ServiceError)
							return fail(400, { action: name, errors: { form: error.message }, values });
						console.error('Could not save reminder:', error);
						return fail(500, {
							action: name,
							errors: { form: 'Saturday could not save this reminder. Try again.' },
							values
						});
					}
					const query = new URLSearchParams(url.searchParams);
					for (const key of [...query.keys()]) if (key.startsWith('/')) query.delete(key);
					query.set(
						'saved',
						mode === 'dismiss'
							? 'reminder-dismissed'
							: mode === 'delete'
								? 'reminder-deleted'
								: 'reminder'
					);
					redirect(303, `${url.pathname}?${query}#reminders`);
				}
			];
		})
	);
}
