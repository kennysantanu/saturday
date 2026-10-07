import { error } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import {
	withFileLock,
	scopePrefix,
	verifiedPath,
	LocalFileStore
} from '$lib/server/files/store.js';
export async function GET({ params }) {
	try {
		const result = await withFileLock(async (m) => {
			const d = m.documents.find(
				(d) =>
					d.id === params.documentId && d.key.startsWith(`${scopePrefix(params.jobId, false)}/`)
			);
			if (!d) error(404, 'File not found.');
			await verifiedPath(d);
			return { doc: d, ...(await new LocalFileStore().open(d.key)) };
		});
		return new Response(Readable.toWeb(result.stream), {
			headers: {
				'content-type': 'application/octet-stream',
				'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.doc.key.split('/').at(-1))}`,
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch {
		error(400, 'Recovery file is unavailable.');
	}
}
