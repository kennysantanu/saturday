import { daysBetween, formatDate, formatReminder, relativeDay } from './dates.js';
import { jobDetailUrl } from './job-navigation.js';
import { networkDetailUrl } from './network-navigation.js';

/**
 * @typedef {object} AttentionItem
 * @property {string} key
 * @property {'job-reminder' | 'person-reminder' | 'deadline'} kind
 * @property {'overdue' | 'today' | 'upcoming'} bucket
 * @property {string} sort
 * @property {string} title
 * @property {string} subtitle
 * @property {string | null} comment
 * @property {string} relative
 * @property {string} absolute
 * @property {boolean} overdue
 * @property {string} href
 * @property {{ id: number, owner: Record<string, number> } | null} reminder
 * @property {boolean} startsGroup
 */

/** Order the Dashboard shows groups in. */
export const attentionBuckets = [
	{ key: 'overdue', label: 'Overdue' },
	{ key: 'today', label: 'Today' },
	{ key: 'upcoming', label: 'Upcoming' }
];

const timeOf = (schedule) => {
	const time = schedule.slice(11, 16);
	return time && time !== '00:00' ? ` · ${time}` : '';
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Merge active reminders, application deadlines and (optionally) upcoming milestones into one
 * time-ordered list grouped by urgency: Overdue, Today, Upcoming. Each item carries relative text
 * ("3 days overdue", "Tomorrow · 09:00", "Due in 2 days"), its full date for a tooltip and a link.
 *
 * `returnTo` is the Dashboard URL that detail pages should return to.
 */
export function buildAttention({ reminders = [], deadlines = [], today, now, returnTo = '/' }) {
	/** @type {AttentionItem[]} */
	const items = [];
	for (const reminder of reminders) {
		const date = reminder.scheduled_at.slice(0, 10);
		const overdue = reminder.scheduled_at < now;
		const days = daysBetween(date, today);
		const relative = overdue
			? days > 0
				? `${plural(days, 'day')} overdue`
				: `Overdue today${timeOf(reminder.scheduled_at)}`
			: date === today
				? `Today${timeOf(reminder.scheduled_at)}`
				: relativeDay(date, today) + timeOf(reminder.scheduled_at);
		const job = Boolean(reminder.job_id);
		items.push({
			key: `reminder-${reminder.id}`,
			kind: job ? 'job-reminder' : 'person-reminder',
			bucket: overdue ? 'overdue' : date === today ? 'today' : 'upcoming',
			sort: reminder.scheduled_at,
			title: reminder.job_title ?? reminder.person_name ?? 'Reminder',
			subtitle: job
				? `${reminder.company_name}${reminder.job_closed ? ' · Closed job' : ''}`
				: 'Network',
			comment: reminder.note || null,
			relative,
			absolute: formatReminder(reminder.scheduled_at),
			overdue,
			href:
				(job
					? jobDetailUrl(reminder.job_id, returnTo)
					: networkDetailUrl(reminder.network_id, returnTo)) + '#reminders',
			reminder: {
				id: reminder.id,
				owner: job ? { job_id: reminder.job_id } : { network_id: reminder.network_id }
			},
			startsGroup: false
		});
	}
	for (const deadline of deadlines) {
		const isToday = deadline.date === today;
		items.push({
			key: `deadline-${deadline.jobId}`,
			kind: 'deadline',
			bucket: isToday ? 'today' : 'upcoming',
			sort: `${deadline.date}T23:59`,
			title: deadline.title,
			subtitle: `${deadline.company} · ${deadline.stage}`,
			comment: deadline.comment ?? null,
			relative: `Due ${relativeDay(deadline.date, today)
				.replace(/^In /, 'in ')
				.replace(/^(Today|Tomorrow)$/, (w) => w.toLowerCase())}`,
			absolute: `Application deadline ${formatDate(deadline.date)}`,
			overdue: false,
			href: jobDetailUrl(deadline.jobId, returnTo),
			reminder: null,
			startsGroup: false
		});
	}
	const order = Object.fromEntries(attentionBuckets.map((bucket, index) => [bucket.key, index]));
	items.sort((a, b) => order[a.bucket] - order[b.bucket] || a.sort.localeCompare(b.sort));
	let previous = '';
	for (const item of items) {
		item.startsGroup = item.bucket !== previous;
		previous = item.bucket;
	}
	const counts = Object.fromEntries(attentionBuckets.map((bucket) => [bucket.key, 0]));
	for (const item of items) counts[item.bucket]++;
	return { items, counts, total: items.length };
}

/**
 * Choose the rows to show first. Every non-empty group gets at least one row, so Today and
 * Upcoming are visible even when many items are overdue; spare rows go to the most urgent groups
 * first. Order is preserved in both lists, and each row stays in its group.
 */
export function splitAttention(items, visible = 5) {
	const counts = {};
	for (const item of items) counts[item.bucket] = (counts[item.bucket] ?? 0) + 1;
	const groups = attentionBuckets.map((b) => b.key).filter((key) => counts[key]);
	const quota = Object.fromEntries(groups.map((key) => [key, 0]));
	let spare = visible;
	for (const key of groups) if (spare > 0) (quota[key]++, spare--);
	for (const key of groups) {
		const extra = Math.min(spare, counts[key] - quota[key]);
		quota[key] += extra;
		spare -= extra;
	}
	const seen = {};
	const first = [];
	const rest = [];
	for (const item of items) {
		seen[item.bucket] = (seen[item.bucket] ?? 0) + 1;
		(seen[item.bucket] <= quota[item.bucket] ? first : rest).push(item);
	}
	return { first, rest };
}
