import { jobFields } from './job-fields.js';
import { reminderLabel } from './filter-labels.js';
export const workOptions =
	jobFields.find((field) => field.name === 'work_arrangement').options ?? [];
export const employmentOptions =
	jobFields.find((field) => field.name === 'employment_type').options ?? [];
export const sortOptions = [
	{ value: 'updated', label: 'Recently updated' },
	{ value: 'created', label: 'Recently created' },
	{ value: 'score', label: 'Highest score' },
	{ value: 'follow_up', label: 'Earliest reminder' },
	{ value: 'deadline', label: 'Earliest deadline' }
];
export const dateModes = ['any', 'unset', 'set', 'overdue', 'today', 'upcoming', 'range'];
export const defaultJobFilters = {
	tag_ids: [],
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

const stageStatus = /^stage-(\d+)$/;

/**
 * The single Status control's value for a set of filters: active, closed, all, `stage-<id>` for
 * one current stage, or `custom` for several stages arriving through an older URL.
 */
export function statusValue(filters) {
	const stages = filters.current_stage ?? [];
	if (stages.length > 1) return 'custom';
	if (stages.length === 1) return `stage-${stages[0]}`;
	return filters.view ?? 'active';
}

/** Translate a Status value into the `view` and `current_stage` filters the search uses. */
export function applyStatus(values) {
	const { status, ...rest } = values;
	if (status === undefined || status === 'custom') return rest;
	const stage = stageStatus.exec(status);
	return stage
		? { ...rest, view: 'all', current_stage: [stage[1]] }
		: { ...rest, view: status, current_stage: [] };
}

export function searchFromUrl(params) {
	const input = searchFromParams(params);
	// The Status select submits one `status` parameter; older URLs keep using view and
	// current_stage. The canonical URL still uses view and current_stage.
	if (params.has('status')) {
		const translated = applyStatus({ ...input, status: params.get('status') });
		if (params.get('status') !== 'custom') {
			input.view = translated.view;
			input.current_stage = translated.current_stage;
		}
	}
	return input;
}

function searchFromParams(params) {
	return Object.fromEntries(
		Object.keys(defaultJobFilters)
			.filter((key) => params.has(key))
			.map((key) => [
				key,
				[
					'tag_ids',
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
		else if (value !== undefined && value !== null && value !== '' && value !== defaults[key])
			params.set(key, String(value));
	}
	if (page > 1) params.set('page', String(page));
	return `/jobs${params.size ? `?${params}` : ''}`;
}

// Links into the Jobs list from elsewhere (Dashboard, Settings, job detail). Build them here so
// they follow the canonical URL format instead of repeating query strings.
export const allJobsUrl = () => searchUrl({ ...defaultJobFilters, view: 'all' });
export const stageJobsUrl = (stageId) =>
	searchUrl({ ...defaultJobFilters, view: 'all', current_stage: [String(stageId)] });
export const milestoneJobsUrl = (stageId) =>
	searchUrl({ ...defaultJobFilters, view: 'all', milestone_stage: [String(stageId)] });

export function filterChips(values, stages = [], tags = []) {
	const defaults = defaultJobFilters;
	const labels = {
		tag_ids: 'Tag',
		query: 'Search jobs',
		title: 'Title contains',
		company: 'Company contains',
		location: 'Location contains',
		source: 'Source contains',
		view: 'Status',
		current_stage: 'Status',
		milestone_stage: 'Milestone history',
		starred: 'Starred',
		work_arrangement: 'Work arrangement',
		employment_type: 'Employment type',
		created_via: 'Created via',
		follow_up: 'Reminder',
		deadline: 'Deadline',
		score: 'Score',
		score_min: 'Minimum score',
		score_max: 'Maximum score',
		created_from: 'Created from',
		created_to: 'Created to',
		updated_from: 'Updated from',
		updated_to: 'Updated to',
		follow_up_from: 'Reminder from',
		follow_up_to: 'Reminder to',
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
			if (key === 'tag_ids')
				name =
					tags.find((tag) => String(tag.id) === String(selection))?.display_name ??
					`Unavailable tag #${selection}`;
			else if (key === 'current_stage' || key === 'milestone_stage')
				name = stages.find((stage) => String(stage.id) === String(selection))?.name ?? selection;
			else if (key === 'view')
				name = { active: 'Active', closed: 'Closed', all: 'All' }[selection] ?? selection;
			else if (selection === 'unset')
				name = key === 'follow_up' ? reminderLabel(selection) : 'Not specified';
			else if (selection === 'not_starred') name = 'Not starred';
			else if (key === 'follow_up' && selection === 'set') name = 'Scheduled';
			else if (selection === 'set') name = 'Specified';
			return {
				key: `${key}:${selection}`,
				label: `${label}: ${name}`,
				href: searchUrl(next),
				...(key === 'tag_ids'
					? { color: tags.find((tag) => String(tag.id) === String(selection))?.color }
					: {})
			};
		});
	});
}
