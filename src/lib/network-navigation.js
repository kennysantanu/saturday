import { jobReturn } from './job-navigation.js';

function localUrl(value) {
	if (
		typeof value !== 'string' ||
		value.length > 4000 ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		value.includes('\\') ||
		/[\u0000-\u001f\u007f]/.test(value)
	)
		return null;
	try {
		const url = new URL(value, 'http://saturday.local');
		if (url.origin !== 'http://saturday.local') return null;
		url.hash = '';
		url.searchParams.delete('saved');
		for (const key of [...url.searchParams.keys()])
			if (key.startsWith('/')) url.searchParams.delete(key);
		return url;
	} catch {
		return null;
	}
}

/** A person can return to Network results or the originating job, with its list context. */
export function networkReturn(value) {
	const url = localUrl(value);
	if (!url) return '/networks';
	if (url.pathname === '/networks') url.searchParams.delete('return_to');
	else {
		const match = /^\/jobs\/([1-9]\d*)$/.exec(url.pathname);
		if (!match || !Number.isSafeInteger(Number(match[1]))) return '/networks';
		if (url.searchParams.has('return_to'))
			url.searchParams.set('return_to', jobReturn(url.searchParams.get('return_to')));
		for (const key of ['link_person', 'person', 'person_page']) url.searchParams.delete(key);
	}
	return url.pathname + url.search;
}

export function networkDetailUrl(id, returnTo, pages = new URLSearchParams(), saved) {
	const query = new URLSearchParams({ return_to: networkReturn(returnTo) });
	for (const key of ['jobs_page', 'updates_page']) {
		const value = pages.get(key);
		if (/^[1-9]\d*$/.test(value ?? '') && Number.isSafeInteger(Number(value)))
			query.set(key, value);
	}
	if (saved) query.set('saved', saved);
	return `/networks/${id}?${query}`;
}

/** Editing may return only to this person's detail, retaining its independent pages. */
export function networkEditReturn(value, id) {
	const url = localUrl(value);
	return url?.pathname === `/networks/${id}`
		? networkDetailUrl(id, url.searchParams.get('return_to'), url.searchParams)
		: networkDetailUrl(id);
}
