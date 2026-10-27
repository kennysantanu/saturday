import { error } from '@sveltejs/kit';
import { openRecoveryDocument } from '$lib/server/application.js';
export async function GET({ params }) {
	try {
		const result = await openRecoveryDocument({ job_id: params.jobId, id: params.documentId });
		return new Response(result.stream, {
			headers: {
				'content-type': 'application/octet-stream',
				'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.document.key.split('/').at(-1))}`,
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch {
		error(400, 'Recovery file is unavailable.');
	}
}
