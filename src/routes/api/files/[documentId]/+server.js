import { error } from '@sveltejs/kit';
import { Readable } from 'node:stream';
import { getDocument, openDocument } from '$lib/server/files/documents.js';
export async function GET({ params, url, request }) {
	try {
		const scope = url.searchParams.get('scope') ?? 'documents';
		const d = await getDocument({ id: params.documentId, scope });
		let range;
		const value = request.headers.get('range');
		if (value) {
			const match = /^bytes=(\d*)-(\d*)$/.exec(value);
			if (!match || !d.size)
				return new Response(null, {
					status: 416,
					headers: { 'content-range': `bytes */${d.size}` }
				});
			const start = match[1] ? Number(match[1]) : Math.max(0, d.size - Number(match[2]));
			const end = match[1]
				? match[2]
					? Math.min(Number(match[2]), d.size - 1)
					: d.size - 1
				: d.size - 1;
			if (!Number.isSafeInteger(start) || start < 0 || start > end || start >= d.size)
				return new Response(null, {
					status: 416,
					headers: { 'content-range': `bytes */${d.size}` }
				});
			range = { start, end };
		}
		const opened = await openDocument({ id: d.id, scope, range, token: d.token });
		const inline = url.searchParams.get('preview') === '1' && d.format === 'pdf';
		return new Response(Readable.toWeb(opened.stream), {
			status: range ? 206 : 200,
			headers: {
				'content-type': inline ? 'application/pdf' : 'application/octet-stream',
				'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
				'content-length': String(range ? range.end - range.start + 1 : d.size),
				'accept-ranges': 'bytes',
				...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${d.size}` } : {}),
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff',
				'content-security-policy': "sandbox; default-src 'none'"
			}
		});
	} catch (e) {
		error(e.code === 'NOT_FOUND' ? 404 : 400, e.code ? e.message : 'File is unavailable.');
	}
}
