/**
 * Shared labels and display rules for job status and update types.
 * Safe to import from browser and server code (no database access here).
 * Names follow plans/MVP.md ("User workflow and names").
 */

import { EVENT_LABELS as eventLabels } from './event-labels.js';

export const EVENT_TYPES = [
	'applied',
	'prescreened',
	'interview_1',
	'interview_2',
	'offer',
	'accepted',
	'rejected',
	'dismissed',
	'reopened'
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Choices offered in the Add update form ("What happened?"). The "note" choice is a
 * form-only value: it is stored with no `event_type` (a general Note).
 */
export const UPDATE_CHOICES: { value: EventType | 'note'; label: string }[] = [
	{ value: 'applied', label: 'Applied' },
	{ value: 'prescreened', label: 'Prescreen' },
	{ value: 'interview_1', label: 'Interview 1' },
	{ value: 'interview_2', label: 'Interview 2' },
	{ value: 'offer', label: 'Offer received' },
	{ value: 'accepted', label: 'Accepted offer' },
	{ value: 'rejected', label: 'Rejected by employer' },
	{ value: 'note', label: 'Note' }
];

export const EVENT_LABELS: Record<EventType, string> = eventLabels;

/** Visual tone used by the status badge. */
export type StatusTone = 'neutral' | 'info' | 'progress' | 'success' | 'danger' | 'muted';

export type StatusInfo = {
	/** Short label shown in the badge, such as "In process · Interview 1". */
	label: string;
	tone: StatusTone;
};

/** Dashboard cards. Order matches the MVP: current activity first, then historical counts. */
export const DASHBOARD_CARDS = [
	{ key: 'active', label: 'Active now', group: 'current' },
	{ key: 'applied', label: 'Ever applied', group: 'history' },
	{ key: 'prescreened', label: 'Prescreen reached', group: 'history' },
	{ key: 'interview_1', label: 'Interview 1 reached', group: 'history' },
	{ key: 'interview_2', label: 'Interview 2 reached', group: 'history' },
	{ key: 'offer', label: 'Offers received', group: 'history' },
	{ key: 'accepted', label: 'Accepted', group: 'history' },
	{ key: 'rejected', label: 'Ever rejected', group: 'history' },
	{ key: 'dismissed', label: 'Ever dismissed', group: 'history' }
] as const;

export type DashboardCardKey = (typeof DASHBOARD_CARDS)[number]['key'];
