import { error } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { downloadManualBackup } from '$lib/server/application.js';
import { accessCookieName, localBrowser } from '$lib/server/access-settings.js';
import { getInstallation } from '$lib/server/installation.js';
import { validServerSession } from '$lib/server/server-lifecycle.js';
import { localPlatform } from '$lib/server/platform.js';

export async function GET(event) {
	const { params, url, request } = event;
	const contents = url.searchParams.get('contents') ?? 'database';
	const switchExportId = url.searchParams.get('switch_export');

	if (switchExportId !== null) {
		const origin = request.headers.get('origin');
		const fetchSite = request.headers.get('sec-fetch-site');
		const controlName = accessCookieName('control');
		const incomingControlCookie = (request.headers.get('cookie') || '')
			.split(';')
			.map((part) => part.trim())
			.find((part) => part.startsWith(`${controlName}=`))
			?.slice(controlName.length + 1);
		if (
			!localBrowser(event) ||
			!validServerSession(incomingControlCookie) ||
			(origin && origin !== url.origin) ||
			(fetchSite !== null && fetchSite !== 'same-origin' && fetchSite !== 'none')
		) {
			error(403, 'Use this installation’s local browser session.');
		}
		if (getInstallation().mode !== 'managed') {
			error(409, 'Branch switching is only available for managed installations.');
		}
		if (contents !== 'all') {
			error(409, 'Download a new database and files backup for this branch before moving.');
		}
		let receipt;
		try {
			receipt = localPlatform.readSwitchExport();
		} catch (e) {
			error(409, e.message);
		}
		if (
			!receipt ||
			receipt.status !== 'pending' ||
			receipt.id !== switchExportId ||
			receipt.backup_id !== params.id ||
			receipt.contents !== 'all'
		) {
			error(409, 'Download a new database and files backup for this branch before moving.');
		}
		let file;
		try {
			file = await downloadManualBackup({
				backup_id: params.id,
				contents: 'all'
			});
		} catch (e) {
			await localPlatform.clearSwitchExport({ export_id: switchExportId }).catch(() => {});
			error(e.code === 'NOT_FOUND' ? 404 : 400, e.code ? e.message : 'Backup download failed.');
		}
		if (file.contents !== 'all') {
			await file.stream.cancel('partial').catch(() => {});
			await localPlatform.clearSwitchExport({ export_id: switchExportId }).catch(() => {});
			error(409, 'Download a new database and files backup for this branch before moving.');
		}
		const reader = file.stream.getReader();
		const hash = createHash('sha256');
		let bytes = 0;
		let settled = false;
		let cancelled = false;
		const abortCleanup = () => {
			if (settled) return;
			cancelled = true;
			settled = true;
			void reader.cancel('aborted').catch(() => {});
			void localPlatform.clearSwitchExport({ export_id: switchExportId }).catch(() => {});
		};
		request.signal.addEventListener('abort', abortCleanup, { once: true });
		const wrapped = new ReadableStream({
			async pull(controller) {
				if (cancelled || request.signal.aborted) {
					cancelled = true;
					settled = true;
					request.signal.removeEventListener('abort', abortCleanup);
					await reader.cancel('aborted').catch(() => {});
					await localPlatform.clearSwitchExport({ export_id: switchExportId }).catch(() => {});
					controller.error(new Error('Backup download was cancelled.'));
					return;
				}
				try {
					const { value, done } = await reader.read();
					if (cancelled || request.signal.aborted) {
						cancelled = true;
						settled = true;
						request.signal.removeEventListener('abort', abortCleanup);
						await reader.cancel('aborted').catch(() => {});
						await localPlatform.clearSwitchExport({ export_id: switchExportId }).catch(() => {});
						controller.error(new Error('Backup download was cancelled.'));
						return;
					}
					if (done) {
						settled = true;
						request.signal.removeEventListener('abort', abortCleanup);
						reader.releaseLock();
						const completed = await localPlatform.completeSwitchExport({
							export_id: switchExportId,
							backup_id: params.id,
							filename: file.filename,
							bytes,
							sha256: hash.digest('hex')
						});
						if (!completed) {
							controller.error(new Error('Branch export state changed before download finished.'));
							return;
						}
						controller.close();
						return;
					}
					const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
					bytes += chunk.byteLength;
					hash.update(chunk);
					controller.enqueue(chunk);
				} catch (err) {
					settled = true;
					request.signal.removeEventListener('abort', abortCleanup);
					await localPlatform.clearSwitchExport({ export_id: switchExportId }).catch(() => {});
					controller.error(err);
				}
			},
			async cancel(reason) {
				cancelled = true;
				settled = true;
				request.signal.removeEventListener('abort', abortCleanup);
				await reader.cancel(reason).catch(() => {});
				await localPlatform.clearSwitchExport({ export_id: switchExportId }).catch(() => {});
			}
		});
		return new Response(wrapped, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': `attachment; filename="${file.filename}"`,
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff'
			}
		});
	}

	try {
		const file = await downloadManualBackup({
			backup_id: params.id,
			contents
		});
		return new Response(file.stream, {
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
