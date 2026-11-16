// Calendar-date helpers shared by the browser and Node (plain JavaScript so server code and tests
// can import it); `format.ts` re-exports them for components.

/** Format a `YYYY-MM-DD` calendar date without shifting it by time zone. */
export function formatDate(isoDate) {
	const [year, month, day] = isoDate.split('-').map(Number);
	if (!year || !month || !day) return isoDate;
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	}).format(new Date(year, month - 1, day));
}

/** Whole calendar days from `from` to `to` (both `YYYY-MM-DD`); negative when `to` is earlier. */
export function daysBetween(from, to) {
	const toUtc = (value) => {
		const [year, month, day] = value.split('-').map(Number);
		return Date.UTC(year, month - 1, day);
	};
	return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/**
 * Compact age badge and its spoken form: days below 30, then months (30 days each, rounded
 * down) below 365, then years (365 days each, rounded down). 45 days is "1mo"; 400 is "1y".
 */
export function formatAge(days) {
	const unit = (value, short, long) => ({
		short: `${value}${short}`,
		long: `${value} ${long}${value === 1 ? '' : 's'}`
	});
	if (days >= 365) return unit(Math.floor(days / 365), 'y', 'year');
	if (days >= 30) return unit(Math.floor(days / 30), 'mo', 'month');
	return unit(days, 'd', 'day');
}

/** "Tomorrow" or "In 5 days" for near dates, otherwise the formatted date. */
export function relativeDay(isoDate, today) {
	const days = daysBetween(today, isoDate);
	if (Number.isNaN(days)) return isoDate;
	if (days === 0) return 'Today';
	if (days === 1) return 'Tomorrow';
	if (days > 1 && days <= 14) return `In ${days} days`;
	return formatDate(isoDate);
}

/** A fixed reminder schedule; midnight is hidden without changing its stored meaning. */
export function formatReminder(value) {
	const [date, time] = value.split('T');
	return formatDate(date) + (time && time !== '00:00' ? ` · ${time}` : '');
}
