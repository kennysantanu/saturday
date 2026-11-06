import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAttention, splitAttention } from '../src/lib/dashboard-attention.js';
import { daysBetween } from '../src/lib/dates.js';

const today = '2026-11-06';
const now = '2026-11-06T10:00';
const reminder = (id, scheduled_at, extra = {}) => ({
	id,
	scheduled_at,
	note: '',
	job_id: 1,
	job_title: 'Role',
	company_name: 'Acme',
	...extra
});

test('daysBetween counts calendar days in either direction', () => {
	assert.equal(daysBetween('2026-11-06', '2026-11-09'), 3);
	assert.equal(daysBetween('2026-11-06', '2026-11-03'), -3);
	assert.equal(daysBetween('2026-11-06', '2026-11-06'), 0);
});

test('attention items are grouped Overdue, Today, Upcoming with relative labels and mixed kinds', () => {
	const result = buildAttention({
		today,
		now,
		reminders: [
			reminder(1, '2026-11-09T09:00'),
			reminder(2, '2026-11-03T09:00'),
			reminder(3, '2026-11-06T09:00'),
			reminder(4, '2026-11-06T15:30'),
			reminder(5, '2026-11-07T00:00', { job_id: null, network_id: 7, person_name: 'Ada' })
		],
		deadlines: [
			{ jobId: 9, title: 'Deadline job', company: 'Co', stage: 'New', date: '2026-11-08' },
			{ jobId: 8, title: 'Due today', company: 'Co', stage: 'New', date: '2026-11-06' }
		]
	});
	assert.deepEqual(
		result.items.map((item) => [item.bucket, item.relative]),
		[
			['overdue', '3 days overdue'],
			['overdue', 'Overdue today · 09:00'],
			['today', 'Today · 15:30'],
			['today', 'Due today'],
			['upcoming', 'Tomorrow'],
			['upcoming', 'Due in 2 days'],
			['upcoming', 'In 3 days · 09:00']
		]
	);
	assert.deepEqual(result.counts, { overdue: 2, today: 2, upcoming: 3 });
	assert.deepEqual(
		result.items.filter((item) => item.startsGroup).map((item) => item.bucket),
		['overdue', 'today', 'upcoming']
	);
	const person = result.items.find((item) => item.kind === 'person-reminder');
	assert.deepEqual(person.reminder.owner, { network_id: 7 });
	assert.match(person.href, /^\/networks\/7\?.*#reminders$/);
	assert.equal(result.items.find((item) => item.kind === 'deadline').reminder, null);
});

test('splitAttention shows every group before filling spare rows', () => {
	const mk = (bucket, n) => Array.from({ length: n }, (_, i) => ({ bucket, id: `${bucket}${i}` }));
	const items = [...mk('overdue', 7), ...mk('today', 1), ...mk('upcoming', 18)];
	const { first, rest } = splitAttention(items, 5);
	assert.deepEqual(
		first.map((item) => item.id),
		['overdue0', 'overdue1', 'overdue2', 'today0', 'upcoming0']
	);
	assert.equal(rest.length, 21);
	assert.equal(splitAttention(items.slice(0, 3), 5).rest.length, 0);
	assert.deepEqual(
		splitAttention(mk('upcoming', 8), 5).first.map((item) => item.id),
		['upcoming0', 'upcoming1', 'upcoming2', 'upcoming3', 'upcoming4']
	);
});
