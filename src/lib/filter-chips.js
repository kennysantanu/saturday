/**
 * Chip helpers for lists whose filters live directly in URL parameters (Network, Documents).
 * Jobs derives chips from its normalized filter values in `job-search.js` instead.
 */

/** The list URL without the given parameters (and without `page`, which a filter change resets). */
export function hrefWithout(base, searchParams, ...keys) {
	const query = new URLSearchParams(searchParams);
	for (const key of ['page', ...keys]) query.delete(key);
	return base + (query.size ? `?${query}` : '');
}

/** One chip per repeated value, for example tag_ids. `option` supplies `{ label, color? }`. */
export function hrefWithoutValue(base, searchParams, key, value) {
	const query = new URLSearchParams(searchParams);
	query.delete('page');
	query.delete(key);
	for (const item of searchParams.getAll(key)) if (item !== String(value)) query.append(key, item);
	return base + (query.size ? `?${query}` : '');
}

/**
 * Build chips for single-valued text/select filters.
 * `specs` is `[param, label, { value?, format?, skip? }]`; values come from `filters[param]`.
 */
export function buildChips(base, searchParams, filters, specs) {
	const chips = [];
	for (const [param, label, options = {}] of specs) {
		const value = filters[param];
		if (value === undefined || value === null || value === '' || value === options.skip) continue;
		const shown = options.format ? options.format(value) : value;
		chips.push({
			key: param,
			label: `${label}: ${shown}`,
			href: hrefWithout(base, searchParams, param)
		});
	}
	return chips;
}

/** Chips for selected tags; each removes only its own tag id. */
export function tagChips(base, searchParams, tags) {
	return tags.map((tag) => ({
		key: `tag_ids:${tag.id}`,
		label: `Tag: ${tag.display_name}`,
		href: hrefWithoutValue(base, searchParams, 'tag_ids', tag.id),
		color: tag.color
	}));
}
