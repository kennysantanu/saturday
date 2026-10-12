import { json } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { importExtensionBackup, extensionError } from '$lib/server/extensions.js';
export async function POST({ request, url }) {
	if (request.headers.get('origin') !== url.origin)
		return json({ error: 'Cross-origin imports are not allowed.' }, { status: 403 });
	try {
		if (!request.body) throw new Error('Missing upload');
		return json(await importExtensionBackup(Readable.fromWeb(request.body)));
	} catch (e) {
		return json({ error: extensionError(e).message }, { status: 400 });
	}
}
