import test from 'node:test';
import assert from 'node:assert/strict';
import {
	pollInstallationProgress,
	restartingStep,
	uninstallStoppedStep,
	timeoutError
} from '../src/lib/installation-progress.js';

const json = (body, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body
});
const active = (extra = {}) => ({ id: 'op', operation: 'update', status: 'staging', ...extra });

/**
 * Drives the poller with scripted responses. Each script entry answers one request in order:
 * an object response, an Error (network failure), or a function of the path.
 */
async function drive({ initial, passwordLogin, script, maxSteps = 50 }) {
	const requests = [],
		reports = [],
		navigations = [];
	let step = 0,
		clock = 0;
	await pollInstallationProgress({
		initial,
		passwordLogin,
		request: async (path) => {
			requests.push(path);
			const next = script.shift();
			if (next === undefined) throw new Error(`Unscripted request: ${path}`);
			const answer = typeof next === 'function' ? next(path) : next;
			if (answer instanceof Error) throw answer;
			return answer;
		},
		navigate: (url) => navigations.push(url),
		report: (operation) => reports.push(operation),
		wait: async () => {
			clock += 1000;
		},
		now: () => clock,
		cancelled: () => ++step > maxSteps,
		timeoutMs: 20_000
	});
	return { requests, reports, navigations };
}

test('password login: a slow status response during a build never reloads the page', async () => {
	const { navigations, requests, reports } = await drive({
		initial: active(),
		passwordLogin: true,
		script: [
			json({ status: 'ready', server_generation: 'old' }),
			new Error('timeout'),
			json({ status: 'ready', server_generation: 'old' }),
			json(active({ step: 'Building' })),
			json(active({ status: 'complete', step: 'Done' }))
		]
	});
	assert.deepEqual(navigations, [], 'complete without url stays on the page');
	assert.deepEqual(requests, [
		'/health',
		'/settings/installation',
		'/health',
		'/settings/installation',
		'/settings/installation'
	]);
	assert.ok(!reports.some((r) => r.step === restartingStep));
	assert.equal(reports.at(-1).status, 'complete');
});

test('password login: reloads only when a new server generation answers after the UI stops', async () => {
	const { navigations, reports } = await drive({
		initial: active(),
		passwordLogin: true,
		script: [
			json({ status: 'ready', server_generation: 'old' }),
			new Error('stopped'),
			new Error('no health'),
			new Error('still down'),
			json({ status: 'unavailable' }, 503),
			json({ status: 'ready', server_generation: 'new' })
		]
	});
	assert.equal(reports.at(-1).step, restartingStep);
	assert.deepEqual(navigations, ['/settings#updates']);
});

test('password login: an expired session reloads to sign in instead of assuming a restart', async () => {
	const { navigations, reports } = await drive({
		initial: active(),
		passwordLogin: true,
		script: [
			json({ status: 'ready', server_generation: 'old' }),
			json({ auth_required: true }, 401)
		]
	});
	assert.deepEqual(navigations, ['/settings#updates']);
	assert.ok(!reports.some((r) => r.step === restartingStep));
});

test('password login: uninstall stops polling with a final message once the UI stops', async () => {
	const { navigations, reports, requests } = await drive({
		initial: active({ operation: 'uninstall', status: 'removing' }),
		passwordLogin: true,
		script: [
			json({ status: 'ready', server_generation: 'old' }),
			new Error('stopped'),
			new Error('no health')
		]
	});
	assert.equal(reports.at(-1).step, uninstallStoppedStep);
	assert.deepEqual(navigations, []);
	assert.equal(requests.length, 3, 'no further polling after uninstall stops the UI');
});

test('gateway polling reloads from the restarted server after completion or a failure', async () => {
	for (const settled of [
		{ status: 'complete', url: 'http://127.0.0.1:4100' },
		{ status: 'failed', error: 'Stopped waiting', url: 'http://127.0.0.1:4100' }
	]) {
		const { navigations, requests } = await drive({
			initial: active({ poll_url: 'http://127.0.0.1:9/status?id=op' }),
			passwordLogin: false,
			script: [new Error('gateway starting'), json(active({ ...settled }))]
		});
		assert.deepEqual(requests, [
			'http://127.0.0.1:9/status?id=op',
			'http://127.0.0.1:9/status?id=op'
		]);
		assert.deepEqual(navigations, ['http://127.0.0.1:4100/settings#updates']);
	}
	const failedBeforeStop = await drive({
		initial: active(),
		passwordLogin: false,
		script: [json(active({ status: 'failed', error: 'Build failed' }))]
	});
	assert.deepEqual(failedBeforeStop.navigations, [], 'no restart, no reload');
});

test('progress reports a timeout without repeating the operation', async () => {
	const script = Array.from({ length: 40 }, () => json(active()));
	const { reports, navigations } = await drive({
		initial: active(),
		passwordLogin: false,
		script
	});
	assert.equal(reports.at(-1).error, timeoutError);
	assert.deepEqual(navigations, []);
});
