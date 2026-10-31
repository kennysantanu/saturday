type RecentView = { kind: string; id: number; dataset_id: string };

// Serialize rapid navigations and let the menu wait for the last completed view.
let pending = Promise.resolve();
export function recordRecentView(view: RecentView) {
	pending = pending.then(async () => {
		try {
			await fetch('/api/recents', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(view),
				signal: AbortSignal.timeout(5000)
			});
		} catch {
			// Optional navigation history must never interrupt the page being viewed.
		}
	});
}
export function waitForRecentViews() {
	return pending;
}
