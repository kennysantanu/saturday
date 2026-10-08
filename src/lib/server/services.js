import {
	editableJobFields,
	assessmentJobFields,
	jobColumns,
	jobFromStorage,
	jobToStorage
} from '../job-fields.js';
import { EVENT_LABELS } from '../event-labels.js';
import { inTransaction, withDatabase } from './database.js';
import {
	jobSearchSchema,
	parseRecordId,
	parseSchema,
	parseAssessment,
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
			`SELECT id, job_id, event_type, event_date, note, created_via, created_at, updated_at
			 FROM job_updates WHERE job_id = ? ORDER BY event_date DESC, id DESC`
		)
		.all(jobId)
		.map(updateFromRow);
}

function updateFromRow(row) {
	return {
		id: row.id,
		jobId: row.job_id,
		eventType: row.event_type,
		date: row.event_date,
		note: row.note,
		createdVia: row.created_via,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		label: row.event_type ? EVENT_LABELS[row.event_type] : 'Note'
	};
}

function statusFor(isActive, updates) {
	const stateHistory = [...updates]
		.filter((update) => stateEvents.has(update.eventType))
		.sort((a, b) => a.id - b.id);
	let latestState = null;
	for (const update of stateHistory) latestState = update.eventType;

	if (!isActive) {
		if (latestState === 'accepted') return { key: 'accepted', label: 'Accepted', tone: 'success' };
		if (latestState === 'rejected') return { key: 'rejected', label: 'Rejected', tone: 'danger' };
		return { key: 'dismissed', label: 'Dismissed', tone: 'muted' };
	}

	const reached = updates.reduce(
		(furthest, update) => Math.max(furthest, milestoneRank[update.eventType] ?? 0),
		0
	);
	if (reached === 5) return { key: 'offer', label: 'Offer', tone: 'success' };
	if (reached >= 2) {
		const furthestType = Object.keys(milestoneRank).find((key) => milestoneRank[key] === reached);
		return {
			key: furthestType,
			label: `In process · ${EVENT_LABELS[furthestType]}`,
			tone: 'progress'
		};
	}
	if (reached === 1) return { key: 'applied', label: 'Applied', tone: 'info' };
	return { key: 'new', label: 'New', tone: 'neutral' };
}

function jobFromRow(row, updates = []) {
	const isActive = Boolean(row.is_active);
	return { ...jobFromStorage(row), status: statusFor(isActive, updates), updates };
}

function getJobRow(db, id) {
	id = parseRecordId(id, 'job_id');
	return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

function eventUpdate(db, { jobId, eventType, eventDate, note = null, createdVia }) {
	const now = timestamp();
	const { lastInsertRowid: id } = db
		.prepare(
			`INSERT INTO job_updates (job_id, event_type, event_date, note, created_via, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(jobId, eventType, eventDate, note, createdVia, now, now);
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
			 ORDER BY id`
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
			const assessment =
				createdVia === 'mcp'
					? parseAssessment({
							...Object.fromEntries(assessmentJobFields.map((field) => [field.name, null])),
							...input
						})
					: Object.fromEntries(assessmentJobFields.map((field) => [field.name, null]));
			const record = {
				...values,
				...assessment,
				is_active: true,
				created_via: createdVia,
				created_at: now,
				updated_at: now
			};
			const fields = jobColumns().filter((name) => name !== 'id');
			const { lastInsertRowid: id } = db
				.prepare(
					`INSERT INTO jobs (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`
				)
				.run(
					...fields.map((name) =>
						typeof record[name] === 'boolean' ? Number(record[name]) : record[name]
					)
				);

			return jobFromRow(getJobRow(db, id));
		})
	);
}

function saveJobFields(db, id, values, fields) {
	db.prepare(
		`UPDATE jobs SET ${fields.map((field) => `${field.name} = ?`).join(',')}, updated_at = ? WHERE id = ?`
	).run(...jobToStorage(values, fields), timestamp(), id);
}
export function editJob(id, input) {
	id = parseRecordId(id, 'job_id');
	return withDatabase((db) =>
		inTransaction(db, () => {
			const existing = getJobRow(db, id);
			if (!existing) throw new ServiceError('Job not found.', 'not_found');
			const merged = {
				...Object.fromEntries(
					editableJobFields.map((field) => [
						field.name,
						field.type === 'boolean' ? Boolean(existing[field.name]) : existing[field.name]
					])
				),
				...input
			};
			for (const field of editableJobFields) {
				if (field.requires && field.requires in input && !input[field.requires])
					merged[field.name] = null;
			}
			const values = parseJobInput(merged);
			saveJobFields(db, id, values, editableJobFields);
			return jobFromRow(getJobRow(db, id), readUpdates(db, id));
		})
	);
}

// Assessment writes are exposed through MCP only; normal job editing never changes them.
export function setJobScore(id, input) {
	id = parseRecordId(id, 'job_id');
	const values = parseAssessment(input);
	return withDatabase((db) =>
		inTransaction(db, () => {
			if (!getJobRow(db, id)) throw new ServiceError('Job not found.', 'not_found');
			saveJobFields(db, id, values, assessmentJobFields);
			return jobFromRow(getJobRow(db, id), readUpdates(db, id));
		})
	);
}
export function setJobFollowUp(id, date, comment) {
	return editJob(id, { follow_up_date: date, follow_up_comment: date ? (comment ?? null) : null });
}
export function setJobStarred(id, starred) {
	return editJob(id, { is_starred: starred });
}

export function getJob(id) {
	id = parseRecordId(id, 'job_id');
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
			const latest = [...updates].sort((a, b) => b.id - a.id)[0];
			const job = jobFromRow(row, updates);
			return {
				...job,
				updates: undefined,
				latestUpdate: latest ? `${latest.label} · ${shortDate(latest.date)}` : 'No updates yet'
			};
		});
	});
}

/** Paginated, read-only search. Status rules are shared with job detail and legacy lists. */
export function searchJobs(input = {}) {
	const filters = parseSchema(jobSearchSchema, input);
	return withDatabase((db) => {
		// Keep history, records, and counts on one read snapshot while MCP may write.
		db.exec('BEGIN');
		const clauses = [];
		const args = [];
		if (filters.view !== 'all') {
			clauses.push('j.is_active = ?');
			args.push(filters.view === 'active' ? 1 : 0);
		}
		const contains = (value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
		for (const [key, column] of Object.entries({
			title: 'job_title',
			company: 'company_name',
			location: 'location',
			source: 'source'
		})) {
			if (filters[key]) {
				clauses.push(`j.${column} LIKE ? ESCAPE '\\'`);
				args.push(contains(filters[key]));
			}
		}
		if (filters.query) {
			clauses.push("(j.job_title LIKE ? ESCAPE '\\' OR j.company_name LIKE ? ESCAPE '\\')");
			args.push(contains(filters.query), contains(filters.query));
		}
		if (filters.starred !== 'all') {
			clauses.push('j.is_starred = ?');
			args.push(filters.starred === 'starred' ? 1 : 0);
		}
		for (const key of ['work_arrangement', 'employment_type', 'created_via']) {
			if (!filters[key].length) continue;
			const specified = filters[key].filter((value) => value !== 'unset');
			const alternatives = [];
			if (specified.length) {
				alternatives.push(`j.${key} IN (${specified.map(() => '?').join(',')})`);
				args.push(...specified);
			}
			if (filters[key].includes('unset')) alternatives.push(`j.${key} IS NULL`);
			clauses.push(`(${alternatives.join(' OR ')})`);
		}
		if (filters.step.length) {
			clauses.push(
				`EXISTS (SELECT 1 FROM job_updates u WHERE u.job_id = j.id AND u.event_type IN (${filters.step.map(() => '?').join(',')}))`
			);
			args.push(...filters.step);
		}
		const now = new Date();
		const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		for (const [key, column] of [
			['follow_up', 'follow_up_date'],
			['deadline', 'application_deadline']
		]) {
			const mode = filters[key];
			if (mode === 'unset' || mode === 'set')
				clauses.push(`j.${column} IS ${mode === 'set' ? 'NOT ' : ''}NULL`);
			if (['overdue', 'today', 'upcoming'].includes(mode)) {
				clauses.push(`j.${column} ${mode === 'overdue' ? '<' : mode === 'upcoming' ? '>' : '='} ?`);
				args.push(today);
			}
			if (mode === 'range') {
				clauses.push(`j.${column} IS NOT NULL`);
				if (filters[`${key}_from`]) {
					clauses.push(`j.${column} >= ?`);
					args.push(filters[`${key}_from`]);
				}
				if (filters[`${key}_to`]) {
					clauses.push(`j.${column} <= ?`);
					args.push(filters[`${key}_to`]);
				}
			}
		}
		for (const key of ['created', 'updated']) {
			for (const bound of ['from', 'to']) {
				const value = filters[`${key}_${bound}`];
				if (!value) continue;
				const date = new Date(`${value}T00:00:00`);
				if (bound === 'to') date.setDate(date.getDate() + 1);
				clauses.push(`j.${key}_at ${bound === 'from' ? '>=' : '<'} ?`);
				args.push(date.toISOString());
			}
		}
		if (filters.score !== 'any')
			clauses.push(`j.score IS ${filters.score === 'scored' ? 'NOT ' : ''}NULL`);
		if (filters.score_min !== undefined) {
			clauses.push('j.score >= ?');
			args.push(filters.score_min);
		}
		if (filters.score_max !== undefined) {
			clauses.push('j.score <= ?');
			args.push(filters.score_max);
		}
		const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
		const sorting = {
			updated: 'j.updated_at DESC, j.created_at DESC',
			created: 'j.created_at DESC, j.updated_at DESC',
			score: 'j.score IS NULL, j.score DESC, j.updated_at DESC',
			follow_up: 'j.follow_up_date IS NULL, j.follow_up_date ASC, j.updated_at DESC',
			deadline: 'j.application_deadline IS NULL, j.application_deadline ASC, j.updated_at DESC'
		};
		// Batch history for candidates rather than one query per job; status is computed before slicing.
		const histories = new Map();
		for (const row of db
			.prepare(
				`SELECT u.* FROM job_updates u JOIN jobs j ON j.id = u.job_id ${where} ORDER BY u.event_date DESC, u.id DESC`
			)
			.all(...args)) {
			if (!histories.has(row.job_id)) histories.set(row.job_id, []);
			histories.get(row.job_id).push(updateFromRow(row));
		}
		const matches = db
			.prepare(`SELECT j.* FROM jobs j ${where} ORDER BY ${sorting[filters.sort]}, j.id ASC`)
			.all(...args)
			.map((row) => jobFromRow(row, histories.get(row.id) ?? []))
			.filter((job) => !filters.status.length || filters.status.includes(job.status.key));
		const total = matches.length;
		const totalPages = Math.max(1, Math.ceil(total / filters.limit));
		const page = Math.min(filters.page, totalPages);
		const jobs = matches.slice((page - 1) * filters.limit, page * filters.limit).map((job) => {
			const latest = job.updates.reduce(
				(last, update) => (!last || update.id > last.id ? update : last),
				null
			);
			return {
				...job,
				updates: undefined,
				latestUpdate: latest ? `${latest.label} · ${shortDate(latest.date)}` : 'No updates yet'
			};
		});
		const result = {
			jobs,
			total,
			page,
			limit: filters.limit,
			totalPages,
			totalJobs: Number(db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count)
		};
		db.exec('COMMIT');
		return result;
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
	id = parseRecordId(id, 'update_id');
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
	id = parseRecordId(id, 'job_id');
	if (!['manual', 'mcp'].includes(createdVia)) throw new ServiceError('Unknown record source.');
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
	id = parseRecordId(id, 'job_id');
	if (!['manual', 'mcp'].includes(createdVia)) throw new ServiceError('Unknown record source.');
	const date = parseEventDate(eventDate);
	return withDatabase((db) =>
		inTransaction(db, () => {
			const job = getJobRow(db, id);
			if (!job) throw new ServiceError('Job not found.', 'not_found');
			if (job.is_active) throw new ServiceError('This job is already active.');
			const lastState = db
				.prepare(
					"SELECT event_type FROM job_updates WHERE job_id = ? AND event_type IN ('accepted', 'rejected', 'dismissed', 'reopened') ORDER BY id DESC LIMIT 1"
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
				 ORDER BY u.event_date ASC, u.id ASC LIMIT 5`
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
		const followUps = db
			.prepare(
				`SELECT * FROM jobs WHERE is_active = 1 AND follow_up_date IS NOT NULL ORDER BY follow_up_date, id`
			)
			.all()
			.map((row) => ({
				jobId: row.id,
				title: row.job_title,
				company: row.company_name,
				date: row.follow_up_date,
				comment: row.follow_up_comment
			}));
		const deadlines = db
			.prepare(
				`SELECT * FROM jobs WHERE is_active = 1 AND application_deadline >= ? ORDER BY application_deadline, id`
			)
			.all(today)
			.map((row) => ({
				jobId: row.id,
				title: row.job_title,
				company: row.company_name,
				date: row.application_deadline
			}));
		return { stats, recentJobs, upcoming, followUps, deadlines };
	});
}

export { ServiceError, ValidationError };
