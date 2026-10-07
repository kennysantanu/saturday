import { redirect } from '@sveltejs/kit';
import { listNetworks } from '$lib/server/networks.js';
import { ValidationError, localCalendarDate } from '$lib/server/validation.js';

export function load({ url }) {
	const filters = Object.fromEntries(
		['name', 'role', 'organization', 'follow_up', 'sort', 'page']
			.filter((key) => url.searchParams.has(key))
			.map((key) => [key, url.searchParams.get(key)])
	);
	function href(page) {
		const params = new URLSearchParams();
		for (const key of ['name', 'role', 'organization', 'follow_up', 'sort'])
			if (
				filters[key]?.trim() &&
				filters[key] !== 'all' &&
				!(key === 'sort' && filters[key] === 'name')
			)
				params.set(key, filters[key].trim());
		if (page > 1) params.set('page', String(page));
		return '/networks' + (params.size ? '?' + params : '');
	}
	try {
		const result = listNetworks({ ...filters, limit: 50 });
		if (url.pathname + url.search !== href(result.page)) redirect(303, href(result.page));
		return {
			...result,
			filters,
			errors: {},
			today: localCalendarDate(),
			previous: result.page > 1 ? href(result.page - 1) : null,
			next: result.page < result.totalPages ? href(result.page + 1) : null,
			filtered: !!Object.keys(filters).filter((key) => key !== 'page' && key !== 'sort').length
		};
	} catch (e) {
		if (!(e instanceof ValidationError)) throw e;
		return {
			networks: [],
			total: 0,
			page: 1,
			totalPages: 1,
			filters,
			errors: e.fieldErrors,
			today: localCalendarDate(),
			previous: null,
			next: null,
			filtered: true
		};
	}
}
