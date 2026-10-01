import { randomUUID } from 'node:crypto';
import { EVENT_LABELS } from '../event-labels.js';
import { inTransaction, withDatabase } from './database.js';
import {
	parseEventDate,
	parseJobInput,
	parseUpdateInput,
	ServiceError,
	ValidationError
} from './validation.js';

const timestamp = () => new Date().toISOString();
const stateEvents = new Set(['accepted', 'rejected', 'dismissed', 'reopened']);
const milestoneRank = { applied: 1, prescreened: 2, interview_1: 3, interview_2: 4, offer: 5 };

function shortDate(isoDate) {
	const date = new Date(`${isoDate}T00:00:00.000Z`);
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	}).format(date);
}

function readUpdates(db, jobId) {
	return db
		.prepare(
			`SELECT recorded_order, id, job_id, event_type, event_date, note, created_via, created_at, updated_at
			 FROM job_updates WHERE job_id = ? ORDER BY event_date DESC, recorded_order DESC`
		)
		.all(jobId)
		.map((row) => ({
			recordedOrder: Number(row.recorded_order),
			id: row.id,
			jobId: row.job_id,
			eventType: row.event_type,
			date: row.event_date,
			note: row.note,
			createdVia: row.created_via,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			label: row.event_type ? EVENT_LABELS[row.event_type] : 'Note'
		}));
}

function statusFor(isActive, updates) {
	const stateHistory = [...updates]
		.filter((update) => stateEvents.has(update.eventType))
		.sort((a, b) => a.recordedOrder - b.recordedOrder);
	let latestState = null;
	for (const update of stateHistory) latestState = update.eventType;

	if (!isActive) {
		if (latestState === 'accepted') return { label: 'Accepted', tone: 'success' };
		if (latestState === 'rejected') return { label: 'Rejected', tone: 'danger' };
		return { label: 'Dismissed', tone: 'muted' };
	}

	const reached = updates.reduce(
		(furthest, update) => Math.max(furthest, milestoneRank[update.eventType] ?? 0),
		0
	);
	if (reached === 5) return { label: 'Offer', tone: 'success' };
	if (reached >= 2) {
		const furthestType = Object.keys(milestoneRank).find((key) => milestoneRank[key] === reached);
		return { label: `In process · ${EVENT_LABELS[furthestType]}`, tone: 'progress' };
	}
	if (reached === 1) return { label: 'Applied', tone: 'info' };
	return { label: 'New', tone: 'neutral' };
}

function jobFromRow(row, updates = []) {
	const isActive = Boolean(row.is_active);
	return {
		id: row.id,
		title: row.job_title,
		company: row.company_name,
		postingUrl: row.posting_url,
		description: row.job_description,
		notes: row.notes,
		isActive,
		createdVia: row.created_via,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		status: statusFor(isActive, updates),
		updates
	};
}

function getJobRow(db, id) {
	return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

function eventUpdate(db, { jobId, eventType, eventDate, note = null, createdVia }) {
	const now = timestamp();
	const id = randomUUID();
	db.prepare(
		`INSERT INTO job_updates (id, job_id, event_type, event_date, note, created_via, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	).run(id, jobId, eventType, eventDate, note, createdVia, now, now);
	if (eventType === 'accepted' || eventType === 'rejected' || eventType === 'dismissed') {
		db.prepare('UPDATE jobs SET updated_at = ?, is_active = 0 WHERE id = ?').run(now, jobId);
	} else if (eventType === 'reopened') {
		db.prepare('UPDATE jobs SET updated_at = ?, is_active = 1 WHERE id = ?').run(now, jobId);
	} else {
		db.prepare('UPDATE jobs SET updated_at = ? WHERE id = ?').run(now, jobId);
	}
	return id;
}

function replayActive(db, jobId) {
	const updates = db
		.prepare(
			`SELECT event_type FROM job_updates
			 WHERE job_id = ? AND event_type IN ('dismissed', 'reopened', 'accepted', 'rejected')
			 ORDER BY recorded_order`
		)
		.all(jobId);
	let isActive = true;
	for (const update of updates) {
		if (update.event_type === 'reopened') isActive = true;
		else isActive = false;
	}
	return isActive ? 1 : 0;
}

export function createJob(input, createdVia = 'manual') {
	const values = parseJobInput(input);
	if (!['manual', 'mcp'].includes(createdVia)) throw new ServiceError('Unknown record source.');
	return withDatabase((db) =>
		inTransaction(db, () => {
			const now = timestamp();
			const id = randomUUID();
			db.prepare(
				`INSERT INTO jobs (id, job_title, company_name, posting_url, job_description, notes,
				 is_active, created_via, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
			).run(
				id,
				values.job_title,
				values.company_name,
				values.posting_url,
				values.job_description,
				values.notes,
				createdVia,
				now,
				now
			);
			return jobFromRow(getJobRow(db, id));
		})
	);
}

export function editJob(id, input) {
	const values = parseJobInput(input);
	return withDatabase((db) =>
		inTransaction(db, () => {
			if (!getJobRow(db, id)) throw new ServiceError('Job not found.', 'not_found');
			db.prepare(
				`UPDATE jobs SET job_title = ?, company_name = ?, posting_url = ?,
				 job_description = ?, notes = ?, updated_at = ? WHERE id = ?`
			).run(
				values.job_title,
				values.company_name,
				values.posting_url,
				values.job_description,
				values.notes,
				timestamp(),
				id
			);
			return jobFromRow(getJobRow(db, id), readUpdates(db, id));
		})
	);
}

export function getJob(id) {
	return withDatabase((db) => {
		const row = getJobRow(db, id);
		if (!row) return null;
		return jobFromRow(row, readUpdates(db, id));
	});
}

const stepEvents = new Set([
	'applied',
	'prescreened',
	'interview_1',
	'interview_2',
	'offer',
	'accepted',
	'rejected',
	'dismissed'
]);

/** `reached` limits the list to jobs that ever recorded this step, matching the Dashboard counts. */
export function listJobs({
	includeInactive = false,
	query = '',
	limit = 100,
	reached = null
} = {}) {
	const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
	const search = String(query).trim();
	return withDatabase((db) => {
		const clauses = [];
		const args = [];
		if (!includeInactive) clauses.push('j.is_active = 1');
		if (reached) {
			if (!stepEvents.has(reached)) throw new ServiceError('Unknown step.');
			clauses.push(
				'EXISTS (SELECT 1 FROM job_updates u WHERE u.job_id = j.id AND u.event_type = ?)'
			);
			args.push(reached);
		}
		if (search) {
			clauses.push("(j.job_title LIKE ? ESCAPE '\\' OR j.company_name LIKE ? ESCAPE '\\')");
			const escaped = search.replace(/[\\%_]/g, '\\$&');
			args.push(`%${escaped}%`, `%${escaped}%`);
		}
		const rows = db
			.prepare(
				`SELECT j.* FROM jobs j ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
				 ORDER BY j.updated_at DESC, j.created_at DESC LIMIT ?`
			)
			.all(...args, safeLimit);
		return rows.map((row) => {
			const updates = readUpdates(db, row.id);
			const latest = [...updates].sort((a, b) => b.recordedOrder - a.recordedOrder)[0];
			const job = jobFromRow(row, updates);
			return {
				...job,
				updates: undefined,
				latestUpdate: latest ? `${latest.label} · ${shortDate(latest.date)}` : 'No updates yet'
			};
		});
	});
}

export function addJobUpdate(input, createdVia = 'manual') {
	const values = parseUpdateInput(input);
	if (!['manual', 'mcp'].includes(createdVia)) throw new ServiceError('Unknown record source.');
	return withDatabase((db) =>
		inTransaction(db, () => {
			const job = getJobRow(db, values.job_id);
			if (!job)
				throw new ServiceError('Job not found. Check the job ID and try again.', 'not_found');
			if (values.event_type && !job.is_active) {
				throw new ServiceError('This job is inactive. Reopen it before adding a milestone.');
			}
			const id = eventUpdate(db, {
				jobId: values.job_id,
				eventType: values.event_type,
				eventDate: values.event_date,
				note: values.note,
				createdVia
			});
			const saved = db.prepare('SELECT * FROM job_updates WHERE id = ?').get(id);
			return {
				id: saved.id,
				jobId: saved.job_id,
				eventType: saved.event_type,
				date: saved.event_date,
				note: saved.note,
				createdVia: saved.created_via,
				createdAt: saved.created_at
			};
		})
	);
}

export function correctJobUpdate(id, correction = {}) {
	return withDatabase((db) =>
		inTransaction(db, () => {
			const existing = db.prepare('SELECT * FROM job_updates WHERE id = ?').get(id);
			if (!existing) throw new ServiceError('Update not found.', 'not_found');
			if (['dismissed', 'reopened'].includes(existing.event_type)) {
				throw new ServiceError(
					'Dismiss and Reopen entries can only be reversed with their matching action.'
				);
			}
			const remove = correction.remove === true || correction.remove === '1';
			if (remove) {
				db.prepare('DELETE FROM job_updates WHERE id = ?').run(id);
			} else {
				const values = parseUpdateInput({
					job_id: existing.job_id,
					event_type:
						correction.event_type === '' ? null : (correction.event_type ?? existing.event_type),
					event_date: correction.event_date ?? existing.event_date,
					note: correction.note ?? existing.note
				});
				db.prepare(
					'UPDATE job_updates SET event_type = ?, event_date = ?, note = ?, updated_at = ? WHERE id = ?'
				).run(values.event_type, values.event_date, values.note, timestamp(), id);
			}
			const jobUpdatedAt = timestamp();
			db.prepare('UPDATE jobs SET updated_at = ?, is_active = ? WHERE id = ?').run(
				jobUpdatedAt,
				replayActive(db, existing.job_id),
				existing.job_id
			);
			return jobFromRow(getJobRow(db, existing.job_id), readUpdates(db, existing.job_id));
		})
	);
}

export function dismissJob(
	id,
	eventDate = new Date().toISOString().slice(0, 10),
	createdVia = 'manual'
) {
	const date = parseEventDate(eventDate);
	return withDatabase((db) =>
		inTransaction(db, () => {
			const job = getJobRow(db, id);
			if (!job) throw new ServiceError('Job not found.', 'not_found');
			if (!job.is_active) throw new ServiceError('This job is already inactive.');
			eventUpdate(db, { jobId: id, eventType: 'dismissed', eventDate: date, createdVia });
			return jobFromRow(getJobRow(db, id), readUpdates(db, id));
		})
	);
}

export function reopenJob(
	id,
	eventDate = new Date().toISOString().slice(0, 10),
	createdVia = 'manual'
) {
	const date = parseEventDate(eventDate);
	return withDatabase((db) =>
		inTransaction(db, () => {
			const job = getJobRow(db, id);
			if (!job) throw new ServiceError('Job not found.', 'not_found');
			if (job.is_active) throw new ServiceError('This job is already active.');
			const lastState = db
				.prepare(
					"SELECT event_type FROM job_updates WHERE job_id = ? AND event_type IN ('accepted', 'rejected', 'dismissed', 'reopened') ORDER BY recorded_order DESC LIMIT 1"
				)
				.get(id)?.event_type;
			if (lastState !== 'dismissed') {
				throw new ServiceError(
					'Only a dismissed job can be reopened. Correct an outcome if it was recorded by mistake.'
				);
			}
			eventUpdate(db, { jobId: id, eventType: 'reopened', eventDate: date, createdVia });
			return jobFromRow(getJobRow(db, id), readUpdates(db, id));
		})
	);
}

export function getDashboardStats({ today = new Date().toISOString().slice(0, 10) } = {}) {
	return withDatabase((db) => {
		const stats = {
			active: Number(
				db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE is_active = 1').get().count
			),
			applied: 0,
			prescreened: 0,
			interview_1: 0,
			interview_2: 0,
			offer: 0,
			accepted: 0,
			rejected: 0,
			dismissed: 0
		};
		for (const row of db
			.prepare(
				'SELECT event_type, COUNT(DISTINCT job_id) AS count FROM job_updates WHERE event_type IS NOT NULL GROUP BY event_type'
			)
			.all()) {
			if (row.event_type in stats && row.event_type !== 'active')
				stats[row.event_type] = Number(row.count);
		}
		const recentJobs = listJobs({ includeInactive: true, limit: 5 });
		// Future-dated updates on active jobs, soonest first. Same rule as the job detail page.
		const upcoming = db
			.prepare(
				`SELECT u.id, u.job_id, u.event_type, u.event_date, j.job_title, j.company_name
				 FROM job_updates u JOIN jobs j ON j.id = u.job_id
				 WHERE u.event_date > ? AND j.is_active = 1
				 ORDER BY u.event_date ASC, u.recorded_order ASC LIMIT 5`
			)
			.all(today)
			.map((row) => ({
				id: row.id,
				jobId: row.job_id,
				label: row.event_type ? EVENT_LABELS[row.event_type] : 'Note',
				date: row.event_date,
				title: row.job_title,
				company: row.company_name
			}));
		return { stats, recentJobs, upcoming };
	});
}

export { ServiceError, ValidationError };
