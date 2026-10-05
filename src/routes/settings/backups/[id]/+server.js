import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { getBackupFile, publicBackupError } from '$lib/server/backups.js';

export function GET({ params }) {
	try {
		const file = getBackupFile(params.id);
		return new Response(readFileSync(file.path), {
			headers: {
				'Content-Type': 'application/vnd.sqlite3',
				'Content-Disposition': `attachment; filename="${file.metadata.filename}"`,
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff'
			}
		});
	} catch (cause) {
		const detail = publicBackupError(cause);
		error(detail.code === 'not_found' ? 404 : 400, detail.message);
	}
}
