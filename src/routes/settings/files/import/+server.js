import { json } from '@sveltejs/kit';
import { importBackupBundle } from '$lib/server/application.js';
import { importFileBackup } from '$lib/server/application.js';
export async function POST({ request, url }) {
	if (request.headers.get('origin') !== url.origin)
		return json({ error: 'Cross-origin uploads are not allowed.' }, { status: 403 });
	try {
		const result = await (url.searchParams.get('bundle') === 'true'
			? await importBackupBundle(request.body)
			: await importFileBackup(request.body));
		return json(result);
	} catch (e) {
		return json(
			{
				error: e.code
					? e.message
					: 'Archive import failed. Check the archive and available disk space.'
			},
			{ status: 400 }
		);
	}
}
