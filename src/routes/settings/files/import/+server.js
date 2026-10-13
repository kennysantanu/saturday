import { json } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { importBackupBundle } from '$lib/server/files/pairs.js';
import { importFileBackup } from '$lib/server/files/backups.js';
export async function POST({ request, url }) {
	if (request.headers.get('origin') !== url.origin)
		return json({ error: 'Cross-origin uploads are not allowed.' }, { status: 403 });
	try {
		const result = await (url.searchParams.get('bundle') === 'true'
			? importBackupBundle(Readable.fromWeb(request.body))
			: importFileBackup(Readable.fromWeb(request.body)));
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
