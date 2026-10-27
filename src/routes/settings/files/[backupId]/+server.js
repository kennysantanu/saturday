import { error } from '@sveltejs/kit';
import { downloadFileBackup } from '$lib/server/application.js';
export async function GET({ params }) {
	try {
		const { stream, metadata } = await downloadFileBackup(params.backupId);
		return new Response(stream, {
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
