import { listWorkflowStages } from '$lib/server/workflow.js';
import { redirect } from '@sveltejs/kit';
import { searchJobs, ValidationError } from '$lib/server/services.js';
import { parseSchema, jobSearchSchema } from '$lib/server/validation.js';
import { searchFromUrl, filterChips, searchUrl } from '$lib/job-search.js';

export function load({ url }) {
	const stages = listWorkflowStages();
	const input = searchFromUrl(url.searchParams);
	try {
		const filters = parseSchema(jobSearchSchema, { ...input, limit: 50 });
		const result = searchJobs(filters);
		const canonical = searchUrl(filters, result.page);
		if (`${url.pathname}${url.search}` !== canonical) redirect(303, canonical);
		return {
			...result,
			stages,
			filters,
			errors: {},
			chips: filterChips(filters, stages),
			previous: result.page > 1 ? searchUrl(filters, result.page - 1) : null,
			next: result.page < result.totalPages ? searchUrl(filters, result.page + 1) : null
		};
	} catch (error) {
		if (!(error instanceof ValidationError)) throw error;
		return {
			stages,
			jobs: [],
			total: 0,
			totalJobs: 0,
			page: 1,
			totalPages: 1,
			limit: 50,
			filters: { ...jobSearchSchema.parse({}), ...input },
			errors: error.fieldErrors,
			chips: [],
			previous: null,
			next: null
		};
	}
}
