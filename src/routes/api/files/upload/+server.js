import { json } from '@sveltejs/kit';
import { uploadDocument } from '$lib/server/application.js';
export async function POST({ request, url }) {
	if (request.headers.get('origin') !== url.origin)
		return json({ error: 'Cross-origin uploads are not allowed.' }, { status: 403 });
	try {
		if (!request.body) throw new Error('Missing upload');
		const doc = await uploadDocument({
			scope: url.searchParams.get('scope') ?? 'documents',
			filename: url.searchParams.get('filename'),
			designation: url.searchParams.get('designation') ?? undefined,
			catalog_token: url.searchParams.get('catalog_token') ?? undefined,
			stream: request.body
		});
		return json(doc);
	} catch (e) {
		return json(
			{ error: e.code ? e.message : 'Upload failed. Check storage permissions and space.' },
			{ status: 400 }
		);
	}
}
