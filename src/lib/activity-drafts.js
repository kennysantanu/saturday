// Shared field state and conversion; callers supply dates, saved data and validation values.
/** @param {{today: string, entry?: {stageId: number | null, date: string, note: string | null} | null, values?: Record<string, string>}} input */
export function jobHistoryDraft({ today, entry = null, values = {} }) {
	return {
		stage_id: values.stage_id ?? (entry?.stageId ? String(entry.stageId) : ''),
		event_date: values.event_date ?? entry?.date ?? today,
		note: values.note ?? entry?.note ?? ''
	};
}

/** @param {{today: string, entry?: {scheduled_at: string, note: string | null} | null, values?: Record<string, string>}} input */
export function reminderDraft({ today, entry = null, values = {} }) {
	return {
		reminder_date: values.reminder_date ?? entry?.scheduled_at.slice(0, 10) ?? today,
		reminder_time: values.reminder_time ?? entry?.scheduled_at.slice(11, 16) ?? '00:00',
		reminder_note: values.reminder_note ?? entry?.note ?? ''
	};
}

export function reminderFromForm(values) {
	return {
		scheduled_at: `${values.reminder_date ?? ''}T${values.reminder_time || '00:00'}`,
		note: values.reminder_note ?? null
	};
}

export function optionalReminder(values) {
	return values.add_reminder === 'on' ? { reminder: reminderFromForm(values) } : {};
}
