// Shared wire/storage names and human-readable labels. No alternate display-name store.
export const DEFAULT_TAG_COLOR = '#64748b';
export const canonicalTagPattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
export const tagColorPattern = /^#[0-9a-f]{6}$/;
/** Curated mid-tones that read well as a tint and dot in light and dark themes. The first is the default. */
export const tagPalette = Object.freeze([
	{ name: 'Slate', color: '#64748b' },
	{ name: 'Red', color: '#ef4444' },
	{ name: 'Orange', color: '#f97316' },
	{ name: 'Amber', color: '#eab308' },
	{ name: 'Green', color: '#22c55e' },
	{ name: 'Teal', color: '#14b8a6' },
	{ name: 'Sky', color: '#0ea5e9' },
	{ name: 'Blue', color: '#3b82f6' },
	{ name: 'Violet', color: '#a855f7' },
	{ name: 'Pink', color: '#ec4899' }
]);
export function normalizeTagName(value) {
	if (typeof value !== 'string' || /[^a-zA-Z0-9_\s]/.test(value)) return null;
	return value
		.toLowerCase()
		.replace(/[\s_]+/g, '_')
		.replace(/^_|_$/g, '');
}
export const displayTagName = (name) => name.replaceAll('_', ' ');
// Form drafts can contain malformed bookmarked IDs. Services still reject invalid writes.
export function validTagSelection(ids = []) {
	return [
		...new Set(
			ids.map(String).filter((id) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)))
		)
	];
}
