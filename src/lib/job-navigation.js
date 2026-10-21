/** Only the Dashboard and Jobs results can be return destinations. */
export function jobReturn(value) {
	if (
		typeof value !== 'string' ||
		value.length > 4000 ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		value.includes('\\') ||
		/[\u0000-\u001f]/.test(value)
	)
		return '/jobs';
	try {
		const url = new URL(value, 'http://saturday.local');
		if (url.origin !== 'http://saturday.local' || !['/', '/jobs'].includes(url.pathname))
			return '/jobs';
		url.searchParams.delete('return_to');
		url.searchParams.delete('saved');
		for (const key of [...url.searchParams.keys()])
			if (key.startsWith('/')) url.searchParams.delete(key);
		return (
			url.pathname +
			url.search +
			(url.pathname === '/' && /^#(?:job-pipeline|pipeline-stage-[1-9]\d*)$/.test(url.hash)
				? url.hash
				: '')
		);
	} catch {
		return '/jobs';
	}
}
export function jobDetailUrl(id, returnTo = '/jobs', saved) {
	const query = new URLSearchParams({ return_to: jobReturn(returnTo) });
	if (saved) query.set('saved', saved);
	return `/jobs/${id}?${query}`;
}
