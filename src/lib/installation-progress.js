// Browser-side progress for installation operations (update, repair, uninstall).
// Pure apart from the injected request/navigation functions so it can be unit tested.

export const activeInstallationStates = [
	'queued',
	'staging',
	'waiting_for_disconnect',
	'backing_up',
	'publishing',
	'migrating',
	'restarting',
	'removing'
];

export const restartingStep =
	'Saturday is restarting to finish this operation. This page reloads when Saturday is ready; sign in to see the result.';
export const uninstallStoppedStep =
	'Saturday has stopped to finish uninstalling. This page will not reload. Your data and backups are kept unless you chose to delete them.';
export const timeoutError =
	'Progress timed out. Inspect the installation log or run the installation status command; do not repeat an uncertain operation.';

const isActive = (operation) =>
	activeInstallationStates.includes(operation?.status) && !operation?.error;

/** Reads the running server's generation from loopback /health, or null when unavailable. */
async function healthGeneration(request) {
	try {
		const response = await request('/health');
		if (!response.ok) return null;
		const health = await response.json();
		return health.status === 'ready' ? (health.server_generation ?? null) : null;
	} catch {
		return null;
	}
}

/**
 * Follows an operation until it settles.
 *
 * Without password login, status comes from the controller's progress gateway (`poll_url`),
 * which keeps working while the UI is stopped.
 *
 * With password login there is no unauthenticated gateway. Status is read from the signed-in
 * `/settings/installation` while the UI runs. The UI only counts as stopped after a network
 * failure *and* a failed /health probe, so a slow response during a build never reloads the
 * page. After a stop, the page reloads only once /health reports a different server generation.
 *
 * @param {object} options
 * @param {any} options.initial operation status from the server
 * @param {boolean} options.passwordLogin
 * @param {(path: string) => Promise<{ok: boolean, status: number, json: () => Promise<any>}>} options.request
 *   fetch-like; must reject on network errors and time out on its own
 * @param {(url: string) => void} options.navigate
 * @param {(operation: any) => void} options.report shows progress to the user
 * @param {() => boolean} [options.cancelled]
 * @param {(ms: number) => Promise<void>} [options.wait]
 * @param {() => number} [options.now]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.intervalMs]
 */
export async function pollInstallationProgress({
	initial,
	passwordLogin,
	request,
	navigate,
	report,
	cancelled = () => false,
	wait = (ms) => new Promise((r) => setTimeout(r, ms)),
	now = Date.now,
	timeoutMs = 30 * 60 * 1000,
	intervalMs = 750
}) {
	let operation = initial,
		uiStopped = false;
	const generation = passwordLogin ? await healthGeneration(request) : null;
	const deadline = now() + timeoutMs;
	while (!cancelled() && now() < deadline) {
		if (!uiStopped) report(operation);
		if (!isActive(operation)) {
			// A restarted server issues a new control session; reload from it after completion
			// or after a failure that restarted the previous app.
			if (
				operation.url &&
				operation.operation !== 'uninstall' &&
				(operation.status === 'complete' || operation.error)
			)
				navigate(`${operation.url}/settings#updates`);
			return;
		}
		await wait(intervalMs);
		if (cancelled()) return;
		if (!passwordLogin) {
			try {
				const response = await request(operation.poll_url || '/settings/installation');
				if (response.ok) operation = await response.json();
			} catch {
				/* The retained controller continues across UI shutdown. */
			}
			continue;
		}
		if (uiStopped) {
			const current = await healthGeneration(request);
			if (current && current !== generation) {
				navigate('/settings#updates');
				return;
			}
			continue;
		}
		let response = null;
		try {
			response = await request('/settings/installation');
		} catch {
			/* Network failure: confirm below whether the UI stopped. */
		}
		if (response?.ok) {
			operation = await response.json();
			continue;
		}
		if (response?.status === 401) {
			// The session expired while the UI still runs. Signing in again resumes progress.
			navigate('/settings#updates');
			return;
		}
		if (response && response.status < 500) continue;
		// Same server still answering: the failure was transient.
		const current = await healthGeneration(request);
		if (current && current === generation) continue;
		uiStopped = true;
		if (operation.operation === 'uninstall') {
			report({ ...operation, step: uninstallStoppedStep });
			return;
		}
		report({ ...operation, step: restartingStep });
	}
	if (!cancelled()) report({ ...operation, error: timeoutError });
}
