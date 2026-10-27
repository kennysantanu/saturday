import { tagPickerData } from '$lib/server/tag-forms.js';
import { listWorkflowStages, searchJobs } from '$lib/server/application.js';
import { redirect } from '@sveltejs/kit';
import { ValidationError } from '$lib/domain/validation.js';
import { parseSchema, jobSearchSchema } from '$lib/server/validation.js';
import { searchFromUrl, filterChips, searchUrl } from '$lib/job-search.js';
export async function load({ url }) {
	const stages = await listWorkflowStages();
	const input = searchFromUrl(url.searchParams);
	try {
		const filters = parseSchema(jobSearchSchema, { ...input, limit: 50 });
		const result = await searchJobs(filters);
		const tagOptions = await tagPickerData('job', filters.tag_ids);
		let canonical = searchUrl(filters, result.page);
		const saved = url.searchParams.get('saved');
		if (saved === 'job-deleted' || saved === 'job-missing') {
			const target = new URL(canonical, url);
			target.searchParams.set('saved', saved);
			canonical = target.pathname + target.search;
		}
		if (`${url.pathname}${url.search}` !== canonical) redirect(303, canonical);
		return {
			...result,
			tagOptions,
			stages,
			filters,
			errors: {},
			chips: filterChips(filters, stages, tagOptions.selectedTags),
			previous: result.page > 1 ? searchUrl(filters, result.page - 1) : null,
			next: result.page < result.totalPages ? searchUrl(filters, result.page + 1) : null
		};
	} catch (error) {
		if (!(error instanceof ValidationError)) throw error;
		return {
			stages,
			tagOptions: await tagPickerData('job'),
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
