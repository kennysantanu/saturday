// Shared filter and search vocabulary so every list, picker and chip says the same thing.

export const filterLabels = {
	any: 'Any',
	apply: 'Apply filters',
	clear: 'Clear filters',
	search: 'Search',
	clearSearch: 'Clear search'
};

// Reminder and date modes. Older URLs used `unset` (Jobs) and `not_scheduled` (Network) for the
// same idea; both still parse and both read "Not set".
export const reminderLabels = {
	any: 'Any',
	all: 'Any',
	unset: 'Not set',
	not_scheduled: 'Not set',
	set: 'Scheduled',
	overdue: 'Overdue',
	today: 'Today',
	upcoming: 'Upcoming',
	range: 'Date range'
};

export function reminderLabel(value) {
	return reminderLabels[value] ?? String(value);
}

const plural = (count, one, many) => (count === 1 ? one : many);

/**
 * Natural-language result count used under every filter bar, for example "3 jobs",
 * "1 person matching filters" or "2 documents matching search".
 * `qualifier` is the suffix to use when `filtered` is true and `scope` an optional suffix otherwise.
 */
export function resultCount(
	total,
	{ one, many, filtered = false, qualifier = 'matching filters', scope = '' }
) {
	const noun = plural(total, one, many);
	const suffix = filtered ? qualifier : scope;
	return `${total} ${noun}${suffix ? ` ${suffix}` : ''}`;
}

/** "key_name" -> "key name" for validation notices that list raw field keys. */
export function readableKey(key) {
	return String(key).replaceAll('_', ' ');
}
