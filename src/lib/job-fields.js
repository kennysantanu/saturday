// All stored job fields. Forms stay inline; immutable migrations remain the schema source.
// All current fields belong to the numeric baseline (schema 1). `edit` controls input access.
export const jobFields = [
	{ name: 'id', key: 'id', type: 'id', label: 'Job ID', edit: 'system', since: 1, list: true },
	{
		name: 'job_title',
		key: 'title',
		mcpKey: 'title',
		type: 'text',
		label: 'Job title',
		required: true,
		requiredMessage: 'Enter a job title.',
		max: 200,
		edit: 'user',
		since: 1,
		list: true
	},
	{
		name: 'company_name',
		key: 'company',
		mcpKey: 'company',
		type: 'text',
		label: 'Company',
		required: true,
		requiredMessage: 'Enter a company.',
		max: 200,
		edit: 'user',
		since: 1,
		list: true
	},
	{
		name: 'posting_url',
		key: 'postingUrl',
		type: 'url',
		label: 'Job posting link',
		max: 2048,
		edit: 'user',
		since: 1
	},
	{
		name: 'job_description',
		key: 'description',
		type: 'text',
		label: 'Job description',
		max: 50000,
		edit: 'user',
		since: 1
	},
	{
		name: 'notes',
		key: 'notes',
		type: 'text',
		label: 'Job notes',
		max: 10000,
		edit: 'user',
		since: 1
	},
	{
		name: 'is_active',
		key: 'isActive',
		type: 'boolean',
		label: 'Active',
		default: true,
		edit: 'system',
		since: 1,
		list: true
	},
	{
		name: 'created_via',
		key: 'createdVia',
		type: 'enum',
		label: 'Record origin',
		options: ['manual', 'mcp'],
		edit: 'system',
		since: 1
	},
	{
		name: 'created_at',
		key: 'createdAt',
		type: 'timestamp',
		label: 'Created at',
		edit: 'system',
		since: 1
	},
	{
		name: 'updated_at',
		key: 'updatedAt',
		type: 'timestamp',
		label: 'Updated at',
		edit: 'system',
		since: 1
	},
	{
		name: 'location',
		key: 'location',
		type: 'text',
		label: 'Location',
		max: 200,
		edit: 'user',
		since: 1,
		info: true,
		list: true
	},
	{
		name: 'work_arrangement',
		key: 'workArrangement',
		type: 'enum',
		label: 'Work arrangement',
		options: ['remote', 'hybrid', 'on-site'],
		edit: 'user',
		since: 1,
		info: true,
		list: true
	},
	{
		name: 'employment_type',
		key: 'employmentType',
		type: 'enum',
		label: 'Employment type',
		options: ['full-time', 'part-time', 'contract', 'internship', 'temporary'],
		edit: 'user',
		since: 1,
		info: true,
		list: true
	},
	{
		name: 'compensation',
		key: 'compensation',
		type: 'text',
		label: 'Compensation',
		max: 1000,
		edit: 'user',
		since: 1,
		info: true,
		list: true
	},
	{
		name: 'source',
		key: 'source',
		type: 'text',
		label: 'Source',
		max: 200,
		edit: 'user',
		since: 1,
		info: true,
		list: true
	},
	{
		name: 'application_deadline',
		key: 'applicationDeadline',
		type: 'date',
		label: 'Application deadline',
		max: 10,
		edit: 'user',
		since: 1,
		info: true,
		list: true
	},
	{
		name: 'follow_up_date',
		key: 'followUpDate',
		type: 'date',
		label: 'Follow-up date',
		max: 10,
		edit: 'user',
		since: 1,
		list: true
	},
	{
		name: 'follow_up_comment',
		key: 'followUpComment',
		type: 'text',
		label: 'Follow-up comment',
		max: 10000,
		requires: 'follow_up_date',
		requiresMessage: 'Set a follow-up date to add a comment.',
		edit: 'user',
		since: 1,
		list: true
	},
	{
		name: 'is_starred',
		key: 'isStarred',
		type: 'boolean',
		label: 'Starred',
		default: false,
		edit: 'user',
		since: 1,
		list: true
	},
	{
		name: 'score',
		key: 'score',
		type: 'number',
		label: 'Assistant score',
		edit: 'assistant',
		since: 1,
		list: true
	},
	{
		name: 'score_comment',
		key: 'scoreComment',
		type: 'text',
		label: 'Score comment',
		max: 10000,
		edit: 'assistant',
		since: 1,
		list: true
	}
];
export const editableJobFields = jobFields.filter((field) => field.edit === 'user');
export const assessmentJobFields = jobFields.filter((field) => field.edit === 'assistant');
export const jobInfoFields = jobFields.filter((field) => field.info);
export function jobColumns(version = Infinity) {
	return jobFields.filter((field) => field.since <= version).map((field) => field.name);
}
export function jobFromStorage(row) {
	return Object.fromEntries(
		jobFields.map((field) => [
			field.key,
			field.type === 'boolean'
				? Boolean(row[field.name] ?? field.default)
				: (row[field.name] ?? null)
		])
	);
}
export function jobToStorage(values, fields = jobFields) {
	return fields.map((field) =>
		field.type === 'boolean' ? Number(values[field.name]) : values[field.name]
	);
}
export function jobForMcp(job, { list = false } = {}) {
	return Object.fromEntries(
		jobFields
			.filter((field) => !list || field.list)
			.map((field) => [field.mcpKey ?? field.name, job[field.key]])
	);
}
