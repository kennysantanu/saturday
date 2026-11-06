import { fail, redirect } from '@sveltejs/kit';
import { recoveryDocuments, recoverCopy } from '$lib/server/application.js';
import { searchJobs } from '$lib/server/application.js';
export async function load({ params, url }) {
	return {
		documents: await recoveryDocuments(params.jobId),
		jobId: params.jobId,
		query: url.searchParams.get('query') ?? '',
		jobs: (
			await searchJobs({ view: 'all', query: url.searchParams.get('query') ?? '', limit: 100 })
		).jobs
	};
}
export const actions = {
	copy: async ({ params, request }) => {
		try {
			const v = Object.fromEntries(await request.formData());
			await recoverCopy({
				id: v.id,
				token: v.token,
				job_id: params.jobId,
				destination_scope: v.destination_scope,
				filename: v.filename
			});
		} catch (e) {
			return fail(400, { fileError: e.code ? e.message : 'Recovery copy failed.' });
		}
		redirect(303, `/settings/files/recovery/${params.jobId}?saved=document-copy`);
	}
};
