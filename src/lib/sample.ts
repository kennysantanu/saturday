import type { DashboardCardKey, StatusInfo } from '$lib/status';

/**
 * Phase 1 placeholder content so the first look and feel can be reviewed before
 * database work. Replaced by real reads from SQLite in Phases 3 and 5.
 */

export type SampleJob = {
	id: string;
	title: string;
	company: string;
	status: StatusInfo;
	isActive: boolean;
	latestUpdate: string;
	latestDate: string;
	postingUrl?: string;
	description?: string;
	notes?: string;
	history: { id: string; label: string; date: string; note?: string; by: 'manual' | 'assistant' }[];
};

export const sampleJobs: SampleJob[] = [
	{
		id: 'sample-1',
		title: 'Product Designer',
		company: 'Northwind Labs',
		status: { label: 'In process · Interview 1', tone: 'progress' },
		isActive: true,
		latestUpdate: 'Interview 1 · Oct 7',
		latestDate: '2026-10-07',
		postingUrl: 'https://example.com/careers/product-designer',
		description:
			'Lead end-to-end design for a small team building tools for independent researchers.',
		notes: 'Referred by Sam. Ask about the design system roadmap.',
		history: [
			{
				id: 'h3',
				label: 'Interview 1',
				date: '2026-10-07',
				note: 'Met the hiring manager',
				by: 'assistant'
			},
			{
				id: 'h2',
				label: 'Prescreen',
				date: '2026-10-01',
				note: 'Recruiter asked about availability',
				by: 'assistant'
			},
			{ id: 'h1', label: 'Applied', date: '2026-09-24', by: 'manual' }
		]
	},
	{
		id: 'sample-2',
		title: 'Frontend Engineer',
		company: 'Harbor & Pine',
		status: { label: 'Applied', tone: 'info' },
		isActive: true,
		latestUpdate: 'Applied · Sep 28',
		latestDate: '2026-09-28',
		history: [{ id: 'h4', label: 'Applied', date: '2026-09-28', by: 'manual' }]
	},
	{
		id: 'sample-3',
		title: 'Design Systems Lead',
		company: 'Plainfield',
		status: { label: 'New', tone: 'neutral' },
		isActive: true,
		latestUpdate: 'No updates yet',
		latestDate: '2026-09-29',
		history: []
	},
	{
		id: 'sample-4',
		title: 'UX Researcher',
		company: 'Meridian Health',
		status: { label: 'Dismissed', tone: 'muted' },
		isActive: false,
		latestUpdate: 'Dismissed · Sep 20',
		latestDate: '2026-09-20',
		history: [
			{ id: 'h6', label: 'Dismissed', date: '2026-09-20', by: 'manual' },
			{ id: 'h5', label: 'Applied', date: '2026-09-15', by: 'manual' }
		]
	}
];

export const sampleStats: Record<DashboardCardKey, number> = {
	active: 3,
	applied: 3,
	prescreened: 1,
	interview_1: 1,
	interview_2: 0,
	offer: 0,
	accepted: 0,
	rejected: 0,
	dismissed: 1
};

export function findSampleJob(id: string) {
	return sampleJobs.find((job) => job.id === id);
}
