import { listJobs } from '$lib/server/services.js';
import { DASHBOARD_CARDS } from '$lib/status.js';

const STEPS = new Map(
	DASHBOARD_CARDS.filter((card) => card.group === 'history').map((card) => [card.key, card.label])
);

export function load({ url }) {
	// A step filter counts every job that reached the step, so it always includes inactive jobs.
	const requestedStep = url.searchParams.get('step');
	const step = requestedStep && STEPS.has(requestedStep) ? requestedStep : null;
	const showAll = step !== null || url.searchParams.get('view') === 'all';
	return {
		jobs: listJobs({ includeInactive: showAll, reached: step }),
		showAll,
		step,
		stepLabel: step ? STEPS.get(step) : null
	};
}
