import { error } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { downloadManualBackup } from '$lib/server/files/pairs.js';
export async function GET({ params, url }) {
	try {
		const file = await downloadManualBackup({
			backup_id: params.id,
			contents: url.searchParams.get('contents') ?? 'database'
		});
		return new Response(Readable.toWeb(file.stream), {
			headers: {
				'Content-Type':
					file.contents === 'database' ? 'application/vnd.sqlite3' : 'application/zip',
				'Content-Disposition': `attachment; filename="${file.filename}"`,
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff'
			}
		});
	} catch (e) {
		error(e.code === 'NOT_FOUND' ? 404 : 400, e.code ? e.message : 'Backup download failed.');
	}
}
