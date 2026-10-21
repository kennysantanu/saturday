import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import { migrateDatabase } from '../src/lib/server/database.js';
import { createJob, getJob } from '../src/lib/server/services.js';
import { listWorkflowStages } from '../src/lib/server/workflow.js';
import { jobReturn } from '../src/lib/job-navigation.js';
import {
	createNetwork,
	linkJobNetwork,
	getNetwork,
	listNetworkUpdates,
	listNetworks
} from '../src/lib/server/networks.js';

test('production stage/history actions, result round trips and read-only overview', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-workflow-web-'));
	process.env.SATURDAY_DB_PATH = join(root, 'career.sqlite');
	process.env.SATURDAY_FILES_PATH = join(root, 'files');
	process.env.SATURDAY_INSTALLATION_PATH = '';
	process.env.SATURDAY_EXTENSION_STATE_PATH = join(root, 'extensions');
	process.env.SATURDAY_EXTENSIONS_PATH = join(root, 'extension-code');
	migrateDatabase();
	const job = createJob({ job_title: 'Workflow QA', company_name: 'Example' });
	const stages = listWorkflowStages(),
		interview = stages.find((s) => s.name === 'Interview'),
		closed = stages.find((s) => s.name === 'Rejected');
	const socket = createServer();
	await new Promise((r) => socket.listen(0, '127.0.0.1', r));
	const port = socket.address().port;
	await new Promise((r) => socket.close(r));
	const base = `http://127.0.0.1:${port}`;
	const child = spawn(process.execPath, ['scripts/start.mjs'], {
		cwd: resolve('.'),
		env: { ...process.env, PORT: String(port) },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let logs = '';
	child.stdout.on('data', (c) => (logs += c));
	child.stderr.on('data', (c) => (logs += c));
	let browser;
	try {
		let ready = false;
		for (let i = 0; i < 150; i++) {
			try {
				if ((await fetch(base + '/jobs')).ok) {
					ready = true;
					break;
				}
			} catch {}
			await new Promise((r) => setTimeout(r, 100));
		}
		assert(ready, logs);
		const returnTo = '/jobs?query=Workflow&current_stage=' + job.currentStageId;
		const detail = `/jobs/${job.id}?return_to=${encodeURIComponent(returnTo)}`;
		const formUrl = (action) =>
			`/jobs/${job.id}?/${action}&return_to=${encodeURIComponent(returnTo)}`;
		const post = (path, values) =>
			fetch(base + formUrl(path), {
				method: 'POST',
				headers: {
					origin: base,
					accept: 'text/html',
					'content-type': 'application/x-www-form-urlencoded'
				},
				body: new URLSearchParams(values),
				redirect: 'manual'
			});
		const html = await (await fetch(base + detail)).text();
		assert(html.includes('Change stage'));
		assert(html.includes('Add history'));
		assert(!html.includes('Dismiss job'));
		assert(!html.includes('Reopen job'));
		assert(!html.includes(`/jobs/${job.id}/change-stage?`));
		assert(!html.includes(`/jobs/${job.id}/history/new?`));
		for (const path of ['change-stage', 'history/new', 'history/1/edit'])
			assert.equal((await fetch(base + `/jobs/${job.id}/${path}`)).status, 404);
		const history = await post('addHistory', {
			stage_id: String(interview.id),
			event_date: '2099-01-01',
			note: 'Scheduled'
		});
		assert.equal(history.status, 303);
		assert.equal(getJob(job.id).currentStageId, job.currentStageId);
		const moved = await post('changeStage', {
			stage_id: String(closed.id),
			event_date: '2020-01-01',
			note: 'Closed'
		});
		assert.equal(moved.status, 303);
		assert.equal(getJob(job.id).currentStageId, closed.id);
		assert.equal(
			new URL(moved.headers.get('location'), base).searchParams.get('return_to'),
			returnTo
		);
		const outside = await (await fetch(base + moved.headers.get('location'))).text();
		assert(outside.includes('outside the original results'));
		const matching = await (await fetch(base + '/jobs?view=all&current_stage=' + closed.id)).text();
		assert(matching.includes('Workflow QA'));
		assert(matching.includes('Search jobs'));
		assert(!matching.includes('layout=board'));
		const invalid = await post('changeStage', {
			stage_id: '999999',
			event_date: '2020-01-01',
			note: 'Keep draft'
		});
		assert.equal(invalid.status, 400);
		assert((await invalid.text()).includes('Keep draft'));
		assert.equal(getJob(job.id).currentStageId, closed.id);
		const scheduledEntry = getJob(job.id).updates.find((entry) => entry.note === 'Scheduled');
		const editPost = (entryId, action, values) =>
			post(action === 'delete' ? 'deleteHistory' : 'editHistory', {
				...values,
				update_id: entryId
			});
		const corrected = await editPost(scheduledEntry.id, 'save', {
			stage_id: interview.id,
			event_date: '2099-01-01',
			note: 'Corrected scheduled'
		});
		assert.equal(corrected.status, 303);
		assert.equal(getJob(job.id).currentStageId, closed.id);
		assert.equal(
			getJob(job.id).updates.find((e) => e.id === scheduledEntry.id).note,
			'Corrected scheduled'
		);
		const currentEntry = getJob(job.id).updates.find((entry) => entry.stageId === closed.id);
		const blocked = await editPost(currentEntry.id, 'delete', {
			stage_id: interview.id,
			event_date: '2020-01-01',
			note: 'Keep delete draft'
		});
		assert.equal(blocked.status, 400);
		const blockedHtml = await blocked.text();
		assert(blockedHtml.includes('milestone supports the current stage'));
		assert(blockedHtml.includes('Keep delete draft'));
		assert.equal(getJob(job.id).updates.find((e) => e.id === currentEntry.id).note, 'Closed');
		const other = createJob({ job_title: 'Other owner', company_name: 'Example' });
		const otherEntry = other.updates[0];
		// A posted job ID cannot redirect a correction away from its route owner.
		assert.equal(
			(
				await editPost(scheduledEntry.id, 'save', {
					job_id: other.id,
					stage_id: interview.id,
					event_date: '2099-01-01',
					note: 'Scoped correction'
				})
			).status,
			303
		);
		assert.equal(getJob(other.id).updates[0].note, null);
		assert.equal((await editPost(otherEntry.id, 'delete', {})).status, 400);
		assert.equal(getJob(other.id).updates.length, 1);
		assert.equal((await post('editHistory', { update_id: 'invalid' })).status, 400);
		// Move the fixture out of New so the existing Settings retirement checks remain valid.
		const { moveJobStage } = await import('../src/lib/server/services.js');
		moveJobStage(other.id, { stage_id: closed.id, event_date: '2020-01-01' });
		assert.equal((await editPost(scheduledEntry.id, 'delete', {})).status, 303);
		assert(!getJob(job.id).updates.some((entry) => entry.id === scheduledEntry.id));
		const sameCount = getJob(job.id).updates.length;
		assert.equal(
			(await post('changeStage', { stage_id: closed.id, event_date: '2020-01-01' })).status,
			303
		);
		assert.equal(getJob(job.id).updates.length, sameCount);
		for (const input of [
			'https://evil.test',
			'//evil.test',
			'/settings',
			'/jobs/1',
			'/\\evil.test'
		])
			assert.equal(jobReturn(input), '/jobs');
		const settingsPost = (values) =>
			fetch(base + '/settings?/workflow', {
				method: 'POST',
				headers: {
					origin: base,
					accept: 'text/html',
					'content-type': 'application/x-www-form-urlencoded'
				},
				body: new URLSearchParams(values)
			});
		const settingHtml = await (await fetch(base + '/settings#workflow')).text();
		assert.equal((settingHtml.match(/id="workflow"/g) || []).length, 1);
		assert.equal((await settingsPost({ kind: 'add', name: 'Conversation' })).status, 200);
		const custom = listWorkflowStages().find((s) => s.name === 'Conversation');
		assert.equal(
			(await settingsPost({ kind: 'rename', stage_id: custom.id, name: 'Referral' })).status,
			200
		);
		assert.equal(
			(await settingsPost({ kind: 'closure', stage_id: custom.id, is_closed: '1' })).status,
			200
		);
		assert.equal(listWorkflowStages().find((s) => s.id === custom.id).is_closed, true);
		assert.equal((await settingsPost({ kind: 'archive', stage_id: custom.id })).status, 200);
		assert.equal((await settingsPost({ kind: 'restore', stage_id: custom.id })).status, 200);
		const applied = listWorkflowStages().find((s) => s.name === 'Applied');
		const needsConfirm = await settingsPost({
			kind: 'reorder',
			stage_id: applied.id,
			direction: 'up'
		});
		assert.equal(needsConfirm.status, 400);
		assert((await needsConfirm.text()).includes('workflow-confirm'));
		assert.equal(listWorkflowStages().find((s) => s.is_starting).id, job.currentStageId);
		assert.equal(
			(
				await settingsPost({
					kind: 'reorder',
					stage_id: applied.id,
					direction: 'up',
					confirm_starting_stage: '1'
				})
			).status,
			200
		);
		assert.equal(
			createJob({ job_title: 'New starting stage', company_name: 'Test' }).currentStageId,
			applied.id
		);
		assert.equal(getJob(job.id).currentStageId, closed.id);
		assert.equal(
			(await settingsPost({ kind: 'closure', stage_id: job.currentStageId, is_closed: '1' }))
				.status,
			400
		);
		assert.equal((await settingsPost({ kind: 'archive', stage_id: closed.id })).status, 400);
		assert.equal(
			(await settingsPost({ kind: 'archive', stage_id: job.currentStageId })).status,
			200
		);
		assert.equal((await settingsPost({ kind: 'add', name: 'New' })).status, 200);
		assert.equal(
			(await settingsPost({ kind: 'restore', stage_id: job.currentStageId })).status,
			400
		);
		assert.equal(
			(await settingsPost({ kind: 'rename', stage_id: job.currentStageId, name: 'Old new' }))
				.status,
			200
		);
		assert.equal(
			(await settingsPost({ kind: 'restore', stage_id: job.currentStageId })).status,
			200
		);
		if (!existsSync(await puppeteer.executablePath())) {
			t.diagnostic('Managed Chrome unavailable; native HTTP checks passed.');
			return;
		}
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.setViewport({ width: 1280, height: 960 });
		await page.goto(base + detail, { waitUntil: 'networkidle0' });
		const button = (text) => page.click(`button::-p-text(${text})`);
		const settle = () => page.waitForNetworkIdle({ idleTime: 300 });
		const saveDialog = async () => {
			await page.click('#job-update-form button[type="submit"]:not([formaction])');
			await page.waitForSelector('[data-slot="dialog-content"]', { hidden: true });
			await settle();
			await settle();
			assert.equal(new URL(page.url()).pathname, `/jobs/${job.id}`);
			assert.equal(new URL(page.url()).searchParams.get('return_to'), returnTo);
		};
		await button('Change stage');
		await page.waitForSelector('#move-stage');
		assert.equal(new URL(page.url()).pathname, `/jobs/${job.id}`);
		assert.equal(
			await page.$eval('[data-slot="dialog-title"]', (el) => el.textContent.trim()),
			'Change stage'
		);
		await page.screenshot({
			path: '/tmp/saturday-change-stage-dialog-desktop.png',
			fullPage: true
		});
		await page.select('#move-stage', String(interview.id));
		await page.type('#move-note', 'Browser stage note');
		await saveDialog();
		assert.equal(getJob(job.id).currentStageId, interview.id);
		await button('Add history');
		await page.waitForSelector('#history-note');
		assert(await page.$eval('#history-date', (el) => !!el.value));
		await page.type('#history-note', 'Browser history only');
		await saveDialog();
		assert.equal(getJob(job.id).currentStageId, interview.id);
		const browserEntry = getJob(job.id).updates.find(
			(entry) => entry.note === 'Browser history only'
		);
		await page.click('button[aria-label^="Edit history: General note"]');
		await page.waitForSelector('#correction-note');
		assert.equal(await page.$eval('#correction-note', (el) => el.value), 'Browser history only');
		await page.locator('#correction-note').fill('Corrected in browser');
		await saveDialog();
		assert.equal(
			getJob(job.id).updates.find((entry) => entry.id === browserEntry.id).note,
			'Corrected in browser'
		);
		await page.click('button[aria-label^="Edit history: General note"]');
		await page.waitForSelector('#correction-note');
		await page.locator('#correction-note').fill('Unsaved draft');
		await page.click('#job-update-form button[data-variant="ghost"]');
		await page.waitForSelector('button::-p-text(Keep editing)');
		await button('Keep editing');
		await page.waitForSelector('button::-p-text(Keep editing)', { hidden: true });
		assert.equal(await page.$eval('#correction-note', (el) => el.value), 'Unsaved draft');
		// Escape also protects the draft, and Discard closes the editor.
		await page.keyboard.press('Escape');
		await page.waitForSelector('button::-p-text(Discard changes)');
		await button('Discard changes');
		await page.waitForSelector('[data-slot="dialog-content"]', { hidden: true });
		await settle();
		await settle();
		await page.click('button[aria-label^="Edit history: General note"]');
		await settle();
		await page.waitForSelector('#correction-note');
		await page.setViewport({ width: 320, height: 900 });
		await settle();
		assert(await page.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
		assert(
			await page.$eval('[data-slot="dialog-content"]', (el) => {
				const r = el.getBoundingClientRect();
				return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
			})
		);
		assert(
			await page.$eval('#job-update-form button[type="submit"]:not([formaction])', (el) => {
				const r = el.getBoundingClientRect();
				return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
			})
		);
		const stackedActions = () =>
			page.$eval('#job-update-form [data-slot="dialog-footer"]', (el) => {
				const buttons = [...el.querySelectorAll('button')];
				const rects = buttons.map((button) => button.getBoundingClientRect());
				return (
					buttons.length === 3 &&
					rects.every(
						(r, i) =>
							Math.abs(r.left - rects[0].left) < 1 &&
							Math.abs(r.width - rects[0].width) < 1 &&
							r.left >= 0 &&
							r.right <= innerWidth &&
							r.height >= 44 &&
							(i === 0 || r.bottom <= rects[i - 1].top)
					)
				);
			});
		assert(await stackedActions());
		for (const width of [640, 767]) {
			await page.setViewport({ width, height: 960 });
			await settle();
			assert(await stackedActions(), `Footer should stack at ${width}px`);
		}
		await page.setViewport({ width: 768, height: 960 });
		await settle();
		assert(
			await page.$eval('#job-update-form [data-slot="dialog-footer"]', (el) => {
				const buttons = [...el.querySelectorAll('button')];
				return buttons.every(
					(button) =>
						Math.abs(button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top) <
						1
				);
			})
		);
		await page.setViewport({ width: 320, height: 900 });
		await settle();
		await page.screenshot({ path: '/tmp/saturday-edit-history-dialog-phone.png' });
		await page.click('#job-update-form button[data-variant="destructive"]');
		await page.waitForSelector('button[form="job-update-form"]');
		await page.click('button[form="job-update-form"]');
		await page.waitForSelector('[data-slot="dialog-content"]', { hidden: true });
		await settle();
		await settle();
		assert(!getJob(job.id).updates.some((entry) => entry.id === browserEntry.id));
		assert.equal(getJob(job.id).currentStageId, interview.id);
		await button('Schedule follow-up');
		await page.waitForSelector('#follow_up_date');
		await page.locator('#follow_up_date').fill('2099-01-01');
		await page.type('#follow_up_comment', 'Phone follow-up');
		await saveDialog();
		assert.equal(getJob(job.id).followUpComment, 'Phone follow-up');
		assert.equal(await page.$('button::-p-text(Clear follow-up)'), null);
		await button('Reschedule or edit');
		await page.waitForSelector('#follow_up_comment');
		await settle();
		assert(await stackedActions());
		await page.screenshot({ path: '/tmp/saturday-follow-up-actions-phone.png' });
		assert.equal(await page.$eval('#follow_up_comment', (el) => el.value), 'Phone follow-up');
		const historyCount = getJob(job.id).updates.length;
		// Clearing ignores invalid draft values and retains the original return context.
		await page.locator('#follow_up_comment').fill('Unsaved comment to discard');
		await page.locator('#follow_up_date').fill('');
		await page.click('#job-update-form button[formaction*="clearFollowUp"]');
		await page.waitForSelector('[data-slot="dialog-content"]', { hidden: true });
		await settle();
		assert.equal(getJob(job.id).followUpDate, null);
		assert.equal(getJob(job.id).followUpComment, null);
		assert.equal(getJob(job.id).updates.length, historyCount);
		assert.equal(new URL(page.url()).searchParams.get('return_to'), returnTo);
		assert.equal(await page.$('button::-p-text(Clear follow-up)'), null);
		await page.setViewport({ width: 1280, height: 960 });
		// Invalid correction fields do not prevent deletion reaching the server safeguard.
		await page.click('button[aria-label^="Edit history: Interview"]');
		await page.waitForSelector('#correction-note');
		await page.select('#correction-stage', '');
		await page.locator('#correction-date').fill('');
		await page.locator('#correction-note').fill('Protected draft stays here');
		await page.click('#job-update-form button[data-variant="destructive"]');
		await page.waitForSelector('button[form="job-update-form"]');
		await page.click('button[form="job-update-form"]');
		await page.waitForSelector('#job-update-form [role="alert"]');
		await page.waitForSelector('button[form="job-update-form"]', { hidden: true });
		await page.waitForSelector('#job-update-form:not([aria-busy="true"])');
		await settle();
		assert.equal(
			await page.$eval('#correction-note', (el) => el.value),
			'Protected draft stays here'
		);
		assert.equal(await page.$eval('#correction-date', (el) => el.value), '');
		assert(
			(await page.$eval('#job-update-form [role="alert"]', (el) => el.textContent)).includes(
				'Change stage first'
			)
		);
		await page.click('#job-update-form button[data-variant="ghost"]');
		await page.waitForSelector('button::-p-text(Discard changes)');
		await button('Discard changes');
		await page.waitForSelector('[data-slot="dialog-content"]', { hidden: true });
		await settle();
		// A server validation failure keeps all fields inside the Add history dialog.
		await button('Add history');
		await page.waitForSelector('#history-note');
		await page.type('#history-note', 'Failed save draft');
		await page.locator('#history-date').fill('');
		await page.$eval('#job-update-form', (el) => (el.noValidate = true));
		await page.click('#job-update-form button[type="submit"]:not([formaction])');
		await page.waitForSelector('#history-date[aria-invalid="true"]');
		await settle();
		assert.equal(await page.$eval('#history-note', (el) => el.value), 'Failed save draft');
		assert.equal(await page.$eval(':focus', (el) => el.id), 'history-date');
		await page.locator('#history-date').fill('2020-01-01');
		await saveDialog();
		assert(getJob(job.id).updates.some((entry) => entry.note === 'Failed save draft'));
		await button('Add history');
		await page.waitForSelector('#history-note');
		await page.type('#history-note', 'Keep my short note');
		await page.click('[data-slot="dialog-close"]');
		await page.waitForSelector('button::-p-text(Keep editing)');
		await button('Keep editing');
		await page.waitForSelector('button::-p-text(Keep editing)', { hidden: true });
		await settle();
		assert.equal(await page.$eval('#history-note', (el) => el.value), 'Keep my short note');
		await page.mouse.click(1, 1);
		await page.waitForSelector('button::-p-text(Keep editing)');
		await button('Keep editing');
		await page.waitForSelector('button::-p-text(Keep editing)', { hidden: true });
		await settle();
		// Expired sign-in leaves the dialog and draft intact, and resets save progress.
		await page.setRequestInterception(true);
		const intercept = (request) => {
			if (request.method() === 'POST' && request.url().includes('/addHistory')) {
				void request.respond({
					status: 401,
					contentType: 'application/json',
					headers: { 'x-saturday-auth': 'required' },
					body: JSON.stringify({ type: 'failure', status: 401, auth_required: true })
				});
			} else void request.continue();
		};
		page.on('request', intercept);
		await page.click('#job-update-form button[type="submit"]:not([formaction])');
		await page.waitForFunction(() => document.body.innerText.includes('Session expired'));
		await page.waitForSelector('#job-update-form:not([aria-busy="true"])');
		assert.equal(await page.$eval('#history-note', (el) => el.value), 'Keep my short note');
		page.off('request', intercept);
		await page.setRequestInterception(false);
		await saveDialog();
		assert(getJob(job.id).updates.some((entry) => entry.note === 'Keep my short note'));
		// Star keeps both filtered-list and Dashboard return context, including native forms.
		const dashboardReturn = `/?pipeline_stage=${interview.id}#pipeline-stage-${interview.id}`;
		for (const origin of [returnTo, dashboardReturn]) {
			await page.goto(base + `/jobs/${job.id}?return_to=${encodeURIComponent(origin)}`, {
				waitUntil: 'networkidle0'
			});
			const starred = !getJob(job.id).isStarred;
			await page.click('form[action^="?/star"] button');
			await page.waitForFunction(
				(value) =>
					document.querySelector('form[action^="?/star"] button')?.getAttribute('aria-pressed') ===
					String(value),
				{},
				starred
			);
			await settle();
			assert.equal(new URL(page.url()).searchParams.get('return_to'), origin);
			assert.equal(getJob(job.id).isStarred, starred);
		}
		const native = await browser.newPage();
		await native.setJavaScriptEnabled(false);
		await native.goto(base + `/jobs/${job.id}?return_to=${encodeURIComponent(dashboardReturn)}`);
		await Promise.all([native.waitForNavigation(), native.click('form[action^="?/star"] button')]);
		assert.equal(new URL(native.url()).searchParams.get('return_to'), dashboardReturn);
		await native.close();

		const person = createNetwork({ name: 'Draft protection contact' });
		linkJobNetwork({ job_id: job.id, network_id: person.id, notes: 'Saved relationship' });
		const keepDraft = async (field, expected, dismiss) => {
			await dismiss();
			await page.waitForSelector('button::-p-text(Keep editing)');
			await button('Keep editing');
			await page.waitForSelector('button::-p-text(Keep editing)', { hidden: true });
			await settle();
			assert.equal(await page.$eval(field, (el) => el.value), expected);
		};
		const discardDraft = async (formId) => {
			await page.click(`#${formId} button[data-variant="ghost"]`);
			await page.waitForSelector('button::-p-text(Discard changes)');
			await button('Discard changes');
			await page.waitForSelector('[data-slot="dialog-content"]', { hidden: true });
			await settle();
		};
		await page.goto(base + `/networks/${person.id}`, { waitUntil: 'networkidle0' });
		await button('Add interaction');
		await page.waitForSelector('#interaction_note');
		await page.type('#interaction_note', 'Unsaved interaction');
		await keepDraft('#interaction_note', 'Unsaved interaction', () =>
			page.keyboard.press('Escape')
		);
		await discardDraft('network-interaction');
		assert.equal(listNetworkUpdates({ network_id: person.id }).updates.length, 0);
		await button('Add interaction');
		await page.waitForSelector('#interaction_note');
		assert.equal(await page.$eval('#interaction_note', (el) => el.value), '');
		await page.type('#interaction_note', 'Interaction validation draft');
		await page.locator('#interaction_date').fill('2099-01-01');
		await page.$eval('#network-interaction', (el) => (el.noValidate = true));
		await page.click('#network-interaction button[type="submit"]');
		await page.waitForSelector('#interaction_date[aria-invalid="true"]');
		await settle();
		assert.equal(
			await page.$eval('#interaction_note', (el) => el.value),
			'Interaction validation draft'
		);
		await page.locator('#interaction_date').fill('2020-01-01');
		await page.click('#network-interaction button[type="submit"]');
		await page.waitForSelector('[data-slot="dialog-content"]', { hidden: true });
		await settle();
		assert.equal(
			listNetworkUpdates({ network_id: person.id }).updates[0].note,
			'Interaction validation draft'
		);
		await button('Schedule follow-up');
		await page.waitForSelector('#follow_up_comment');
		await page.locator('#follow_up_date').fill('2099-01-01');
		await page.type('#follow_up_comment', 'Unsaved follow-up');
		await keepDraft('#follow_up_comment', 'Unsaved follow-up', () =>
			page.click('[data-slot="dialog-close"]')
		);
		await page.click('#network-follow-up button[type="submit"]');
		await page.waitForSelector('[data-slot="dialog-content"]', { hidden: true });
		await settle();
		assert.equal(getNetwork(person.id).follow_up_comment, 'Unsaved follow-up');
		await button('Edit link note');
		await page.waitForSelector('#relationship_notes');
		await page.locator('#relationship_notes').fill('Unsaved Network link note');
		await keepDraft('#relationship_notes', 'Unsaved Network link note', () =>
			page.mouse.click(1, 1)
		);
		await discardDraft('network-link-note');
		assert.equal(listNetworks({ job_id: job.id }).networks[0].job_link.notes, 'Saved relationship');

		await page.goto(base + detail, { waitUntil: 'networkidle0' });
		await button('Edit link note');
		await page.waitForSelector('#network_relationship_note');
		await page.locator('#network_relationship_note').fill('Unsaved Job link note');
		await keepDraft('#network_relationship_note', 'Unsaved Job link note', () =>
			page.click('#job-link-note button[data-variant="ghost"]')
		);
		await page.click('#job-link-note button[type="submit"]');
		await page.waitForSelector('[data-slot="dialog-content"]', { hidden: true });
		await settle();
		assert.equal(
			listNetworks({ job_id: job.id }).networks[0].job_link.notes,
			'Unsaved Job link note'
		);
		await page.goto(base + '/settings#workflow', { waitUntil: 'networkidle0' });
		await page.click(`#workflow-stage-${custom.id} summary`);
		await page.locator(`#workflow-name-${custom.id}`).fill('Conversation again');
		await page.click(
			`#workflow-stage-${custom.id} form:has(input[value="rename"]) button[type="submit"]`
		);
		await page.waitForFunction(() =>
			document.querySelector('#workflow')?.textContent.includes('Workflow saved')
		);
		assert.equal(listWorkflowStages().find((s) => s.id === custom.id).name, 'Conversation again');
		const screening = listWorkflowStages().find((s) => s.name === 'Screening');
		await page.click(`#workflow-stage-${screening.id} form:has(input[value="up"]) button`);
		await page.waitForSelector('button[form="workflow-confirm"]');
		await page.click('button[form="workflow-confirm"]');
		await page.waitForFunction(
			(id) =>
				document.querySelector('#workflow-stage-' + id)?.textContent.includes('Starting stage'),
			{},
			screening.id
		);
		assert.equal(listWorkflowStages().find((s) => s.is_starting).id, screening.id);
		await page.waitForSelector('[data-slot="dialog-content"]', { hidden: true });
		await page.waitForNetworkIdle({ idleTime: 300 });
		await page.$eval('#workflow-new-name', (el) => (el.closest('details').open = true));
		await page.type('#workflow-new-name', 'Applied');
		await page.click('#workflow form:has(input[value="add"]) button[type="submit"]');
		await page.waitForSelector('#workflow-new-name[aria-invalid="true"]');
		assert.equal(await page.$eval('#workflow-new-name', (el) => el.value), 'Applied');
		await page.locator('#workflow-new-name').fill('Phone screen');
		await page.click('#workflow form:has(input[value="add"]) button[type="submit"]');
		await page.waitForFunction(() =>
			Array.from(document.querySelectorAll('#workflow li')).some((li) =>
				li.textContent.includes('Phone screen')
			)
		);
		await page.evaluate(() => document.querySelector('#workflow').scrollIntoView());
		await new Promise((r) => setTimeout(r, 300));
		await page.screenshot({ path: '/tmp/saturday-workflow-settings-desktop.png' });
		await page.setViewport({ width: 320, height: 900 });
		await page.goto(base + '/settings#workflow', { waitUntil: 'networkidle0' });
		assert(await page.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
		await page.screenshot({ path: '/tmp/saturday-workflow-settings-phone.png' });
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
		await rm(root, { recursive: true, force: true });
	}
});
