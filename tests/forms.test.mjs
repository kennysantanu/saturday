import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the real submission wrapper without a browser or SvelteKit server.
const bundled = await build({
	entryPoints: ['src/lib/forms.ts'],
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
				builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
					contents:
						path === 'svelte'
							? 'export const tick = async () => {};'
							: 'export const authenticationRequired = () => {};'
				}));
			}
		}
	]
});
const { withPending } = await import(
	`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
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
