import { z } from 'zod';

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

const optionalText = (max, label) =>
	z
		.preprocess(
			(value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
			z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).optional()
		)
		.transform((value) => value ?? null);

const validDate = (value) => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const postingUrlSchema = optionalText(2048, 'Job posting link').refine((value) => {
	if (value === null) return true;
	try {
		const url = new URL(value);
		return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
	} catch {
		return false;
	}
}, 'Enter a valid link that starts with http:// or https://.');

const jobInputSchema = z.object({
	job_title: z
		.string()
		.trim()
		.min(1, 'Enter a job title.')
		.max(200, 'Job title must be 200 characters or fewer.'),
	company_name: z
		.string()
		.trim()
		.min(1, 'Enter a company.')
		.max(200, 'Company must be 200 characters or fewer.'),
	posting_url: postingUrlSchema,
	job_description: optionalText(50000, 'Job description'),
	notes: optionalText(10000, 'Job notes')
});

const ordinaryEventTypes = [
	'applied',
	'prescreened',
	'interview_1',
	'interview_2',
	'offer',
	'accepted',
	'rejected'
];

const updateSchema = z
	.object({
		job_id: z.string().trim().min(1, 'Choose a job.'),
		event_type: z
			.enum(ordinaryEventTypes)
			.nullable()
			.optional()
			.transform((value) => value ?? null),
		event_date: z.string().trim().refine(validDate, 'Enter a real date in YYYY-MM-DD format.'),
		note: optionalText(10000, 'Note')
	})
	.superRefine((value, ctx) => {
		if (!value.event_type && !value.note) {
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

export { ordinaryEventTypes, validDate };
