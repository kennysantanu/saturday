// Test-process preload: replace only the official distribution URLs with fictional fixtures.
// Production code has no test endpoint or environment switch.
import { readFile } from 'node:fs/promises';
if (process.env.SATURDAY_TEST_RELEASE_FIXTURE) {
	const nativeFetch = globalThis.fetch;
	globalThis.fetch = async (input, options) => {
		const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
		if (!['api.github.com', 'codeload.github.com'].includes(url.hostname))
			return nativeFetch(input, options);
		const state = JSON.parse(await readFile(process.env.SATURDAY_TEST_RELEASE_FIXTURE));
		if (state.offline) throw new Error('Fictional distribution is offline.');
		const current = state.releases[state.selected];
		const json = (value) =>
			new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
		if (url.hostname === 'codeload.github.com') {
			const release = Object.values(state.releases).find((r) =>
				url.pathname.endsWith(r.metadata.commit)
			);
			if (!release || state.fail_download)
				return new Response('Fictional download failure', { status: 503 });
			return new Response(await readFile(release.archive));
		}
		if (url.pathname.includes('/releases/assets/'))
			return new Response(state.tamper ? 'tampered' : JSON.stringify(current.metadata));
		if (url.pathname.endsWith('/releases'))
			return json([
				{
					tag_name: `v${current.metadata.release}`,
					id: 1,
					assets: [
						{ name: 'saturday-release.json', state: 'uploaded', id: 2, digest: current.digest }
					]
				}
			]);
		if (url.pathname.includes('/commits/')) {
			const ref = decodeURIComponent(url.pathname.split('/').at(-1));
			const release =
				Object.values(state.releases).find(
					(r) => r.metadata.commit === ref || `v${r.metadata.release}` === ref
				) ?? current;
			return json({ sha: release.metadata.commit, commit: { tree: { sha: release.tree_sha } } });
		}
		if (url.pathname.includes('/git/trees/')) {
			const release = Object.values(state.releases).find((r) => url.pathname.endsWith(r.tree_sha));
			if (release) return json({ truncated: false, tree: release.tree });
		}
		if (url.pathname.endsWith('/contents/package.json'))
			return json({
				encoding: 'base64',
				content: Buffer.from(JSON.stringify(current.package)).toString('base64')
			});
		throw new Error(`Unexpected fictional distribution request: ${url.pathname}`);
	};
}
