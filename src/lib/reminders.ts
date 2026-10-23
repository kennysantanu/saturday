export type Reminder = {
	id: number;
	job_id: number | null;
	network_id: number | null;
	scheduled_at: string;
	note: string | null;
	is_active: boolean;
	dismissed_at: string | null;
	created_via: string;
	created_at: string;
	updated_at: string;
};
export type ReminderPage = {
	reminders: Reminder[];
	page: number;
	total: number;
	totalPages: number;
	limit: number;
};
export type ReminderDraft = { reminder_date: string; reminder_time: string; reminder_note: string };
