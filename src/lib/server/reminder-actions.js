import { fail, redirect } from '@sveltejs/kit';
import {
	createReminder,
	editReminder,
	dismissReminder,
	deleteReminder,
	listReminders
} from './application.js';
import { localScheduleNow } from '../domain/reminders.js';
import { ServiceError, ValidationError } from './validation.js';
export { reminderFromForm, optionalReminder } from '../activity-drafts.js';
import { reminderFromForm } from '../activity-drafts.js';

export async function loadReminders(owner, params) {
	const page = (key) =>
		/^[1-9]\d*$/.test(params.get(key) ?? '') && Number.isSafeInteger(Number(params.get(key)))
			? Number(params.get(key))
			: 1;
	return {
		active: await listReminders({ ...owner, limit: 5, page: page('reminders_page') }),
		past: await listReminders({
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
						if (mode === 'create') await createReminder({ ...owner, ...reminderFromForm(values) });
						if (mode === 'edit')
							await editReminder({
								...identity,
								...reminderFromForm(values),
								...(values.active_changed === '1' ? { is_active: values.is_active === 'on' } : {})
							});
						if (mode === 'dismiss') await dismissReminder(identity);
						if (mode === 'delete')
							await deleteReminder({ ...identity, confirm: values.confirm === 'true' });
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
