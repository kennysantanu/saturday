// Local SQLite implementation; compose through server/application.js for web and assistant use.
import { z } from 'zod';
import { withDatabase, inTransaction } from '../database.js';
import {
	parseSchema,
	recordIdInputSchema,
	validDate,
	ServiceError,
	ValidationError
} from '../validation.js';

export {
	localScheduleNow,
	reminderInputShape,
	reminderOwnerShape
} from '../../domain/reminders.js';
import {
	localScheduleNow,
	reminderInputShape,
	parseReminderOwner as owner
} from '../../domain/reminders.js';

function scope(db, input) {
	const value = owner(input),
		column = value.job_id !== undefined ? 'job_id' : 'network_id',
		id = value[column];
	if (!db.prepare(`SELECT id FROM ${column === 'job_id' ? 'jobs' : 'networks'} WHERE id=?`).get(id))
		throw new ServiceError('Reminder owner was not found.', 'not_found');
	return { column, id };
}
const fromRow = (row) => ({ ...row, is_active: Boolean(row.is_active) });
function entry(db, input) {
	const { column, id } = scope(db, input),
		reminderId = parseSchema(recordIdInputSchema, input.reminder_id);
	const row = db.prepare(`SELECT * FROM reminders WHERE ${column}=? AND id=?`).get(id, reminderId);
	if (!row) throw new ServiceError('Reminder was not found. Refresh this record.', 'not_found');
	return row;
}
// Also used inside an existing activity transaction so both records commit together.
export function insertReminder(db, input, createdVia = 'manual') {
	const { column, id } = scope(db, input),
		values = parseSchema(z.object(reminderInputShape), input);
	const via = parseSchema(z.enum(['manual', 'mcp']), createdVia),
		stamp = new Date().toISOString();
	const result = db
		.prepare(
			`INSERT INTO reminders(${column},scheduled_at,note,created_via,created_at,updated_at) VALUES(?,?,?,?,?,?)`
		)
		.run(id, values.scheduled_at, values.note, via, stamp, stamp);
	return fromRow(db.prepare('SELECT * FROM reminders WHERE id=?').get(result.lastInsertRowid));
}
export function createReminder(input, createdVia = 'manual') {
	return withDatabase((db) => inTransaction(db, () => insertReminder(db, input, createdVia)));
}
export function listReminders(input) {
	const paging = parseSchema(
		z.object({
			view: z.enum(['active', 'inactive', 'all']).default('active'),
			page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
			limit: z.coerce.number().int().min(1).max(100).default(20)
		}),
		Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
	);
	return withDatabase((db) => {
		db.exec('BEGIN');
		const { column, id } = scope(db, input);
		const where = `${column}=?${paging.view === 'all' ? '' : ` AND is_active=${paging.view === 'active' ? 1 : 0}`}`;
		const total = db.prepare(`SELECT COUNT(*) AS n FROM reminders WHERE ${where}`).get(id).n;
		const totalPages = Math.max(1, Math.ceil(total / paging.limit)),
			page = Math.min(paging.page, totalPages);
		const reminders = db
			.prepare(
				`SELECT * FROM reminders WHERE ${where} ORDER BY ${paging.view === 'inactive' ? 'dismissed_at DESC' : 'scheduled_at'},id LIMIT ? OFFSET ?`
			)
			.all(id, paging.limit, (page - 1) * paging.limit)
			.map(fromRow);
		return { reminders, total, totalPages, page, limit: paging.limit };
	});
}
export function editReminder(input) {
	return withDatabase((db) =>
		inTransaction(db, () => {
			const previous = entry(db, input);
			const patch = Object.fromEntries(
				['scheduled_at', 'note', 'is_active']
					.filter((key) => Object.hasOwn(input, key) && input[key] !== undefined)
					.map((key) => [key, input[key]])
			);
			if (!Object.keys(patch).length)
				throw new ValidationError({ form: 'Supply a reminder field to edit.' });
			const values = parseSchema(z.object({ ...reminderInputShape, is_active: z.boolean() }), {
				...previous,
				is_active: Boolean(previous.is_active),
				...patch
			});
			const stamp = new Date().toISOString(),
				dismissed = values.is_active ? null : (previous.dismissed_at ?? stamp);
			if (
				values.scheduled_at !== previous.scheduled_at ||
				values.note !== previous.note ||
				Number(values.is_active) !== previous.is_active
			)
				db.prepare(
					'UPDATE reminders SET scheduled_at=?,note=?,is_active=?,dismissed_at=?,updated_at=? WHERE id=?'
				).run(
					values.scheduled_at,
					values.note,
					Number(values.is_active),
					dismissed,
					stamp,
					previous.id
				);
			return fromRow(db.prepare('SELECT * FROM reminders WHERE id=?').get(previous.id));
		})
	);
}
export function dismissReminder(input) {
	return editReminder({ ...input, is_active: false });
}
export function deleteReminder(input) {
	if (input.confirm !== true)
		throw new ValidationError({ confirm: 'Confirm permanent deletion of this reminder.' });
	return withDatabase((db) =>
		inTransaction(db, () => {
			const previous = entry(db, input);
			db.prepare('DELETE FROM reminders WHERE id=?').run(previous.id);
			return { reminder_id: previous.id, deleted: true };
		})
	);
}
export function activityReminder(db, input, owner, createdVia) {
	if (input.reminder != null) insertReminder(db, { ...input.reminder, ...owner }, createdVia);
}
export const nextReminderSql = (alias, column) =>
	`(SELECT MIN(r.scheduled_at) FROM reminders r WHERE r.${column}=${alias}.id AND r.is_active=1)`;
export function reminderFeed(db) {
	return db
		.prepare(
			`SELECT r.*,j.job_title,j.company_name,s.is_closed AS job_closed,n.name AS person_name FROM reminders r LEFT JOIN jobs j ON j.id=r.job_id LEFT JOIN workflow_stages s ON s.id=j.current_stage_id LEFT JOIN networks n ON n.id=r.network_id WHERE r.is_active=1 ORDER BY r.scheduled_at,r.id`
		)
		.all()
		.map(fromRow);
}
