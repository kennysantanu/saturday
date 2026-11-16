import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
import { compileModule } from 'svelte/compiler';

// Exercise the real submission wrapper without a browser or SvelteKit server.
function boundaries(entry) {
	return build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		format: 'esm',
		plugins: [
			{
				name: 'browser-boundaries',
				setup(builder) {
					builder.onResolve({ filter: /^(svelte|\$lib\/auth-notice.svelte)$/ }, ({ path }) => ({
						path,
						namespace: 'fixture'
					}));
					builder.onResolve({ filter: /^\$lib\/forms$/ }, () => ({
						path: new URL('../src/lib/forms.ts', import.meta.url).pathname
					}));
					builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
						contents:
							path === 'svelte'
								? 'export const tick = async () => {};'
								: 'export const authenticationRequired = () => { globalThis.__authNotices = (globalThis.__authNotices ?? 0) + 1; };'
					}));
					// Runes need the Svelte compiler; strip the types first.
					builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
						const js = await transform(await readFile(path, 'utf8'), { loader: 'ts' });
						return { contents: compileModule(js.code, { filename: path }).js.code, loader: 'js' };
					});
				}
			}
		]
	});
}
const load = async (entry) =>
	import(
		`data:text/javascript;base64,${Buffer.from((await boundaries(entry)).outputFiles[0].text).toString('base64')}`
	);
const { withPending } = await load('src/lib/forms.ts');
const { UnsavedChanges } = await load('src/lib/unsaved.svelte.ts');
function submission() {
	const attributes = new Map();
	let cancelled = false;
	return {
		attributes,
		get cancelled() {
			return cancelled;
		},
		input: {
			formElement: {
				setAttribute: (name, value) => attributes.set(name, value),
				removeAttribute: (name) => attributes.delete(name)
			},
			cancel: () => {
				cancelled = true;
			}
		}
	};
}

test('pending state clears when pre-submit work fails or cancels submission', async () => {
	const thrown = submission();
	await assert.rejects(
		withPending(async () => {
			throw new Error('upload failed');
		})(thrown.input),
		/upload failed/
	);
	assert.equal(thrown.attributes.has('aria-busy'), false);
	const cancelled = submission();
	await withPending(({ cancel }) => cancel())(cancelled.input);
	assert.equal(cancelled.cancelled, true);
	assert.equal(cancelled.attributes.has('aria-busy'), false);
});

test('pending state spans the response handler and clears even when applying it fails', async () => {
	const state = submission();
	let called = false;
	const finish = await withPending(() => async () => {
		called = true;
		assert.equal(state.attributes.get('aria-busy'), 'true');
		throw new Error('render failed');
	})(state.input);
	assert.equal(state.attributes.get('aria-busy'), 'true');
	await assert.rejects(finish({ result: { type: 'success' } }), /render failed/);
	assert.equal(called, true);
	assert.equal(state.attributes.has('aria-busy'), false);
});

test('expired authentication preserves the draft by skipping response application', async () => {
	const state = submission();
	let notified = false;
	const finish = await withPending(
		() => () => assert.fail('must preserve form'),
		() => {
			notified = true;
		}
	)(state.input);
	await finish({
		result: { type: 'failure', status: 401 },
		update: () => assert.fail('must not reset')
	});
	assert.equal(notified, true);
	assert.equal(state.attributes.has('aria-busy'), false);
});

test('an expired session releases the unsaved-changes saving flag', async () => {
	globalThis.__authNotices = 0;
	const guard = new UnsavedChanges();
	guard.dirty = true;
	const state = submission();
	// The page's own check runs first and lets the submission proceed.
	const finish = await guard.enhanceAfter(() => {})(state.input);
	assert.equal(guard.saving, true, 'a save is in flight once the check passes');
	await finish({
		result: { type: 'failure', status: 401 },
		update: () => assert.fail('must not reset')
	});
	assert.equal(guard.saving, false, 'a 401 never reaches the save callback, so it must release');
	assert.equal(guard.dirty, true, 'unsaved edits stay protected');
	assert.equal(globalThis.__authNotices, 1, 'the authentication notice still fires');
	assert.equal(state.attributes.has('aria-busy'), false);

	// A refusing check never marks a save in flight.
	const refused = submission();
	await guard.enhanceAfter(({ cancel }) => cancel())(refused.input);
	assert.equal(refused.cancelled, true);
	assert.equal(guard.saving, false);
});
