import { z } from 'zod';
import { withDatabase, inTransaction } from './database.js';
import {
	ServiceError,
	ValidationError,
	parseSchema,
	networkInputSchema,
	networkInputShape,
	networkIdSchema,
	parseRecordId,
	recordIdInputSchema,
	networkSearchShape,
	networkPaginationShape,
	networkLinkShape,
	networkUpdateShape,
	networkUpdateSearchSchema,
	localCalendarDate
} from './validation.js';

const summary = `SELECT n.*, (SELECT MAX(interaction_date) FROM network_updates u WHERE u.network_id=n.id) AS latest_interaction_date, (SELECT COUNT(*) FROM network_updates u WHERE u.network_id=n.id) AS interaction_count FROM networks n`;
const missing = (label) => {
	throw new ServiceError(`${label} was not found.`, 'not_found');
};
function person(db, id) {
	id = parseRecordId(id, 'network_id');
	return db.prepare(`${summary} WHERE n.id=?`).get(id) ?? missing('Person');
}
function parents(db, input) {
	person(db, input.network_id);
	if (!db.prepare('SELECT id FROM jobs WHERE id=?').get(input.job_id)) missing('Job');
}
function origin(value) {
	return parseSchema(z.enum(['manual', 'mcp']), value);
}
function pageRows(db, select, count, args, input, order) {
	const total = Number(db.prepare(count).get(...args).total);
	const totalPages = Math.max(1, Math.ceil(total / input.limit));
	const page = Math.min(input.page, totalPages);
	const rows = db
		.prepare(`${select} ORDER BY ${order} LIMIT ? OFFSET ?`)
		.all(...args, input.limit, (page - 1) * input.limit);
	return { rows, total, page, limit: input.limit, totalPages };
}
function read(callback) {
	return withDatabase((db) => {
		db.exec('BEGIN');
		return callback(db);
	});
}
function write(callback) {
	return withDatabase((db) => inTransaction(db, () => callback(db)));
}
function linkResult(row) {
	return { ...row, linked: true };
}
function relatedRow(row, key) {
	const { link_notes, link_created_via, link_created_at, link_updated_at, ...record } = row;
	return {
		...record,
		job_link: {
			job_id: key === 'job' ? record.id : record.job_id,
			network_id: key === 'job' ? record.network_id : record.id,
			notes: link_notes,
			created_via: link_created_via,
			created_at: link_created_at,
			updated_at: link_updated_at
		}
	};
}
const linkColumns =
	'l.notes AS link_notes, l.created_via AS link_created_via, l.created_at AS link_created_at, l.updated_at AS link_updated_at';

export function listNetworks(input = {}) {
	const filters = parseSchema(z.object(networkSearchShape), input);
	return read((db) => {
		if (filters.job_id && !db.prepare('SELECT id FROM jobs WHERE id=?').get(filters.job_id))
			missing('Job');
		const where = [],
			args = [];
		const contains = (value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
		for (const key of ['name', 'role', 'organization'])
			if (filters[key]) {
				where.push(`n.${key} LIKE ? ESCAPE '\\'`);
				args.push(contains(filters[key]));
			}
		if (filters.query) {
			where.push(
				"(n.name LIKE ? ESCAPE '\\' OR n.role LIKE ? ESCAPE '\\' OR n.organization LIKE ? ESCAPE '\\')"
			);
			args.push(...Array(3).fill(contains(filters.query)));
		}
		if (filters.job_id) {
			where.push('l.job_id=?');
			args.push(filters.job_id);
		}
		if (filters.follow_up === 'not_scheduled') where.push('n.follow_up_date IS NULL');
		else if (filters.follow_up !== 'all') {
			where.push(
				`n.follow_up_date ${{ overdue: '<', today: '=', upcoming: '>' }[filters.follow_up]} ?`
			);
			args.push(localCalendarDate());
		}
		const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
		const from = filters.job_id ? ' JOIN job_networks l ON l.network_id=n.id' : '';
		const select = filters.job_id
			? summary.replace('n.*,', 'n.*, l.job_id, ' + linkColumns + ',')
			: summary;
		const sort =
			{
				name: '',
				follow_up: 'n.follow_up_date IS NULL, n.follow_up_date, ',
				latest_interaction: 'latest_interaction_date IS NULL, latest_interaction_date DESC, '
			}[filters.sort] + 'n.name COLLATE NOCASE, n.id';
		const { rows, ...pagination } = pageRows(
			db,
			select + from + clause,
			'SELECT COUNT(*) AS total FROM networks n' + from + clause,
			args,
			filters,
			sort
		);
		return {
			networks: filters.job_id ? rows.map((row) => relatedRow(row, 'person')) : rows,
			...pagination
		};
	});
}
export function getNetwork(id) {
	return read((db) => person(db, id));
}
export function createNetwork(input, createdVia = 'manual') {
	const values = parseSchema(networkInputSchema, input),
		created_via = origin(createdVia);
	return write((db) => {
		const timestamp = new Date().toISOString();
		const record = { ...values, created_via, created_at: timestamp, updated_at: timestamp };
		const keys = Object.keys(record);
		const { lastInsertRowid: id } = db
			.prepare(`INSERT INTO networks (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
			.run(...Object.values(record));
		return person(db, id);
	});
}
export function editNetwork(id, patch) {
	const keys = Object.keys(networkInputShape).filter(
		(key) => Object.hasOwn(patch, key) && patch[key] !== undefined
	);
	if (!keys.length) throw new ValidationError({ form: 'Supply at least one editable field.' });
	return write((db) => {
		const previous = person(db, id),
			merged = { ...previous, ...Object.fromEntries(keys.map((key) => [key, patch[key]])) };
		if (
			keys.includes('follow_up_date') &&
			(merged.follow_up_date == null ||
				(typeof merged.follow_up_date === 'string' && !merged.follow_up_date.trim()))
		)
			merged.follow_up_comment = null;
		const values = parseSchema(networkInputSchema, merged);
		db.prepare(
			`UPDATE networks SET ${Object.keys(values)
				.map((key) => `${key}=?`)
				.join(',')}, updated_at=? WHERE id=?`
		).run(...Object.values(values), new Date().toISOString(), id);
		return person(db, id);
	});
}
export function setNetworkFollowUp(input) {
	if (!Object.hasOwn(input, 'follow_up_date') || input.follow_up_date === undefined)
		throw new ValidationError({ follow_up_date: 'Supply a date or null to clear.' });
	const parsed = parseSchema(
		z.object({
			network_id: networkIdSchema,
			follow_up_date: networkInputShape.follow_up_date,
			follow_up_comment: networkInputShape.follow_up_comment
		}),
		input
	);
	return write((db) => {
		const previous = person(db, parsed.network_id);
		const values = parseSchema(networkInputSchema, {
			...previous,
			follow_up_date: parsed.follow_up_date,
			follow_up_comment: parsed.follow_up_date ? parsed.follow_up_comment : null
		});
		if (
			previous.follow_up_date !== values.follow_up_date ||
			previous.follow_up_comment !== values.follow_up_comment
		)
			db.prepare(
				'UPDATE networks SET follow_up_date=?, follow_up_comment=?, updated_at=? WHERE id=?'
			).run(values.follow_up_date, values.follow_up_comment, new Date().toISOString(), previous.id);
		return person(db, previous.id);
	});
}
export function listNetworkJobs(input) {
	const values = parseSchema(
		z.object({ network_id: networkIdSchema, ...networkPaginationShape }),
		input
	);
	return read((db) => {
		person(db, values.network_id);
		const { rows, ...pagination } = pageRows(
			db,
			`SELECT j.*, l.network_id, ${linkColumns} FROM jobs j JOIN job_networks l ON l.job_id=j.id WHERE l.network_id=?`,
			'SELECT COUNT(*) AS total FROM job_networks WHERE network_id=?',
			[values.network_id],
			values,
			'j.updated_at DESC, j.id'
		);
		return { jobs: rows.map((row) => relatedRow(row, 'job')), ...pagination };
	});
}
export function linkJobNetwork(input, createdVia = 'manual') {
	const values = parseSchema(z.object(networkLinkShape), input),
		created_via = origin(createdVia);
	return write((db) => {
		parents(db, values);
		const existing = db
			.prepare('SELECT * FROM job_networks WHERE job_id=? AND network_id=?')
			.get(values.job_id, values.network_id);
		if (existing) return { ...linkResult(existing), created: false };
		const timestamp = new Date().toISOString();
		db.prepare(
			'INSERT INTO job_networks (job_id,network_id,notes,created_via,created_at,updated_at) VALUES (?,?,?,?,?,?)'
		).run(values.job_id, values.network_id, values.notes, created_via, timestamp, timestamp);
		return {
			...values,
			created_via,
			created_at: timestamp,
			updated_at: timestamp,
			linked: true,
			created: true
		};
	});
}
export function editJobNetwork(input) {
	if (!Object.hasOwn(input, 'notes') || input.notes === undefined)
		throw new ValidationError({ notes: 'Supply a note or null to clear.' });
	const values = parseSchema(z.object(networkLinkShape), input);
	return write((db) => {
		parents(db, values);
		const result = db
			.prepare('UPDATE job_networks SET notes=?,updated_at=? WHERE job_id=? AND network_id=?')
			.run(values.notes, new Date().toISOString(), values.job_id, values.network_id);
		if (!result.changes) missing('Relationship');
		return linkResult(
			db
				.prepare('SELECT * FROM job_networks WHERE job_id=? AND network_id=?')
				.get(values.job_id, values.network_id)
		);
	});
}
export function unlinkJobNetwork(input) {
	const values = parseSchema(
		z.object({ job_id: networkLinkShape.job_id, network_id: networkIdSchema }),
		input
	);
	return write((db) => {
		parents(db, values);
		const result = db
			.prepare('DELETE FROM job_networks WHERE job_id=? AND network_id=?')
			.run(values.job_id, values.network_id);
		return { ...values, linked: false, removed: !!result.changes };
	});
}
// One batched lookup lets pickers disable existing links beyond the displayed page.
export function networkLinkIds({ job_id, network_id }) {
	if (job_id !== undefined) job_id = parseRecordId(job_id, 'job_id');
	else network_id = parseRecordId(network_id, 'network_id');
	return read((db) => {
		if (job_id) {
			if (!db.prepare('SELECT id FROM jobs WHERE id=?').get(job_id)) missing('Job');
			return db
				.prepare('SELECT network_id AS id FROM job_networks WHERE job_id=?')
				.all(job_id)
				.map((row) => row.id);
		}
		person(db, network_id);
		return db
			.prepare('SELECT job_id AS id FROM job_networks WHERE network_id=?')
			.all(network_id)
			.map((row) => row.id);
	});
}
export function listNetworkUpdates(input) {
	const values = parseSchema(networkUpdateSearchSchema, input);
	return read((db) => {
		person(db, values.network_id);
		let clause = ' WHERE network_id=?';
		const args = [values.network_id];
		for (const [key, operator] of [
			['date_from', '>='],
			['date_to', '<=']
		])
			if (values[key]) {
				clause += ` AND interaction_date${operator}?`;
				args.push(values[key]);
			}
		const { rows, ...pagination } = pageRows(
			db,
			'SELECT * FROM network_updates' + clause,
			'SELECT COUNT(*) AS total FROM network_updates' + clause,
			args,
			values,
			'interaction_date DESC, id DESC'
		);
		return { updates: rows, ...pagination };
	});
}
export function addNetworkUpdate(input, createdVia = 'manual') {
	const values = parseSchema(z.object(networkUpdateShape), input),
		created_via = origin(createdVia);
	return write((db) => {
		person(db, values.network_id);
		const timestamp = new Date().toISOString();
		const { lastInsertRowid: id } = db
			.prepare(
				'INSERT INTO network_updates (network_id,interaction_date,note,created_via,created_at,updated_at) VALUES (?,?,?,?,?,?)'
			)
			.run(
				values.network_id,
				values.interaction_date,
				values.note,
				created_via,
				timestamp,
				timestamp
			);
		return db.prepare('SELECT * FROM network_updates WHERE id=?').get(id);
	});
}
function update(db, input) {
	input = parseSchema(
		z.object({ network_id: networkIdSchema, update_id: recordIdInputSchema }),
		input
	);
	person(db, input.network_id);
	return (
		db
			.prepare('SELECT * FROM network_updates WHERE network_id=? AND id=?')
			.get(input.network_id, input.update_id) ?? missing('Interaction')
	);
}
export function editNetworkUpdate(input) {
	if (input.interaction_date === undefined && input.note === undefined)
		throw new ValidationError({ form: 'Supply a date or note to correct.' });
	return write((db) => {
		const previous = update(db, input);
		const values = parseSchema(z.object(networkUpdateShape), {
			...previous,
			...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
		});
		db.prepare(
			'UPDATE network_updates SET interaction_date=?,note=?,updated_at=? WHERE id=? AND network_id=?'
		).run(
			values.interaction_date,
			values.note,
			new Date().toISOString(),
			previous.id,
			previous.network_id
		);
		return db.prepare('SELECT * FROM network_updates WHERE id=?').get(previous.id);
	});
}
export function deleteNetworkUpdate(input) {
	if (input.confirm !== true)
		throw new ValidationError({ confirm: 'Confirm permanent deletion of this interaction.' });
	return write((db) => {
		const previous = update(db, input);
		db.prepare('DELETE FROM network_updates WHERE id=? AND network_id=?').run(
			previous.id,
			previous.network_id
		);
		return { network_id: previous.network_id, update_id: previous.id, deleted: true };
	});
}
