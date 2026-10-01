/** Format a `YYYY-MM-DD` calendar date without shifting it by time zone. */
export function formatDate(isoDate: string): string {
	const [year, month, day] = isoDate.split('-').map(Number);
	if (!year || !month || !day) return isoDate;
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	}).format(new Date(year, month - 1, day));
}

/** "Tomorrow" or "In 5 days" for near dates, otherwise the formatted date. */
export function relativeDay(isoDate: string, today: string): string {
	const toUtc = (value: string) => {
		const [year, month, day] = value.split('-').map(Number);
		return Date.UTC(year, month - 1, day);
	};
	const days = Math.round((toUtc(isoDate) - toUtc(today)) / 86_400_000);
	if (Number.isNaN(days)) return isoDate;
	if (days === 0) return 'Today';
	if (days === 1) return 'Tomorrow';
	if (days > 1 && days <= 14) return `In ${days} days`;
	return formatDate(isoDate);
}

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
