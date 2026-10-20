import {
	editableJobFields,
	assessmentJobFields,
	jobColumns,
	jobFromStorage,
	jobToStorage
} from '../job-fields.js';
import { startingStage, stageById, readWorkflow } from './workflow.js';
import { inTransaction, withDatabase, reserveJobFileIds } from './database.js';
import {
	jobSearchSchema,
	parseRecordId,
	parseSchema,
	parseAssessment,
	parseEventDate,
	parseJobInput,
	parseUpdateInput,
	localCalendarDate,
	ServiceError,
	ValidationError
} from './validation.js';

const timestamp = () => new Date().toISOString();
function shortDate(value) {
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(`${value}T00:00:00Z`));
}
const joinedJobs =
	'SELECT j.*, s.name AS stage_name, s.is_closed AS stage_closed, s.is_archived AS stage_archived FROM jobs j JOIN workflow_stages s ON s.id=j.current_stage_id';
function readUpdates(db, jobId) {
	return db
		.prepare(
			'SELECT u.*,s.name AS stage_name,s.is_archived AS stage_archived FROM job_updates u LEFT JOIN workflow_stages s ON s.id=u.stage_id WHERE u.job_id=? ORDER BY u.event_date DESC,u.id DESC'
		)
		.all(jobId)
		.map(updateFromRow);
}
function updateFromRow(row) {
	return {
		id: row.id,
		jobId: row.job_id,
		stageId: row.stage_id,
		date: row.event_date,
		note: row.note,
		createdVia: row.created_via,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		label: row.stage_id ? row.stage_name : 'General note',
		isArchived: Boolean(row.stage_archived)
	};
}
function jobFromRow(row, updates = []) {
	return {
		...jobFromStorage(row),
		isActive: !row.stage_closed,
		currentStage: {
			id: row.current_stage_id,
			name: row.stage_name,
			is_closed: Boolean(row.stage_closed),
			is_archived: Boolean(row.stage_archived)
		},
		status: {
			key: String(row.current_stage_id),
			label: row.stage_name,
			tone: row.stage_closed ? 'muted' : 'progress'
		},
		updates
	};
}
function getJobRow(db, id) {
	return db.prepare(`${joinedJobs} WHERE j.id=?`).get(parseRecordId(id, 'job_id'));
}
function historyEntry(db, { job_id, stage_id, event_date, note }, createdVia) {
	if (!['manual', 'mcp'].includes(createdVia)) throw new ServiceError('Unknown record source.');
	if (stage_id) stageById(db, stage_id);
	const stamp = timestamp();
	const { lastInsertRowid: id } = db
		.prepare(
			'INSERT INTO job_updates(job_id,stage_id,event_date,note,created_via,created_at,updated_at) VALUES(?,?,?,?,?,?,?)'
		)
		.run(job_id, stage_id, event_date, note, createdVia, stamp, stamp);
	db.prepare('UPDATE jobs SET updated_at=? WHERE id=?').run(stamp, job_id);
	return Number(id);
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
				current_stage_id: startingStage(db).id,
				created_via: createdVia,
				created_at: now,
				updated_at: now
			};
			const fields = jobColumns().filter((name) => name !== 'id');
			reserveJobFileIds(db);
			const { lastInsertRowid: id } = db
				.prepare(
					`INSERT INTO jobs (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`
				)
				.run(
					...fields.map((name) =>
						typeof record[name] === 'boolean' ? Number(record[name]) : record[name]
					)
				);

			historyEntry(
				db,
				{
					job_id: Number(id),
					stage_id: record.current_stage_id,
					event_date: localCalendarDate(),
					note: null
				},
				createdVia
			);
			return jobFromRow(getJobRow(db, id), readUpdates(db, id));
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

export function listJobs({ includeInactive = false, query = '', limit = 100 } = {}) {
	return searchJobs({ view: includeInactive ? 'all' : 'active', query, limit }).jobs;
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
			clauses.push('s.is_closed = ?');
			args.push(filters.view === 'active' ? 0 : 1);
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
			clauses.push(
				"(j.job_title LIKE ? ESCAPE '\\' OR j.company_name LIKE ? ESCAPE '\\' OR j.location LIKE ? ESCAPE '\\')"
			);
			args.push(contains(filters.query), contains(filters.query), contains(filters.query));
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
		for (const key of ['current_stage', 'milestone_stage']) {
			if (!filters[key].length) continue;
			for (const id of filters[key]) {
				try {
					stageById(db, id, { available: key === 'current_stage' });
				} catch (e) {
					throw new ValidationError({ [key]: e.fieldErrors?.stage_id ?? e.message });
				}
			}
			const places = filters[key].map(() => '?').join(',');
			clauses.push(
				key === 'current_stage'
					? `j.current_stage_id IN (${places})`
					: `EXISTS(SELECT 1 FROM job_updates u WHERE u.job_id=j.id AND u.stage_id IN (${places}))`
			);
			args.push(...filters[key]);
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
		const from = 'FROM jobs j JOIN workflow_stages s ON s.id=j.current_stage_id';
		const total = Number(db.prepare(`SELECT COUNT(*) AS n ${from} ${where}`).get(...args).n);
		const totalPages = Math.max(1, Math.ceil(total / filters.limit));
		const page = Math.min(filters.page, totalPages);
		const jobs = db
			.prepare(`${joinedJobs} ${where} ORDER BY ${sorting[filters.sort]},j.id ASC LIMIT ? OFFSET ?`)
			.all(...args, filters.limit, (page - 1) * filters.limit)
			.map((row) => {
				const job = jobFromRow(row);
				const latest = db
					.prepare(
						'SELECT u.*,s.name AS stage_name FROM job_updates u LEFT JOIN workflow_stages s ON s.id=u.stage_id WHERE u.job_id=? ORDER BY u.id DESC LIMIT 1'
					)
					.get(row.id);
				return {
					...job,
					updates: undefined,
					latestUpdate: latest
						? `${latest.stage_name ?? 'General note'} · ${shortDate(latest.event_date)}`
						: 'No history yet'
				};
			});
		const result = {
			jobs,
			total,
			page,
			limit: filters.limit,
			totalPages,
			totalJobs: Number(db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n)
		};
		db.exec('COMMIT');
		return result;
	});
}

export function addJobUpdate(input, createdVia = 'manual') {
	const values = parseUpdateInput(input);
	return withDatabase((db) =>
		inTransaction(db, () => {
			if (!getJobRow(db, values.job_id)) throw new ServiceError('Job not found.', 'not_found');
			const id = historyEntry(db, values, createdVia);
			return readUpdates(db, values.job_id).find((row) => row.id === id);
		})
	);
}
export function moveJobStage(id, input, createdVia = 'manual') {
	id = parseRecordId(id, 'job_id');
	const values = parseUpdateInput({ ...input, job_id: id });
	if (!values.stage_id) throw new ValidationError({ stage_id: 'Choose a destination stage.' });
	if (values.event_date > localCalendarDate())
		throw new ValidationError({
			event_date: 'A stage change takes effect now. Choose today or a past date.'
		});
	if (!['manual', 'mcp'].includes(createdVia)) throw new ServiceError('Unknown record source.');
	return withDatabase((db) =>
		inTransaction(db, () => {
			const job = getJobRow(db, id);
			if (!job) throw new ServiceError('Job not found.', 'not_found');
			stageById(db, values.stage_id, { available: true });
			if (job.current_stage_id === values.stage_id)
				return { ...jobFromRow(job, readUpdates(db, id)), unchanged: true };
			db.prepare('UPDATE jobs SET current_stage_id=? WHERE id=?').run(values.stage_id, id);
			historyEntry(db, values, createdVia);
			return jobFromRow(getJobRow(db, id), readUpdates(db, id));
		})
	);
}
export function correctJobUpdate(id, correction = {}) {
	id = parseRecordId(id, 'update_id');
	const jobId = parseRecordId(correction.job_id, 'job_id');
	return withDatabase((db) =>
		inTransaction(db, () => {
			const existing = db
				.prepare('SELECT * FROM job_updates WHERE id=? AND job_id=?')
				.get(id, jobId);
			if (!existing) throw new ServiceError('History entry not found for this job.', 'not_found');
			const job = getJobRow(db, jobId);
			const remove = correction.remove === true || correction.remove === '1';
			const values = remove
				? null
				: parseUpdateInput({ ...existing, ...correction, job_id: jobId });
			if (
				existing.stage_id === job.current_stage_id &&
				(remove || values.stage_id !== job.current_stage_id)
			) {
				const other = db
					.prepare('SELECT 1 FROM job_updates WHERE job_id=? AND stage_id=? AND id<>? LIMIT 1')
					.get(jobId, job.current_stage_id, id);
				if (!other)
					throw new ServiceError(
						'This milestone supports the current stage. Move the job to another stage first, then edit or remove it.',
						'current_stage_evidence'
					);
			}
			if (remove) db.prepare('DELETE FROM job_updates WHERE id=?').run(id);
			else {
				if (values.stage_id) stageById(db, values.stage_id);
				db.prepare(
					'UPDATE job_updates SET stage_id=?,event_date=?,note=?,updated_at=? WHERE id=?'
				).run(values.stage_id, values.event_date, values.note, timestamp(), id);
			}
			db.prepare('UPDATE jobs SET updated_at=? WHERE id=?').run(timestamp(), jobId);
			return jobFromRow(getJobRow(db, jobId), readUpdates(db, jobId));
		})
	);
}
export function getDashboardStats({ today = localCalendarDate() } = {}) {
	return withDatabase((db) => {
		db.exec('BEGIN');
		const stages = readWorkflow(db);
		const stagesWithHistory = stages.map((stage) => ({
			...stage,
			history_count: Number(
				db
					.prepare('SELECT COUNT(DISTINCT job_id) AS n FROM job_updates WHERE stage_id=?')
					.get(stage.id).n
			)
		}));
		const stats = {
			active: Number(
				db
					.prepare(
						'SELECT COUNT(*) AS n FROM jobs j JOIN workflow_stages s ON s.id=j.current_stage_id WHERE s.is_closed=0'
					)
					.get().n
			)
		};
		const recentJobs = db
			.prepare(`${joinedJobs} ORDER BY j.updated_at DESC,j.id DESC LIMIT 5`)
			.all()
			.map((row) => ({ ...jobFromRow(row), updates: undefined }));
		const upcoming = db
			.prepare(
				`SELECT u.*,s.name AS stage_name,j.job_title,j.company_name FROM job_updates u JOIN jobs j ON j.id=u.job_id JOIN workflow_stages current ON current.id=j.current_stage_id LEFT JOIN workflow_stages s ON s.id=u.stage_id WHERE u.event_date>? AND current.is_closed=0 ORDER BY u.event_date,u.id LIMIT 5`
			)
			.all(today)
			.map((row) => ({
				id: row.id,
				jobId: row.job_id,
				label: row.stage_name ?? 'General note',
				date: row.event_date,
				title: row.job_title,
				company: row.company_name
			}));
		const due = (column, extra = '', args = []) =>
			db
				.prepare(
					`${joinedJobs} WHERE s.is_closed=0 AND j.${column} IS NOT NULL ${extra} ORDER BY j.${column},j.id`
				)
				.all(...args)
				.map((row) => ({
					jobId: row.id,
					title: row.job_title,
					company: row.company_name,
					date: row[column],
					comment: column === 'follow_up_date' ? row.follow_up_comment : null
				}));
		const followUps = due('follow_up_date');
		const deadlines = due('application_deadline', 'AND j.application_deadline>=?', [today]);
		const totalJobs = Number(db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n);
		db.exec('COMMIT');
		return {
			stats,
			stages: stagesWithHistory,
			recentJobs,
			upcoming,
			followUps,
			deadlines,
			totalJobs
		};
	});
}
export { ServiceError, ValidationError };
