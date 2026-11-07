import { authenticationRequired } from '$lib/auth-notice.svelte';

/**
 * Sends one file to `/api/files/upload` with progress. Resolves with the server's JSON and rejects
 * with an Error whose message is safe to show. A sign-in prompt is raised on a 401; `retry` is what
 * the prompt runs once the person has signed in again (normally the caller's own upload function).
 */
export function uploadFile(
	file: File,
	params: Record<string, string>,
	{ onprogress, retry }: { onprogress?: (percent: number) => void; retry?: () => void } = {}
): Promise<any> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open(
			'POST',
			`/api/files/upload?${new URLSearchParams({ ...params, filename: file.name })}`
		);
		xhr.setRequestHeader('Content-Type', 'application/octet-stream');
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onprogress?.(Math.round((100 * e.loaded) / e.total));
		};
		xhr.onerror = () => reject(new Error('Upload interrupted. Inspect the list before retrying.'));
		xhr.onload = () => {
			let value: any = {};
			try {
				value = JSON.parse(xhr.responseText);
			} catch {
				/* not JSON */
			}
			if (xhr.status < 300) return resolve(value);
			if (xhr.status === 401 && xhr.getResponseHeader('x-saturday-auth') === 'required')
				authenticationRequired(retry ? { label: file.name, run: retry } : undefined);
			reject(new Error(value.error ?? 'Upload failed.'));
		};
		xhr.send(file);
	});
}
