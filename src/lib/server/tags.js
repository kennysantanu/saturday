import { z } from 'zod';
import { withDatabase, inTransaction } from './database.js';
import { parseSchema, recordIdInputSchema, ServiceError, ValidationError } from './validation.js';
import { normalizeTagName, displayTagName, DEFAULT_TAG_COLOR } from '../tags.js';

export const tagCollectionSchema = z.enum(['job', 'person']);
export const tagInputShape = {
	name: z.string().transform((value, ctx) => {
		const name = normalizeTagName(value);
		if (!name || name.length > 50) {
			ctx.addIssue({
				code: 'custom',
				message:
					'Use letters and numbers separated by spaces, up to 50 characters. Names are saved in lowercase.'
			});
			return z.NEVER;
		}
		return name;
	}),
	color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, 'Enter a six-digit hex color, such as #64748b.')
		.transform((value) => value.toLowerCase())
		.default(DEFAULT_TAG_COLOR)
};
const configs = {
	job: { table: 'job_tags', assignments: 'job_tag_assignments', parent: 'jobs', owner: 'job_id' },
	person: {
		table: 'network_tags',
		assignments: 'network_tag_assignments',
		parent: 'networks',
		owner: 'network_id'
	}
};
const config = (collection) => configs[parseSchema(tagCollectionSchema, collection)];
const rowTag = (row) => ({ ...row, display_name: displayTagName(row.name) });
const write = (operation) => withDatabase((db) => inTransaction(db, () => operation(db)));
function read(operation) {
	return withDatabase((db) => {
		db.exec('BEGIN');
		return operation(db);
	});
}
function tag(db, c, id) {
	id = parseSchema(recordIdInputSchema, id);
	const value = db.prepare(`SELECT * FROM ${c.table} WHERE id=?`).get(id);
	if (!value) throw new ServiceError('Tag was not found. Refresh your selection.', 'not_found');
	return rowTag(value);
}
function parent(db, c, id) {
	id = parseSchema(recordIdInputSchema, id);
	if (!db.prepare(`SELECT id FROM ${c.parent} WHERE id=?`).get(id))
		throw new ServiceError('Tag owner was not found.', 'not_found');
	return id;
}
function uniqueName(db, c, name, except = []) {
	const existing = db.prepare(`SELECT * FROM ${c.table} WHERE name=?`).get(name);
	if (existing && !except.includes(existing.id)) {
		const error = new ValidationError({
			name: `The tag “${displayTagName(name)}” already exists. Use the existing tag or choose another name.`
		});
		error.existingTag = rowTag(existing);
		throw error;
	}
}
export function createTag(input) {
	const c = config(input.collection),
		values = parseSchema(z.object(tagInputShape), input);
	return write((db) => {
		uniqueName(db, c, values.name);
		const stamp = new Date().toISOString();
		const { lastInsertRowid } = db
			.prepare(`INSERT INTO ${c.table}(name,color,created_at,updated_at) VALUES(?,?,?,?)`)
			.run(values.name, values.color, stamp, stamp);
		return tag(db, c, lastInsertRowid);
	});
}
export function editTag(input) {
	const c = config(input.collection);
	return write((db) => {
		const previous = tag(db, c, input.tag_id);
		const patch = Object.fromEntries(
			['name', 'color'].filter((key) => input[key] !== undefined).map((key) => [key, input[key]])
		);
		if (!Object.keys(patch).length)
			throw new ValidationError({ form: 'Supply a name or color to edit.' });
		const values = parseSchema(z.object(tagInputShape), { ...previous, ...patch });
		uniqueName(db, c, values.name, [previous.id]);
		if (values.name !== previous.name || values.color !== previous.color)
			db.prepare(`UPDATE ${c.table} SET name=?,color=?,updated_at=? WHERE id=?`).run(
				values.name,
				values.color,
				new Date().toISOString(),
				previous.id
			);
		return tag(db, c, previous.id);
	});
}
export function listTags(input) {
	const c = config(input.collection);
	const {
		query,
		page: requested,
		limit
	} = parseSchema(
		z.object({
			query: z.string().max(200).default(''),
			page: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
			limit: z.coerce.number().int().min(1).max(100).default(20)
		}),
		input
	);
	return read((db) => {
		const normalized = normalizeTagName(query),
			args = [];
		let where = '';
		if (normalized === null) where = ' WHERE 0';
		else if (normalized) {
			where = " WHERE t.name LIKE ? ESCAPE '\\'";
			args.push(`%${normalized.replace(/[\\%_]/g, '\\$&')}%`);
		}
		const total = db.prepare(`SELECT COUNT(*) AS n FROM ${c.table} t${where}`).get(...args).n;
		const totalPages = Math.max(1, Math.ceil(total / limit)),
			page = Math.min(requested, totalPages);
		const tags = db
			.prepare(
				`SELECT t.*,(SELECT COUNT(*) FROM ${c.assignments} a WHERE a.tag_id=t.id) AS usage_count FROM ${c.table} t${where} ORDER BY replace(t.name,'_',' '),t.id LIMIT ? OFFSET ?`
			)
			.all(...args, limit, (page - 1) * limit)
			.map(rowTag);
		return { tags, total, totalPages, page, limit, invalid_query: normalized === null };
	});
}
export function getTagSelection(input) {
	const c = config(input.collection),
		ids = parseTagIds(input.tag_ids ?? []);
	return read((db) =>
		ids.map((id) => {
			const row = db.prepare(`SELECT * FROM ${c.table} WHERE id=?`).get(id);
			return row
				? rowTag(row)
				: {
						id,
						name: '',
						display_name: `Unavailable tag #${id}`,
						color: DEFAULT_TAG_COLOR,
						unavailable: true
					};
		})
	);
}
export function parseTagIds(input) {
	return [...new Set(parseSchema(z.array(recordIdInputSchema), input))];
}
export function replaceTagAssignments(db, collection, ownerId, ids) {
	const c = config(collection),
		id = parent(db, c, ownerId),
		selected = parseTagIds(ids);
	for (const tagId of selected) tag(db, c, tagId);
	const previous = db
		.prepare(`SELECT tag_id FROM ${c.assignments} WHERE ${c.owner}=?`)
		.all(id)
		.map((row) => row.tag_id);
	if (previous.length === selected.length && previous.every((tagId) => selected.includes(tagId)))
		return false;
	db.prepare(`DELETE FROM ${c.assignments} WHERE ${c.owner}=?`).run(id);
	for (const tagId of selected)
		db.prepare(`INSERT INTO ${c.assignments}(${c.owner},tag_id) VALUES(?,?)`).run(id, tagId);
	db.prepare(`UPDATE ${c.parent} SET updated_at=? WHERE id=?`).run(new Date().toISOString(), id);
	return true;
}
export function setTagAssignments(input) {
	return write((db) => {
		const changed = replaceTagAssignments(db, input.collection, input.owner_id, input.tag_ids);
		return { changed, tags: readAssignedTags(db, input.collection, input.owner_id) };
	});
}
export function changeTagAssignment(input, add) {
	const c = config(input.collection);
	return write((db) => {
		const id = parent(db, c, input.owner_id),
			selected = tag(db, c, input.tag_id);
		const result = add
			? db
					.prepare(`INSERT OR IGNORE INTO ${c.assignments}(${c.owner},tag_id) VALUES(?,?)`)
					.run(id, selected.id)
			: db
					.prepare(`DELETE FROM ${c.assignments} WHERE ${c.owner}=? AND tag_id=?`)
					.run(id, selected.id);
		if (result.changes)
			db.prepare(`UPDATE ${c.parent} SET updated_at=? WHERE id=?`).run(
				new Date().toISOString(),
				id
			);
		return { changed: !!result.changes, tags: readAssignedTags(db, input.collection, id) };
	});
}
export function tagSummarySql(collection, alias) {
	const c = config(collection);
	return `(SELECT json_group_array(json_object('id',t.id,'name',t.name,'display_name',replace(t.name,'_',' '),'color',t.color)) FROM (SELECT d.* FROM ${c.table} d JOIN ${c.assignments} a ON a.tag_id=d.id WHERE a.${c.owner}=${alias}.id ORDER BY replace(d.name,'_',' '),d.id) t)`;
}
export function readAssignedTags(db, collection, id) {
	const c = config(collection);
	return db
		.prepare(
			`SELECT t.* FROM ${c.table} t JOIN ${c.assignments} a ON a.tag_id=t.id WHERE a.${c.owner}=? ORDER BY replace(t.name,'_',' '),t.id`
		)
		.all(id)
		.map(rowTag);
}
export function addTagFilter(db, collection, alias, ids, clauses, args) {
	const c = config(collection),
		selected = parseTagIds(ids);
	if (!selected.length) return [];
	const available = db
		.prepare(`SELECT id FROM ${c.table} WHERE id IN (${selected.map(() => '?')})`)
		.all(...selected)
		.map((r) => r.id);
	const unavailable = selected.filter((id) => !available.includes(id));
	if (unavailable.length) clauses.push('0');
	else {
		clauses.push(
			`EXISTS(SELECT 1 FROM ${c.assignments} ta WHERE ta.${c.owner}=${alias}.id AND ta.tag_id IN (${selected.map(() => '?')}))`
		);
		args.push(...selected);
	}
	return unavailable;
}
function confirmed(input) {
	if (input.confirm !== true)
		throw new ValidationError({ confirm: 'Confirm this change to all tag references.' });
}
export function deleteTag(input) {
	confirmed(input);
	const c = config(input.collection);
	return write((db) => {
		const previous = tag(db, c, input.tag_id),
			stamp = new Date().toISOString();
		db.prepare(
			`UPDATE ${c.parent} SET updated_at=? WHERE id IN(SELECT ${c.owner} FROM ${c.assignments} WHERE tag_id=?)`
		).run(stamp, previous.id);
		const removed = db
			.prepare(`DELETE FROM ${c.assignments} WHERE tag_id=?`)
			.run(previous.id).changes;
		db.prepare(`DELETE FROM ${c.table} WHERE id=?`).run(previous.id);
		return { deleted: true, tag_id: previous.id, changed_owner_count: Number(removed) };
	});
}
export function mergeTags(input) {
	confirmed(input);
	const c = config(input.collection);
	return write((db) => {
		const first = tag(db, c, input.first_tag_id),
			second = tag(db, c, input.second_tag_id);
		if (first.id === second.id)
			throw new ValidationError({ second_tag_id: 'Choose two different tags.' });
		const values = parseSchema(z.object(tagInputShape), {
			name: input.name ?? first.name,
			color: input.color ?? first.color
		});
		uniqueName(db, c, values.name, [first.id, second.id]);
		const stamp = new Date().toISOString();
		const changed = db
			.prepare(`SELECT COUNT(*) n FROM ${c.assignments} WHERE tag_id=?`)
			.get(second.id).n;
		db.prepare(
			`UPDATE ${c.parent} SET updated_at=? WHERE id IN(SELECT ${c.owner} FROM ${c.assignments} WHERE tag_id=?)`
		).run(stamp, second.id);
		db.prepare(
			`INSERT OR IGNORE INTO ${c.assignments}(${c.owner},tag_id) SELECT ${c.owner},? FROM ${c.assignments} WHERE tag_id=?`
		).run(first.id, second.id);
		db.prepare(`DELETE FROM ${c.assignments} WHERE tag_id=?`).run(second.id);
		db.prepare(`DELETE FROM ${c.table} WHERE id=?`).run(second.id);
		db.prepare(`UPDATE ${c.table} SET name=?,color=?,updated_at=? WHERE id=?`).run(
			values.name,
			values.color,
			stamp,
			first.id
		);
		return {
			tag: tag(db, c, first.id),
			removed_tag_id: second.id,
			changed_owner_count: changed,
			resulting_owner_count: db
				.prepare(`SELECT COUNT(*) n FROM ${c.assignments} WHERE tag_id=?`)
				.get(first.id).n
		};
	});
}
