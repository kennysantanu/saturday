// Test-process preload: replace only GitHub API/archive URLs with fictional branch fixtures.
// Production code has no test endpoint or environment switch.
import { readFile } from 'node:fs/promises';

if (process.env.SATURDAY_TEST_BRANCH_FIXTURE) {
	const nativeFetch = globalThis.fetch;
	globalThis.fetch = async (input, options) => {
		const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
		if (!['api.github.com', 'codeload.github.com'].includes(url.hostname)) {
			return nativeFetch(input, options);
		}
		const state = JSON.parse(await readFile(process.env.SATURDAY_TEST_BRANCH_FIXTURE, 'utf8'));
		if (state.offline) {
			return new Response(JSON.stringify({ message: 'Rate limited' }), { status: 403 });
		}
		const json = (value, status = 200) =>
			new Response(JSON.stringify(value), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		if (url.hostname === 'codeload.github.com') {
			const sha = url.pathname.split('/').at(-1);
			const commitEntry = state.commits?.[sha];
			if (!commitEntry?.archive || state.fail_download) {
				return new Response('Fictional download failure', { status: 503 });
			}
			return new Response(await readFile(commitEntry.archive));
		}
		if (url.pathname.endsWith('/releases')) {
			return json(state.releases ?? []);
		}
		if (url.pathname.endsWith('/branches')) {
			if (state.fail_branches) {
				return new Response(JSON.stringify({ message: 'Rate limited' }), { status: 403 });
			}
			const page = Number(url.searchParams.get('page') || 1);
			const rows = Array.isArray(state.branches) ? state.branches : [];
			return json(page === 1 ? rows : []);
		}
		if (url.pathname.includes('/commits/')) {
			const ref = decodeURIComponent(url.pathname.split('/').at(-1));
			const sha = state.refs?.[ref] ?? (state.commits?.[ref] ? ref : null);
			if (!sha) return json({ message: 'Not Found' }, 404);
			const entry = state.commits?.[sha] ?? {};
			return json({
				sha,
				commit: { tree: { sha: entry.tree_sha ?? '0'.repeat(40) } }
			});
		}
		if (url.pathname.includes('/compare/')) {
			const spec = decodeURIComponent(url.pathname.split('/compare/').at(-1));
			const entry =
				state.compare && Object.prototype.hasOwnProperty.call(state.compare, spec)
					? state.compare[spec]
					: (state.compare?.default ?? state.compare_status);
			if (entry === 404 || entry === null) {
				return json({ message: 'Not Found' }, 404);
			}
			if (typeof entry === 'number') {
				return json({ message: 'Compare error' }, entry);
			}
			if (typeof entry === 'string') {
				return json({ status: entry });
			}
			if (entry && typeof entry === 'object') {
				const httpStatus = entry.httpStatus ?? 200;
				const body = 'body' in entry ? entry.body : entry;
				return json(body, httpStatus);
			}
			return json({ message: 'Not Found' }, 404);
		}
		if (url.pathname.includes('/git/trees/')) {
			const treeSha = url.pathname.split('/').at(-1);
			const entry = Object.values(state.commits ?? {}).find((c) => c.tree_sha === treeSha);
			if (entry?.tree) return json({ truncated: false, tree: entry.tree });
			return json({ message: 'Not Found' }, 404);
		}
		if (url.pathname.endsWith('/contents/package.json')) {
			const ref = url.searchParams.get('ref');
			const pkg = state.commits?.[ref]?.package;
			if (!pkg) return json({ message: 'Not Found' }, 404);
			return json({
				encoding: 'base64',
				content: Buffer.from(JSON.stringify(pkg)).toString('base64')
			});
		}
		throw new Error(`Unexpected fictional branch request: ${url.pathname}${url.search}`);
	};
}
