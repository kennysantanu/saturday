import { getDashboardStats } from '$lib/server/services.js';
import { todayIso } from '$lib/format.js';

export function load() {
	const today = todayIso();
	return { ...getDashboardStats({ today }), today };
}
