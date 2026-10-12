import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { getExtensionBackup } from '$lib/server/extensions.js';
export async function GET({ params }) {
	try {
		const { path } = await getExtensionBackup(params.backupId);
		return new Response(Readable.toWeb(createReadStream(path)), {
			headers: {
				'content-type': 'application/zip',
				'content-disposition': `attachment; filename="extension-${params.backupId}.zip"`,
				'cache-control': 'no-store'
			}
		});
	} catch {
		error(400, 'Extension backup is unavailable.');
	}
}
