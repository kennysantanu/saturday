// Shared wire/storage names and human-readable labels. No alternate display-name store.
export const DEFAULT_TAG_COLOR = '#64748b';
export const canonicalTagPattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
export const tagColorPattern = /^#[0-9a-f]{6}$/;
export function normalizeTagName(value) {
	if (typeof value !== 'string' || /[^a-zA-Z0-9_\s]/.test(value)) return null;
	return value
		.toLowerCase()
		.replace(/[\s_]+/g, '_')
		.replace(/^_|_$/g, '');
}
export const displayTagName = (name) => name.replaceAll('_', ' ');
export function tagTextColor(hex) {
	const components = [1, 3, 5].map((offset) => {
		const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	const luminance = components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
	return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

// Form drafts can contain malformed bookmarked IDs. Services still reject invalid writes.
export function validTagSelection(ids = []) {
	return [
		...new Set(
			ids.map(String).filter((id) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)))
		)
	];
}
