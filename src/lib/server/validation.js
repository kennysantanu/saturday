import { z } from 'zod';
import { workOptions, employmentOptions, sortOptions, dateModes } from '../job-search.js';
import { editableJobFields, assessmentJobFields } from '../job-fields.js';

export class ValidationError extends Error {
	constructor(fieldErrors, message = 'Some details need attention.') {
		super(message);
		this.name = 'ValidationError';
		this.fieldErrors = fieldErrors;
	}
}

export class ServiceError extends Error {
	constructor(message, code = 'invalid_request') {
		super(message);
		this.name = 'ServiceError';
		this.code = code;
	}
}

// Strict numeric schema for MCP; canonical form/route strings are parsed only at service boundaries.
export const recordIdSchema = z
	.number()
	.int()
	.min(1, 'Choose a saved record.')
	.max(Number.MAX_SAFE_INTEGER, 'Record ID is too large.');
export const recordIdInputSchema = z.preprocess(
	(value) => (typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value),
	recordIdSchema
);
export function parseRecordId(value, field = 'id') {
	return parseSchema(z.object({ [field]: recordIdInputSchema }), { [field]: value })[field];
}

const optionalText = (max, label) =>
	z
		.preprocess(
			(value) =>
				typeof value === 'string' && value.trim() === ''
					? undefined
					: value === null
						? undefined
						: value,
			z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).optional()
		)
		.transform((value) => value ?? null);

const validDate = (value) => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function jobFieldSchema(field, wire = false) {
	if (field.type === 'boolean') {
		if (wire) return z.boolean();
		return z
			.preprocess(
				(value) => (value === '1' || value === 'on' ? true : value === '0' ? false : value),
				z.boolean().optional()
			)
			.transform((value) => value ?? field.default);
	}
	if (field.type === 'number') return z.number().finite().nullable();
	if (field.type === 'enum') {
		if (wire) return z.enum([...field.options, '']).nullable();
		return z
			.preprocess(
				(value) => (value === '' || value === null ? undefined : value),
				z.enum(field.options).optional()
			)
			.transform((value) => value ?? null);
	}
	if (field.required)
		return z
			.string()
			.trim()
			.min(1, field.requiredMessage)
			.max(field.max, `${field.label} must be ${field.max} characters or fewer.`);
	const text = wire
		? z.string().trim().max(field.max).nullable()
		: optionalText(field.max, field.label);
	if (field.type === 'date')
		return text.refine(
			(value) => value === null || (wire && value === '') || validDate(value),
			'Enter a real date in YYYY-MM-DD format.'
		);
	if (field.type === 'url')
		return text.refine((value) => {
			if (value === null || (wire && value === '')) return true;
			try {
				const url = new URL(value);
				return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
			} catch {
				return false;
			}
		}, 'Enter a valid link that starts with http:// or https://.');
	return text;
}
export const jobInputShape = Object.fromEntries(
	editableJobFields.map((field) => [field.name, jobFieldSchema(field)])
);
export const assessmentSchema = z.object(
	Object.fromEntries(assessmentJobFields.map((field) => [field.name, jobFieldSchema(field)]))
);
export function parseAssessment(input) {
	return parseSchema(assessmentSchema, input);
}
const jobInputSchema = z.object(jobInputShape).superRefine((value, ctx) => {
	for (const field of editableJobFields) {
		if (field.requires && value[field.name] && !value[field.requires])
			ctx.addIssue({ code: 'custom', path: [field.name], message: field.requiresMessage });
	}
});
// Wire schemas keep omitted keys omitted; services apply blank/null normalization and defaults.
export function jobMcpInputShape({ partial = false, assessment = false } = {}) {
	return Object.fromEntries(
		[...editableJobFields, ...(assessment ? assessmentJobFields : [])].map((field) => {
			const schema = jobFieldSchema(field, true);
			return [field.name, partial || !field.required ? schema.optional() : schema];
		})
	);
}
export const followUpMcpSchema = z.object({
	follow_up_date: jobFieldSchema(
		editableJobFields.find((field) => field.name === 'follow_up_date'),
		true
	),
	follow_up_comment: jobMcpInputShape().follow_up_comment
});

const updateSchema = z
	.object({
		job_id: recordIdInputSchema,
		stage_id: z.preprocess(
			(value) => (value === '' || value == null ? null : value),
			recordIdInputSchema.nullable()
		),
		event_date: z.string().trim().refine(validDate, 'Enter a real date in YYYY-MM-DD format.'),
		note: optionalText(10000, 'Note')
	})
	.superRefine((value, ctx) => {
		if (!value.stage_id && !value.note) {
			ctx.addIssue({ code: 'custom', path: ['note'], message: 'Enter a note.' });
		}
	});

export function parseSchema(schema, input) {
	const result = schema.safeParse(input);
	if (result.success) return result.data;
	const fieldErrors = {};
	for (const issue of result.error.issues) {
		const field = String(issue.path[0] ?? 'form');
		fieldErrors[field] ??= issue.message;
	}
	throw new ValidationError(fieldErrors);
}

export function parseJobInput(input) {
	return parseSchema(jobInputSchema, input);
}

export function parseUpdateInput(input) {
	return parseSchema(updateSchema, input);
}

export function parseEventDate(input) {
	const result = z
		.string()
		.trim()
		.refine(validDate, 'Enter a real date in YYYY-MM-DD format.')
		.safeParse(input);
	if (result.success) return result.data;
	throw new ValidationError({
		event_date: result.error.issues[0]?.message ?? 'Enter a valid date.'
	});
}

export { validDate };

const multiple = (options) =>
	z
		.array(z.enum(options))
		.default([])
		.transform((values) => [...new Set(values)]);
const text = z.string().trim().max(200, 'Enter 200 characters or fewer.').default('');
const date = z
	.string()
	.trim()
	.default('')
	.refine((value) => !value || validDate(value), 'Enter a real date in YYYY-MM-DD format.');
const number = z.preprocess(
	(value) =>
		value === '' || value == null ? undefined : typeof value === 'string' ? Number(value) : value,
	z.number().finite().optional()
);
const integer = (fallback, max) =>
	z.preprocess(
		(value) =>
			value === '' || value == null ? fallback : typeof value === 'string' ? Number(value) : value,
		z.number().int().min(1).max(max)
	);

// The same names are used by URL controls, shared queries, and MCP.
export const jobSearchShape = {
	query: text,
	title: text,
	company: text,
	location: text,
	source: text,
	view: z.enum(['active', 'closed', 'all']).default('active'),
	current_stage: z
		.array(recordIdInputSchema)
		.default([])
		.transform((values) => [...new Set(values)]),
	milestone_stage: z
		.array(recordIdInputSchema)
		.default([])
		.transform((values) => [...new Set(values)]),
	starred: z.enum(['all', 'starred', 'not_starred']).default('all'),
	work_arrangement: multiple([...workOptions, 'unset']),
	employment_type: multiple([...employmentOptions, 'unset']),
	created_via: multiple(['manual', 'mcp']),
	follow_up: z.enum(dateModes).default('any'),
	follow_up_from: date,
	follow_up_to: date,
	deadline: z.enum(dateModes).default('any'),
	deadline_from: date,
	deadline_to: date,
	score: z.enum(['any', 'scored', 'unscored']).default('any'),
	score_min: number,
	score_max: number,
	created_from: date,
	created_to: date,
	updated_from: date,
	updated_to: date,
	sort: z.enum(sortOptions.map((option) => option.value)).default('updated'),
	page: integer(1, Number.MAX_SAFE_INTEGER),
	limit: integer(50, 100)
};
export const jobSearchSchema = z
	.object(jobSearchShape)
	.superRefine((values, ctx) => {
		for (const prefix of ['follow_up', 'deadline', 'created', 'updated']) {
			if (['follow_up', 'deadline'].includes(prefix) && values[prefix] !== 'range') continue;
			if (
				values[`${prefix}_from`] &&
				values[`${prefix}_to`] &&
				values[`${prefix}_from`] > values[`${prefix}_to`]
			)
				ctx.addIssue({
					code: 'custom',
					path: [`${prefix}_to`],
					message: 'End date must be on or after the start date.'
				});
		}
		if (
			values.score !== 'unscored' &&
			values.score_min !== undefined &&
			values.score_max !== undefined &&
			values.score_min > values.score_max
		)
			ctx.addIssue({
				code: 'custom',
				path: ['score_max'],
				message: 'Maximum score must be at least the minimum.'
			});
	})
	.transform((values) => ({
		...values,
		view: values.current_stage.length || values.milestone_stage.length ? 'all' : values.view,
		follow_up_from: values.follow_up === 'range' ? values.follow_up_from : '',
		follow_up_to: values.follow_up === 'range' ? values.follow_up_to : '',
		deadline_from: values.deadline === 'range' ? values.deadline_from : '',
		deadline_to: values.deadline === 'range' ? values.deadline_to : '',
		score_min: values.score === 'unscored' ? undefined : values.score_min,
		score_max: values.score === 'unscored' ? undefined : values.score_max
	}));

// Network uses explicit fields; the same validation serves forms, services and MCP.
export const networkInputShape = {
	name: z.string().trim().min(1, 'Enter a name.').max(200),
	role: optionalText(200, 'Role'),
	organization: optionalText(200, 'Organization'),
	phone: optionalText(100, 'Phone'),
	email: optionalText(320, 'Email').refine(
		(value) => value === null || z.email().safeParse(value).success,
		'Enter a valid email address.'
	),
	link: optionalText(2000, 'Profile or website').refine((value) => {
		if (value === null) return true;
		try {
			const url = new URL(value);
			return ['http:', 'https:'].includes(url.protocol) && !!url.hostname;
		} catch {
			return false;
		}
	}, 'Enter an HTTP or HTTPS link.'),
	notes: optionalText(20000, 'Notes'),
	follow_up_date: optionalText(10, 'Follow-up date').refine(
		(value) => value === null || validDate(value),
		'Enter a real date in YYYY-MM-DD format.'
	),
	follow_up_comment: optionalText(2000, 'Follow-up comment')
};
export const networkInputSchema = z.object(networkInputShape).superRefine((value, ctx) => {
	if (value.follow_up_comment && !value.follow_up_date)
		ctx.addIssue({
			code: 'custom',
			path: ['follow_up_comment'],
			message: 'Schedule a follow-up date first.'
		});
});
export const networkIdSchema = recordIdInputSchema;
export const networkPaginationShape = {
	page: integer(1, Number.MAX_SAFE_INTEGER),
	limit: integer(50, 100)
};
export const networkSearchShape = {
	query: text,
	name: text,
	role: text,
	organization: text,
	job_id: recordIdInputSchema.optional(),
	follow_up: z.enum(['all', 'overdue', 'today', 'upcoming', 'not_scheduled']).default('all'),
	sort: z.enum(['name', 'follow_up', 'latest_interaction']).default('name'),
	...networkPaginationShape
};
export const networkLinkShape = {
	job_id: recordIdInputSchema,
	network_id: networkIdSchema,
	notes: optionalText(2000, 'Relationship note')
};
export function localCalendarDate() {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export const networkUpdateShape = {
	network_id: networkIdSchema,
	interaction_date: z
		.string()
		.trim()
		.refine(validDate, 'Enter a real date in YYYY-MM-DD format.')
		.refine(
			(value) => value <= localCalendarDate(),
			'Record completed interactions only; use Follow-up for future contact.'
		),
	note: z.string().trim().min(1, 'Enter an interaction note.').max(20000)
};
export const networkUpdateSearchSchema = z
	.object({
		network_id: networkIdSchema,
		date_from: date,
		date_to: date,
		...networkPaginationShape
	})
	.superRefine((value, ctx) => {
		if (value.date_from && value.date_to && value.date_from > value.date_to)
			ctx.addIssue({
				code: 'custom',
				path: ['date_to'],
				message: 'End date must be on or after the start date.'
			});
	});
