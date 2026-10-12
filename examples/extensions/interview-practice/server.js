import { z } from 'zod';
export const migrations = [
	{
		name: 'questions',
		up(db) {
			db.exec(
				`CREATE TABLE questions (id INTEGER PRIMARY KEY AUTOINCREMENT CHECK(id BETWEEN 1 AND 9007199254740991), question TEXT NOT NULL CHECK(length(trim(question)) BETWEEN 1 AND 10000), answer TEXT NOT NULL DEFAULT '' CHECK(length(answer)<=50000), revision INTEGER NOT NULL DEFAULT 1 CHECK(typeof(revision)='integer' AND revision>0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`
			);
		}
	}
];
const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(10000);
const answer = z.string().max(50000);
const pagination = z.object({
	query: z.string().max(200).optional(),
	page: z.coerce.number().int().positive().optional()
});
function list(input, ctx) {
	const v = pagination.parse(input);
	return ctx.database((db) => {
		const query = (v.query ?? '').replace(/[\\%_]/g, '\\$&');
		const total = db
			.prepare("SELECT count(*) AS total FROM questions WHERE question LIKE ? ESCAPE '\\'")
			.get(`%${query}%`).total;
		const totalPages = Math.max(1, Math.ceil(total / 50)),
			page = Math.min(v.page ?? 1, totalPages);
		return {
			questions: db
				.prepare(
					"SELECT * FROM questions WHERE question LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 50 OFFSET ?"
				)
				.all(`%${query}%`, (page - 1) * 50),
			total,
			page,
			totalPages,
			query: v.query ?? ''
		};
	});
}
function get(input, ctx) {
	const parsed = id.parse(input.id);
	return ctx.database((db) => {
		const q = db.prepare('SELECT * FROM questions WHERE id=?').get(parsed);
		if (!q) ctx.reject('NOT_FOUND', 'Question not found.');
		return { ...q, data_token: ctx.dataToken() };
	});
}
function create(input, ctx) {
	const v = z.object({ question: text, answer: answer.optional() }).parse(input);
	return ctx.database((db) => {
		const now = new Date().toISOString();
		const r = db
			.prepare('INSERT INTO questions (question,answer,created_at,updated_at) VALUES (?,?,?,?)')
			.run(v.question, v.answer ?? '', now, now);
		return {
			...db.prepare('SELECT * FROM questions WHERE id=?').get(r.lastInsertRowid),
			data_token: ctx.dataToken()
		};
	});
}
const editSchema = z
	.object({
		id,
		revision: id,
		data_token: z.uuid(),
		question: text.optional(),
		answer: answer.optional()
	})
	.refine(
		(v) => v.question !== undefined || v.answer !== undefined,
		'Provide a question or answer.'
	);
function edit(input, ctx) {
	const v = editSchema.parse(input);
	if (v.data_token !== ctx.dataToken())
		ctx.reject('CONFLICT', 'Extension data was restored. Reload before saving.');
	return ctx.database((db) => {
		const r = db
			.prepare(
				'UPDATE questions SET question=coalesce(?,question),answer=coalesce(?,answer),revision=revision+1,updated_at=? WHERE id=? AND revision=?'
			)
			.run(v.question ?? null, v.answer ?? null, new Date().toISOString(), v.id, v.revision);
		if (!r.changes)
			ctx.reject('CONFLICT', 'Question changed or was removed. Reload before saving.');
		return {
			...db.prepare('SELECT * FROM questions WHERE id=?').get(v.id),
			data_token: ctx.dataToken()
		};
	});
}
function remove(input, ctx) {
	const v = z
		.object({ id, revision: id, data_token: z.uuid(), confirm: z.literal(true) })
		.parse(input);
	if (v.data_token !== ctx.dataToken())
		ctx.reject('CONFLICT', 'Extension data was restored. Reload before deleting.');
	return ctx.database((db) => {
		const r = db.prepare('DELETE FROM questions WHERE id=? AND revision=?').run(v.id, v.revision);
		if (!r.changes)
			ctx.reject('CONFLICT', 'Question changed or was removed. Reload before deleting.');
		return { deleted: true, id: v.id };
	});
}
export function load({ url }, ctx) {
	const result = list(Object.fromEntries(url.searchParams), ctx);
	return {
		...result,
		new: url.searchParams.get('new') === '1',
		selected: url.searchParams.get('question')
			? get({ id: url.searchParams.get('question') }, ctx)
			: null
	};
}
export const actions = { create, edit, delete: remove };
const annotations = (readOnlyHint, destructiveHint = false) => ({
	readOnlyHint,
	destructiveHint,
	idempotentHint: readOnlyHint,
	openWorldHint: false
});
export const tools = {
	list_questions: {
		description: 'Search interview questions with literal text matching and pagination.',
		inputSchema: pagination,
		annotations: annotations(true),
		handler: list
	},
	get_question: {
		description: 'Read one interview question, saved answer, and current revision.',
		inputSchema: z.object({ id }),
		annotations: annotations(true),
		handler: get
	},
	create_question: {
		description:
			'Add an interview question and optional answer on user request. Inspect after uncertain responses before retrying.',
		inputSchema: z.object({ question: text, answer: answer.optional() }),
		annotations: annotations(false),
		handler: create
	},
	edit_question: {
		description:
			'Partially edit question or saved answer with a fresh revision and data_token from get_question. Preserve omitted fields. Save proposed answers only on user request.',
		inputSchema: editSchema,
		annotations: annotations(false, true),
		handler: edit
	},
	delete_question: {
		description:
			'Permanently delete a question only after explicit user confirmation. Requires a fresh revision and data_token from get_question.',
		inputSchema: z.object({ id, revision: id, data_token: z.uuid(), confirm: z.literal(true) }),
		annotations: annotations(false, true),
		handler: remove
	}
};
