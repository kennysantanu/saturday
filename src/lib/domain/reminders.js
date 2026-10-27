import { z } from 'zod';
import { parseSchema, recordIdInputSchema, validDate } from './validation.js';

export function localScheduleNow(now = new Date()) {
	const two = (value) => String(value).padStart(2, '0');
	return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}:${two(now.getMinutes())}`;
}
export const reminderInputShape = {
	scheduled_at: z
		.string()
		.trim()
		.refine(
			(value) =>
				/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) &&
				validDate(value.slice(0, 10)),
			'Enter a real date and time in YYYY-MM-DDTHH:mm format.'
		),
	note: z
		.preprocess(
			(value) => (value == null || value === '' ? null : value),
			z.string().trim().max(10000).nullable()
		)
		.optional()
		.transform((value) => value || null)
};
export const reminderOwnerShape = {
	job_id: recordIdInputSchema.optional(),
	network_id: recordIdInputSchema.optional()
};
export const reminderOwnerSchema = z
	.object(reminderOwnerShape)
	.refine((value) => (value.job_id !== undefined) !== (value.network_id !== undefined), {
		message: 'Choose exactly one job or person.',
		path: ['owner']
	});
export function parseReminderOwner(input) {
	return parseSchema(reminderOwnerSchema, input);
}
