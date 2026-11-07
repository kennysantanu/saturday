import { ServiceError } from './validation.js';

const normalizeText = (value) => (value ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
function normalizeUrl(value) {
	if (!value) return null;
	try {
		const url = new URL(value);
		url.hash = '';
		return url.href;
	} catch {
		return null;
	}
}

/** Pure matching rules shared by storage adapters; rows contain only identity/display fields. */
export function possibleDuplicateJobs(input, rows) {
	const title = normalizeText(input.job_title);
	const company = normalizeText(input.company_name);
	const location = normalizeText(input.location);
	const url = normalizeUrl(input.posting_url);
	const matches = [];
	for (const row of rows) {
		const sameUrl = url !== null && normalizeUrl(row.posting_url) === url;
		const otherLocation = normalizeText(row.location);
		const sameDetails =
			normalizeText(row.job_title) === title &&
			normalizeText(row.company_name) === company &&
			(!location || !otherLocation || location === otherLocation);
		if (sameUrl || sameDetails)
			matches.push({
				id: row.id,
				title: row.job_title,
				company: row.company_name,
				location: row.location,
				stage: row.stage,
				reason: sameUrl ? 'matching_posting_url' : 'matching_title_company'
			});
	}
	matches.sort((a, b) =>
		a.reason === b.reason ? b.id - a.id : a.reason === 'matching_posting_url' ? -1 : 1
	);
	return { matches: matches.slice(0, 10), total: matches.length };
}

export class PossibleDuplicateJobError extends ServiceError {
	constructor({ matches, total }) {
		super('Review these existing jobs before creating another.', 'possible_duplicate');
		this.matches = matches;
		this.total = total;
	}
}
