import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { getFileBackup } from '$lib/server/files/backups.js';
export async function GET({ params }) {
	try {
		const { path, metadata } = await getFileBackup(params.backupId);
		return new Response(Readable.toWeb(createReadStream(path)), {
			headers: {
				'content-type': 'application/zip',
				'content-length': String(metadata.bytes),
				'content-disposition': `attachment; filename="${metadata.filename}"`,
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch {
		error(404, 'File backup not found.');
	}
}
