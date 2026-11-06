export { formatDate, daysBetween, relativeDay, formatReminder } from './dates.js';

/** The host of a link without "www.", or the original text when it is not a valid URL. */
export function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

/** Today's date as `YYYY-MM-DD` in the user's local time zone. */
export function todayIso(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${now.getFullYear()}-${month}-${day}`;
}

/** A stored timestamp in the user's locale, such as "Oct 7, 2026, 9:15 AM". */
export function formatDateTime(value: string | number | Date): string {
	return new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/** File size with a unit that keeps the number short. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

/** Two-letter-or-less mark for a person or company. */
export function initialOf(text: string): string {
	return text.trim().slice(0, 1).toLocaleUpperCase();
}
