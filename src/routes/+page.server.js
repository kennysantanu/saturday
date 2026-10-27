import { localScheduleNow } from '$lib/domain/reminders.js';
import { getDashboardStats } from '$lib/server/application.js';
import { todayIso } from '$lib/format.js';
export async function load({ url }) {
	const today = todayIso();
	const pipelinePages = Object.fromEntries(
		[...url.searchParams]
			.filter(([key]) => /^pipeline_page_[1-9]\d*$/.test(key))
			.map(([key, value]) => [key.slice('pipeline_page_'.length), value])
	);
	const dashboard = await getDashboardStats({ today, pipelinePages });
	return { ...dashboard, today, now: localScheduleNow() };
}
