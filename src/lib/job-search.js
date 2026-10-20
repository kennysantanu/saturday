import { jobFields } from './job-fields.js';
export const workOptions =
	jobFields.find((field) => field.name === 'work_arrangement').options ?? [];
export const employmentOptions =
	jobFields.find((field) => field.name === 'employment_type').options ?? [];
export const sortOptions = [
	{ value: 'updated', label: 'Recently updated' },
	{ value: 'created', label: 'Recently created' },
	{ value: 'score', label: 'Highest score' },
	{ value: 'follow_up', label: 'Earliest follow-up' },
	{ value: 'deadline', label: 'Earliest deadline' }
];
export const dateModes = ['any', 'unset', 'set', 'overdue', 'today', 'upcoming', 'range'];
export const defaultJobFilters = {
	query: '',
	title: '',
	company: '',
	location: '',
	source: '',
	view: 'active',
	current_stage: [],
	milestone_stage: [],
	starred: 'all',
	work_arrangement: [],
	employment_type: [],
	created_via: [],
	follow_up: 'any',
	follow_up_from: '',
	follow_up_to: '',
	deadline: 'any',
	deadline_from: '',
	deadline_to: '',
	score: 'any',
	score_min: undefined,
	score_max: undefined,
	created_from: '',
	created_to: '',
	updated_from: '',
	updated_to: '',
	sort: 'updated',
	page: 1,
	limit: 50
};

export function searchFromUrl(params) {
	return Object.fromEntries(
		Object.keys(defaultJobFilters)
			.filter((key) => params.has(key))
			.map((key) => [
				key,
				[
					'current_stage',
					'milestone_stage',
					'work_arrangement',
					'employment_type',
					'created_via'
				].includes(key)
					? params.getAll(key)
					: params.get(key)
			])
	);
}

export function searchUrl(values, page = 1) {
	const defaults = defaultJobFilters;
	const params = new URLSearchParams();
	for (const key of Object.keys(defaultJobFilters)) {
		if (key === 'page' || key === 'limit') continue;
		const value = values[key];
		if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
		else if (value !== undefined && value !== '' && value !== defaults[key])
			params.set(key, String(value));
	}
	if (page > 1) params.set('page', String(page));
	return `/jobs${params.size ? `?${params}` : ''}`;
}

export function filterChips(values, stages = []) {
	const defaults = defaultJobFilters;
	const labels = {
		query: 'Search jobs',
		title: 'Title contains',
		company: 'Company contains',
		location: 'Location contains',
		source: 'Source contains',
		view: 'Activity',
		current_stage: 'Current stage',
		milestone_stage: 'Milestone history',
		starred: 'Starred',
		work_arrangement: 'Work arrangement',
		employment_type: 'Employment type',
		created_via: 'Created via',
		follow_up: 'Follow-up',
		deadline: 'Deadline',
		score: 'Score',
		score_min: 'Minimum score',
		score_max: 'Maximum score',
		created_from: 'Created from',
		created_to: 'Created to',
		updated_from: 'Updated from',
		updated_to: 'Updated to',
		follow_up_from: 'Follow-up from',
		follow_up_to: 'Follow-up to',
		deadline_from: 'Deadline from',
		deadline_to: 'Deadline to'
	};
	return Object.entries(labels).flatMap(([key, label]) => {
		const value = values[key];
		if (
			value === undefined ||
			value === '' ||
			value === defaults[key] ||
			(key === 'view' && (values.current_stage.length || values.milestone_stage.length))
		)
			return [];
		const selections = Array.isArray(value) ? value : [value];
		return selections.map((selection) => {
			const next = {
				...values,
				[key]: Array.isArray(value) ? value.filter((item) => item !== selection) : defaults[key]
			};
			if (
				['current_stage', 'milestone_stage'].includes(key) &&
				!next.current_stage.length &&
				!next.milestone_stage.length
			)
				next.view = 'active';
			if (key === 'follow_up' || key === 'deadline') {
				next[`${key}_from`] = '';
				next[`${key}_to`] = '';
			}
			let name = selection;
			if (key === 'current_stage' || key === 'milestone_stage')
				name = stages.find((stage) => String(stage.id) === String(selection))?.name ?? selection;
			else if (selection === 'unset')
				name = key === 'follow_up' ? 'Not scheduled' : 'Not specified';
			else if (selection === 'not_starred') name = 'Not starred';
			else if (key === 'follow_up' && selection === 'set') name = 'Scheduled';
			else if (selection === 'set') name = 'Specified';
			return { key: `${key}:${selection}`, label: `${label}: ${name}`, href: searchUrl(next) };
		});
	});
}
