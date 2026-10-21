import { getDashboardStats } from '$lib/server/services.js';
import { todayIso } from '$lib/format.js';

export function load({ url }) {
	const today = todayIso();
	const pipelinePages = Object.fromEntries(
		[...url.searchParams]
			.filter(([key]) => /^pipeline_page_[1-9]\d*$/.test(key))
			.map(([key, value]) => [key.slice('pipeline_page_'.length), value])
	);
	const dashboard = getDashboardStats({ today, pipelinePages });
	return { ...dashboard, today };
}
