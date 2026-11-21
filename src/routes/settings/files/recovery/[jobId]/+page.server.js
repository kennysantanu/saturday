import { fail } from '@sveltejs/kit';
import { recoveryDocuments, recoverCopy } from '$lib/server/application.js';
import { searchJobs } from '$lib/server/application.js';
import { settled } from '$lib/server/settled.js';
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
	copy: async (event) => {
		const { params, request } = event;
		let v;
		try {
			v = Object.fromEntries(await request.formData());
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
		return settled(
			event,
			{ saved: 'document-copy' },
			`/settings/files/recovery/${params.jobId}?saved=document-copy#recovery-${v.id}`
		);
	}
};
