import { json } from '@sveltejs/kit';
import { listDocuments } from '$lib/server/files/documents.js';
export async function GET({ url }) {
	try {
		const result = await listDocuments({
			query: url.searchParams.get('query') ?? '',
			page: Number(url.searchParams.get('page') || 1),
			editable_markdown: url.searchParams.get('markdown') === '1'
		});

		return json(result, { headers: { 'cache-control': 'no-store' } });
	} catch (e) {
		return json({ error: e.code ? e.message : 'File store unavailable.' }, { status: 400 });
	}
}
