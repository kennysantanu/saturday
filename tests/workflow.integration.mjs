import { createReminder, listReminders } from '../src/lib/server/local/reminders.js';
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
import { createJob, getJob, setJobScore, addJobUpdate } from '../src/lib/server/local/jobs.js';
import { createDocument } from '../src/lib/server/files/documents.js';
import {
	listWorkflowStages,
	addWorkflowStage,
	archiveWorkflowStage
} from '../src/lib/server/local/workflow.js';
import { jobReturn } from '../src/lib/job-navigation.js';
import {
	createNetwork,
	linkJobNetwork,
	getNetwork,
	listNetworkUpdates,
	listNetworks
} from '../src/lib/server/local/people.js';
import {
	clickWhenReady,
	waitForCondition,
	waitForDialogClosed,
	waitForPage,
	waitForSelectorGone,
	waitForSelectorReady,
	waitForValue
} from './helpers/wait-for.mjs';

test('interaction dialog validates and closes after saving', async () => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-interaction-web-'));
	process.env.SATURDAY_DB_PATH = join(root, 'career.sqlite');
	process.env.SATURDAY_FILES_PATH = join(root, 'files');
	process.env.SATURDAY_INSTALLATION_PATH = '';
	process.env.SATURDAY_EXTENSION_STATE_PATH = join(root, 'extensions');
	process.env.SATURDAY_EXTENSIONS_PATH = join(root, 'extension-code');
	migrateDatabase();
	const person = createNetwork({ name: 'Interaction validation contact' });
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
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage();
		await page.goto(base + `/networks/${person.id}`, { waitUntil: 'networkidle0' });
		await clickWhenReady(page, 'button::-p-text(Add interaction)', {
			label: 'Add interaction button'
		});
		await waitForSelectorReady(page, '#interaction_note', {
			label: 'interaction note field',
			visible: true
		});
		await clickWhenReady(page, '#network-interaction button[type="submit"]', {
			label: 'interaction submit button'
		});
		await waitForSelectorReady(page, '#interaction_note[aria-invalid="true"]', {
			label: 'interaction note validation error'
		});
		assert.ok(await page.$('[role="dialog"]'));
		await page.type('#interaction_note', 'Met at a conference.');
		await clickWhenReady(page, '#network-interaction button[type="submit"]', {
			label: 'interaction submit button'
		});
		await waitForDialogClosed(page, { label: 'interaction dialog to close after saving' });
		await page.waitForNetworkIdle({ idleTime: 300, timeout: 15000 });
		await waitForValue(
			'saved interaction to render in #person-interactions',
			() => page.$eval('#person-interactions', (el) => el.textContent),
			(text) => /Met at a conference\./.test(text)
		);
		assert.equal(await page.$('[role="dialog"]'), null);
		assert.match(
			await page.$eval('#person-interactions', (el) => el.textContent),
			/Met at a conference\./
		);
		assert.equal(
			listNetworkUpdates({ network_id: person.id }).updates[0].note,
			'Met at a conference.'
		);
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
		await rm(root, { recursive: true, force: true });
	}
});

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
		const { moveJobStage } = await import('../src/lib/server/local/jobs.js');
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
		const button = (text) =>
			clickWhenReady(page, `button::-p-text(${text})`, { label: `button "${text}"` });
		const settle = async () => {
			await page.waitForNetworkIdle({ idleTime: 300, timeout: 15000 });
			await waitForCondition(
				'page animations to finish',
				async () => {
					await page.evaluate(async () => {
						await Promise.all(
							document
								.getAnimations()
								.filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
								.map((a) => a.finished.catch(() => {}))
						);
					});
					return true;
				},
				{ timeoutMs: 15000 }
			);
		};
		const saveDialog = async (label = 'dialog save') => {
			await clickWhenReady(
				page,
				'#job-update-form button[type="submit"]:not([formaction]), #reminder-editor button[type="submit"]:not([formaction])',
				{ label: `${label} submit button` }
			);
			await waitForDialogClosed(page, { label: `${label} dialog to close` });
			await settle();
			await waitForValue(
				`${label} URL to keep job detail and return_to`,
				() => {
					const current = new URL(page.url());
					return { pathname: current.pathname, returnTo: current.searchParams.get('return_to') };
				},
				(seen) => seen.pathname === `/jobs/${job.id}` && seen.returnTo === returnTo
			);
			assert.equal(new URL(page.url()).pathname, `/jobs/${job.id}`);
			assert.equal(new URL(page.url()).searchParams.get('return_to'), returnTo);
			await new Promise((r) => setTimeout(r, 450));
			await waitForSelectorGone(
				page,
				'[role="dialog"], [data-slot="dialog-content"], [aria-invalid="true"]',
				{
					label: `${label} dialog and validation errors to stay gone`,
					timeoutMs: 200,
					intervalMs: 50
				}
			);
		};
		await button('Change stage');
		await waitForSelectorReady(page, '#move-stage', {
			label: 'Change stage select',
			visible: true
		});
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
		await saveDialog('Change stage');
		assert.equal(getJob(job.id).currentStageId, interview.id);
		await button('Add history');
		await waitForSelectorReady(page, '#history-note', {
			label: 'Add history note field',
			visible: true
		});
		assert(await page.$eval('#history-date', (el) => !!el.value));
		await page.type('#history-note', 'Browser history only');
		await saveDialog('Add history');
		assert.equal(getJob(job.id).currentStageId, interview.id);
		const browserEntry = getJob(job.id).updates.find(
			(entry) => entry.note === 'Browser history only'
		);
		await clickWhenReady(page, 'button[aria-label^="Edit history: General note"]', {
			label: 'Edit history: General note button'
		});
		await waitForSelectorReady(page, '#correction-note', {
			label: 'Edit history note field',
			visible: true
		});
		assert.equal(await page.$eval('#correction-note', (el) => el.value), 'Browser history only');
		await page.locator('#correction-note').fill('Corrected in browser');
		await saveDialog('Edit history');
		assert.equal(
			getJob(job.id).updates.find((entry) => entry.id === browserEntry.id).note,
			'Corrected in browser'
		);
		await clickWhenReady(page, 'button[aria-label^="Edit history: General note"]', {
			label: 'Edit history: General note button (draft protection)'
		});
		await waitForSelectorReady(page, '#correction-note', {
			label: 'Edit history note field',
			visible: true
		});
		await page.locator('#correction-note').fill('Unsaved draft');
		await clickWhenReady(page, '#job-update-form button[data-variant="ghost"]', {
			label: 'Edit history cancel button'
		});
		await waitForSelectorReady(page, 'button::-p-text(Keep editing)', {
			label: 'Keep editing button',
			visible: true
		});
		await button('Keep editing');
		await waitForSelectorGone(page, 'button::-p-text(Keep editing)', {
			label: 'Keep editing dialog to close'
		});
		assert.equal(await page.$eval('#correction-note', (el) => el.value), 'Unsaved draft');
		// Escape also protects the draft, and Discard closes the editor.
		await page.keyboard.press('Escape');
		await waitForSelectorReady(page, 'button::-p-text(Discard changes)', {
			label: 'Discard changes button',
			visible: true
		});
		await button('Discard changes');
		await waitForDialogClosed(page, { label: 'Edit history dialog to close after discard' });
		await settle();
		await clickWhenReady(page, 'button[aria-label^="Edit history: General note"]', {
			label: 'Edit history: General note button (responsive checks)'
		});
		await waitForSelectorReady(page, '#correction-note', {
			label: 'Edit history note field',
			visible: true
		});
		await settle();
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
			page.$eval(
				'#job-update-form [data-slot="dialog-footer"], #reminder-editor [data-slot="dialog-footer"]',
				(el) => {
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
				}
			);
		await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
		assert(
			await page.$eval(
				'[data-slot="dialog-content"]',
				(el) => parseFloat(getComputedStyle(el).animationDuration) <= 0.001
			)
		);
		assert(await stackedActions());
		for (const width of [640, 767]) {
			await page.setViewport({ width, height: 960 });
			await settle();
			assert(await stackedActions(), `Footer should stack at ${width}px`);
		}
		await page.setViewport({ width: 768, height: 960 });
		await settle();
		assert(
			await page.$eval(
				'#job-update-form [data-slot="dialog-footer"], #reminder-editor [data-slot="dialog-footer"]',
				(el) => {
					const buttons = [...el.querySelectorAll('button')];
					return buttons.every(
						(button) =>
							Math.abs(
								button.getBoundingClientRect().top - buttons[0].getBoundingClientRect().top
							) < 1
					);
				}
			)
		);
		await page.setViewport({ width: 320, height: 900 });
		await settle();
		await page.screenshot({ path: '/tmp/saturday-edit-history-dialog-phone.png' });
		await clickWhenReady(page, '#job-update-form button[data-variant="destructive"]', {
			label: 'Delete history trigger button'
		});
		await clickWhenReady(page, 'button[form="job-update-form"]', {
			label: 'Confirm delete history button'
		});
		await waitForDialogClosed(page, { label: 'Delete history dialog to close' });
		await settle();
		assert(!getJob(job.id).updates.some((entry) => entry.id === browserEntry.id));
		assert.equal(getJob(job.id).currentStageId, interview.id);
		await button('Add reminder');
		await waitForSelectorReady(page, '#reminder-date', {
			label: 'Add reminder date field',
			visible: true
		});
		await page.locator('#reminder-date').fill('2099-01-01');
		await page.type('#reminder-note', 'Phone follow-up');
		await saveDialog('Add reminder');
		assert.equal(listReminders({ job_id: job.id }).reminders[0].note, 'Phone follow-up');
		assert.equal(await page.$('button::-p-text(Clear follow-up)'), null);
		await button('Edit reminder');
		await waitForSelectorReady(page, '#reminder-note', {
			label: 'Edit reminder note field',
			visible: true
		});
		await settle();
		assert(await stackedActions());
		await page.screenshot({ path: '/tmp/saturday-follow-up-actions-phone.png' });
		assert.equal(await page.$eval('#reminder-note', (el) => el.value), 'Phone follow-up');
		const historyCount = getJob(job.id).updates.length;
		// Confirmed deletion ignores invalid draft values and retains the original return context.
		await page.locator('#reminder-note').fill('Unsaved comment to discard');
		await page.locator('#reminder-date').fill('');
		await clickWhenReady(page, '#reminder-editor button::-p-text(Delete reminder)', {
			label: 'Delete reminder trigger button'
		});
		await clickWhenReady(page, '[role=dialog] button[formaction*="reminderDelete"]', {
			label: 'Confirm delete reminder button'
		});
		await waitForDialogClosed(page, { label: 'Delete reminder dialog to close' });
		await settle();
		assert.equal(getJob(job.id).nextReminder, null);
		assert.equal(getJob(job.id).updates.length, historyCount);
		assert.equal(new URL(page.url()).searchParams.get('return_to'), returnTo);
		assert.equal(await page.$('button::-p-text(Clear follow-up)'), null);
		await page.setViewport({ width: 1280, height: 960 });
		// Invalid correction fields do not prevent deletion reaching the server safeguard.
		await clickWhenReady(page, 'button[aria-label^="Edit history: Interview"]', {
			label: 'Edit history: Interview button'
		});
		await waitForSelectorReady(page, '#correction-note', {
			label: 'Edit history note field',
			visible: true
		});
		await page.select('#correction-stage', '');
		await page.locator('#correction-date').fill('');
		await page.locator('#correction-note').fill('Protected draft stays here');
		await clickWhenReady(page, '#job-update-form button[data-variant="destructive"]', {
			label: 'Delete history trigger button'
		});
		await clickWhenReady(page, 'button[form="job-update-form"]', {
			label: 'Confirm delete history button'
		});
		await waitForSelectorReady(page, '#job-update-form [role="alert"]', {
			label: 'Delete history safeguard alert'
		});
		await waitForSelectorGone(page, 'button[form="job-update-form"]', {
			label: 'Confirm delete history dialog to close'
		});
		await waitForSelectorReady(page, '#job-update-form:not([aria-busy="true"])', {
			label: 'job update form idle after blocked delete'
		});
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
		await clickWhenReady(page, '#job-update-form button[data-variant="ghost"]', {
			label: 'Edit history cancel button'
		});
		await waitForSelectorReady(page, 'button::-p-text(Discard changes)', {
			label: 'Discard changes button',
			visible: true
		});
		await button('Discard changes');
		await waitForDialogClosed(page, {
			label: 'Edit history dialog to close after safeguard discard'
		});
		await settle();
		// A server validation failure keeps all fields inside the Add history dialog.
		await button('Add history');
		await waitForSelectorReady(page, '#history-note', {
			label: 'Add history note field',
			visible: true
		});
		await page.type('#history-note', 'Failed save draft');
		await page.locator('#history-date').fill('');
		await page.$eval('#job-update-form', (el) => (el.noValidate = true));
		await clickWhenReady(
			page,
			'#job-update-form button[type="submit"]:not([formaction]), #reminder-editor button[type="submit"]:not([formaction])',
			{ label: 'Add history submit button (validation check)' }
		);
		await waitForSelectorReady(page, '#history-date[aria-invalid="true"]', {
			label: 'history date validation error'
		});
		await settle();
		assert.equal(await page.$eval('#history-note', (el) => el.value), 'Failed save draft');
		assert.equal(await page.$eval(':focus', (el) => el.id), 'history-date');
		await page.locator('#history-date').fill('2020-01-01');
		await saveDialog('Add history after validation fix');
		assert(getJob(job.id).updates.some((entry) => entry.note === 'Failed save draft'));
		await button('Add history');
		await waitForSelectorReady(page, '#history-note', {
			label: 'Add history note field',
			visible: true
		});
		await page.type('#history-note', 'Keep my short note');
		await clickWhenReady(page, '[data-slot="dialog-close"]', { label: 'dialog close button' });
		await waitForSelectorReady(page, 'button::-p-text(Keep editing)', {
			label: 'Keep editing button',
			visible: true
		});
		await button('Keep editing');
		await waitForSelectorGone(page, 'button::-p-text(Keep editing)', {
			label: 'Keep editing dialog to close'
		});
		await settle();
		assert.equal(await page.$eval('#history-note', (el) => el.value), 'Keep my short note');
		await page.mouse.click(1, 1);
		await waitForSelectorReady(page, 'button::-p-text(Keep editing)', {
			label: 'Keep editing button after outside click',
			visible: true
		});
		await button('Keep editing');
		await waitForSelectorGone(page, 'button::-p-text(Keep editing)', {
			label: 'Keep editing dialog to close after outside click'
		});
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
		await clickWhenReady(
			page,
			'#job-update-form button[type="submit"]:not([formaction]), #reminder-editor button[type="submit"]:not([formaction])',
			{ label: 'Add history submit button (401 check)' }
		);
		await waitForPage(page, 'Session expired notice', () =>
			document.body.innerText.includes('Session expired')
		);
		await waitForSelectorReady(page, '#job-update-form:not([aria-busy="true"])', {
			label: 'job update form idle after 401'
		});
		assert.equal(await page.$eval('#history-note', (el) => el.value), 'Keep my short note');
		page.off('request', intercept);
		await page.setRequestInterception(false);
		await saveDialog('Add history after 401 retry');
		assert(getJob(job.id).updates.some((entry) => entry.note === 'Keep my short note'));
		// Star keeps both filtered-list and Dashboard return context, including native forms.
		const dashboardReturn = `/#pipeline-stage-${interview.id}`;
		for (const origin of [returnTo, dashboardReturn]) {
			await page.goto(base + `/jobs/${job.id}?return_to=${encodeURIComponent(origin)}`, {
				waitUntil: 'networkidle0'
			});
			const starred = !getJob(job.id).isStarred;
			await clickWhenReady(page, 'form[action^="?/star"] button', { label: 'Star button' });
			await waitForPage(
				page,
				`star button aria-pressed=${starred}`,
				(value) =>
					document.querySelector('form[action^="?/star"] button')?.getAttribute('aria-pressed') ===
					String(value),
				[starred]
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

		const person = createNetwork({ name: 'Draft protection contact', organization: 'Return QA' });
		linkJobNetwork({ job_id: job.id, network_id: person.id, notes: 'Saved relationship' });
		const keepDraft = async (field, expected, dismiss) => {
			await dismiss();
			await waitForSelectorReady(page, 'button::-p-text(Keep editing)', {
				label: 'Keep editing button',
				visible: true
			});
			await button('Keep editing');
			await waitForSelectorGone(page, 'button::-p-text(Keep editing)', {
				label: 'Keep editing dialog to close'
			});
			await settle();
			assert.equal(await page.$eval(field, (el) => el.value), expected);
		};
		const discardDraft = async (formId) => {
			await clickWhenReady(page, `#${formId} button[data-variant="ghost"]`, {
				label: `${formId} cancel button`
			});
			await waitForSelectorReady(page, 'button::-p-text(Discard changes)', {
				label: 'Discard changes button',
				visible: true
			});
			await button('Discard changes');
			await waitForDialogClosed(page, { label: `${formId} dialog to close after discard` });
			await settle();
		};
		await page.goto(base + `/networks/${person.id}`, { waitUntil: 'networkidle0' });
		await button('Add interaction');
		await waitForSelectorReady(page, '#interaction_note', {
			label: 'Add interaction note field',
			visible: true
		});
		await page.type('#interaction_note', 'Unsaved interaction');
		await keepDraft('#interaction_note', 'Unsaved interaction', () =>
			page.keyboard.press('Escape')
		);
		await discardDraft('network-interaction');
		assert.equal(listNetworkUpdates({ network_id: person.id }).updates.length, 0);
		await button('Add interaction');
		await waitForSelectorReady(page, '#interaction_note', {
			label: 'Add interaction note field',
			visible: true
		});
		assert.equal(await page.$eval('#interaction_note', (el) => el.value), '');
		await page.type('#interaction_note', 'Interaction validation draft');
		await page.locator('#interaction_date').fill('2099-01-01');
		await page.$eval('#network-interaction', (el) => (el.noValidate = true));
		await clickWhenReady(page, '#network-interaction button[type="submit"]', {
			label: 'Add interaction submit button (validation check)'
		});
		await waitForSelectorReady(page, '#interaction_date[aria-invalid="true"]', {
			label: 'interaction date validation error'
		});
		await settle();
		assert.equal(
			await page.$eval('#interaction_note', (el) => el.value),
			'Interaction validation draft'
		);
		await page.locator('#interaction_date').fill('2020-01-01');
		await clickWhenReady(page, '#network-interaction button[type="submit"]', {
			label: 'Add interaction submit button'
		});
		await waitForDialogClosed(page, { label: 'Add interaction dialog to close' });
		await settle();
		await waitForValue(
			'saved interaction row in #person-interactions',
			() => page.$eval('#person-interactions', (el) => el.textContent),
			(text) => /Interaction validation draft/.test(text)
		);
		assert.equal(
			listNetworkUpdates({ network_id: person.id }).updates[0].note,
			'Interaction validation draft'
		);
		assert.match(
			await page.$eval('#person-interactions', (el) => el.textContent),
			/Interaction validation draft/
		);
		assert.equal(await page.$('[role="dialog"]'), null);
		await button('Add reminder');
		await waitForSelectorReady(page, '#reminder-note', {
			label: 'Network Add reminder note field',
			visible: true
		});
		await page.locator('#reminder-date').fill('2099-01-01');
		await page.type('#reminder-note', 'Unsaved follow-up');
		await keepDraft('#reminder-note', 'Unsaved follow-up', () =>
			clickWhenReady(page, '[data-slot="dialog-close"]', { label: 'dialog close button' })
		);
		await clickWhenReady(page, '#reminder-editor button[type="submit"]', {
			label: 'Network Add reminder submit button'
		});
		await waitForDialogClosed(page, { label: 'Network Add reminder dialog to close' });
		await settle();
		assert.equal(listReminders({ network_id: person.id }).reminders[0].note, 'Unsaved follow-up');
		// Existing reminder and interaction removal use the same editor pattern as Jobs.
		assert.equal(await page.$('main form[action*="clearFollowUp"]'), null);
		await button('Edit reminder');
		await waitForSelectorReady(page, '#reminder-editor', {
			label: 'Network Edit reminder form',
			visible: true
		});
		await page.locator('#reminder-note').fill('Reminder edit');
		await clickWhenReady(page, '#reminder-editor button[type="submit"]:not([formaction])', {
			label: 'Network Edit reminder submit button'
		});
		await waitForDialogClosed(page, { label: 'Network Edit reminder dialog to close' });
		await settle();
		assert.equal(listReminders({ network_id: person.id }).reminders[0].note, 'Reminder edit');
		await button('Edit reminder');
		await waitForSelectorReady(page, '#reminder-editor', {
			label: 'Network Edit reminder form (delete)',
			visible: true
		});
		await clickWhenReady(page, '#reminder-editor button::-p-text(Delete reminder)', {
			label: 'Network Delete reminder trigger'
		});
		await clickWhenReady(page, '[role=dialog] button[formaction*="reminderDelete"]', {
			label: 'Network Confirm delete reminder button'
		});
		await waitForDialogClosed(page, { label: 'Network Delete reminder dialog to close' });
		await settle();
		assert.equal(getNetwork(person.id).next_reminder_at, null);
		await button('Edit interaction');
		await waitForSelectorReady(page, '#interaction_note', {
			label: 'Edit interaction note field',
			visible: true
		});
		await page.locator('#interaction_note').fill('Keep this interaction draft');
		await page.setViewport({ width: 320, height: 900 });
		await settle();
		assert.equal(
			await page.$eval(
				'#network-interaction [data-slot="dialog-footer"]',
				(el) => getComputedStyle(el).flexDirection
			),
			'column-reverse'
		);
		const actions = await page.$$eval(
			'#network-interaction [data-slot="dialog-footer"] button',
			(buttons) =>
				buttons.map((el) => ({
					x: el.getBoundingClientRect().x,
					width: el.getBoundingClientRect().width,
					y: el.getBoundingClientRect().y
				}))
		);
		assert.equal(actions.length, 3);
		assert(
			actions.every(
				(rect) => Math.abs(rect.x - actions[0].x) < 1 && Math.abs(rect.width - actions[0].width) < 1
			)
		);
		assert.equal(new Set(actions.map((rect) => rect.y)).size, 3);
		await page.screenshot({ path: '/tmp/saturday-network-interaction-phone.png' });
		await clickWhenReady(page, '#network-interaction button[data-variant="destructive"]', {
			label: 'Delete interaction trigger'
		});
		await waitForSelectorReady(page, 'button[form="network-interaction"]', {
			label: 'Confirm delete interaction button',
			visible: true
		});
		await clickWhenReady(
			page,
			'[data-slot="dialog-content"]:has(button[form="network-interaction"]) button[data-variant="ghost"]',
			{ label: 'Cancel delete interaction button' }
		);
		await waitForSelectorGone(page, 'button[form="network-interaction"]', {
			label: 'Confirm delete interaction dialog to close'
		});
		assert.equal(
			await page.$eval('#interaction_note', (el) => el.value),
			'Keep this interaction draft'
		);
		// A failed confirmed delete returns to editing without dropping unsaved fields.
		await page.$eval('#network-interaction input[name="confirm"]', (el) => (el.value = 'false'));
		await clickWhenReady(page, '#network-interaction button[data-variant="destructive"]', {
			label: 'Delete interaction trigger (failed confirm)'
		});
		await clickWhenReady(page, 'button[form="network-interaction"]', {
			label: 'Confirm delete interaction button (failed confirm)'
		});
		await waitForSelectorReady(page, '#network-interaction [role="alert"]', {
			label: 'Delete interaction failure alert'
		});
		await waitForSelectorGone(page, 'button[form="network-interaction"]', {
			label: 'Confirm delete interaction dialog to close after failure'
		});
		assert.equal(
			await page.$eval('#interaction_note', (el) => el.value),
			'Keep this interaction draft'
		);
		assert.equal(listNetworkUpdates({ network_id: person.id }).updates.length, 1);
		await page.$eval('#network-interaction input[name="confirm"]', (el) => (el.value = 'true'));
		await page.setViewport({ width: 1280, height: 900 });
		await settle();
		assert.equal(
			await page.$eval(
				'#network-interaction [data-slot="dialog-footer"]',
				(el) => getComputedStyle(el).flexDirection
			),
			'row'
		);
		await page.screenshot({ path: '/tmp/saturday-network-interaction-desktop.png' });
		await clickWhenReady(page, '#network-interaction button[data-variant="destructive"]', {
			label: 'Delete interaction trigger'
		});
		await clickWhenReady(page, 'button[form="network-interaction"]', {
			label: 'Confirm delete interaction button'
		});
		await waitForDialogClosed(page, { label: 'Delete interaction dialog to close' });
		await settle();
		assert.equal(listNetworkUpdates({ network_id: person.id }).updates.length, 0);
		await button('Edit link note');
		await waitForSelectorReady(page, '#relationship_notes', {
			label: 'Network link note field',
			visible: true
		});
		await page.locator('#relationship_notes').fill('Unsaved Network link note');
		await keepDraft('#relationship_notes', 'Unsaved Network link note', () =>
			page.mouse.click(1, 1)
		);
		await discardDraft('network-link-note');
		assert.equal(listNetworks({ job_id: job.id }).networks[0].job_link.notes, 'Saved relationship');

		await page.goto(base + detail, { waitUntil: 'networkidle0' });
		await button('Edit link note');
		await waitForSelectorReady(page, '#network_relationship_note', {
			label: 'Job link note field',
			visible: true
		});
		await page.locator('#network_relationship_note').fill('Unsaved Job link note');
		await keepDraft('#network_relationship_note', 'Unsaved Job link note', () =>
			clickWhenReady(page, '#job-link-note button[data-variant="ghost"]', {
				label: 'Job link note cancel button'
			})
		);
		await clickWhenReady(page, '#job-link-note button[type="submit"]', {
			label: 'Job link note submit button'
		});
		await waitForDialogClosed(page, { label: 'Job link note dialog to close' });
		await settle();
		assert.equal(
			listNetworks({ job_id: job.id }).networks[0].job_link.notes,
			'Unsaved Job link note'
		);
		// Person detail/edit preserves filtered Network pages and independent detail pages.
		for (let i = 0; i < 50; i++)
			createNetwork({ name: `A navigation ${i}`, organization: 'Return QA' });
		const networkResults = '/networks?organization=Return+QA&page=2';
		await page.goto(base + networkResults, { waitUntil: 'networkidle0' });
		await clickWhenReady(page, `a[href^="/networks/${person.id}?"]`, {
			label: 'person detail link from network results'
		});
		await waitForPage(
			page,
			`navigation to /networks/${person.id}`,
			(id) => location.pathname === `/networks/${id}`,
			[person.id]
		);
		await waitForSelectorReady(page, 'a[href*="/edit?"]', { label: 'person edit link' });
		assert.equal(new URL(page.url()).searchParams.get('return_to'), networkResults);
		const personDetail = new URL(page.url());
		personDetail.searchParams.set('jobs_page', '2');
		personDetail.searchParams.set('updates_page', '3');
		await page.goto(personDetail.href, { waitUntil: 'networkidle0' });
		await clickWhenReady(page, 'a[href*="/edit?"]', { label: 'person edit link' });
		await waitForSelectorReady(page, '#name', { label: 'person edit name field', visible: true });
		const editBack = await page.$eval('a.back-link', (el) => el.getAttribute('href'));
		assert.equal(new URL(editBack, base).searchParams.get('updates_page'), '3');
		await clickWhenReady(page, '.form-actions a', { label: 'person edit cancel link' });
		await waitForSelectorReady(page, 'a[href*="/edit?"]', { label: 'person detail edit link' });
		assert.equal(new URL(page.url()).searchParams.get('jobs_page'), '2');
		await clickWhenReady(page, 'a[href*="/edit?"]', { label: 'person edit link' });
		await waitForSelectorReady(page, '#name', { label: 'person edit name field', visible: true });
		await page.locator('#name').fill('');
		await page.$eval('form:has(#name)', (el) => (el.noValidate = true));
		await clickWhenReady(page, 'button[type="submit"]', { label: 'person edit submit button' });
		await waitForSelectorReady(page, '#name[aria-invalid="true"]', {
			label: 'person name validation error'
		});
		assert.equal(await page.$eval('a.back-link', (el) => el.getAttribute('href')), editBack);
		await page.locator('#name').fill(person.name);
		await clickWhenReady(page, 'button[type="submit"]', { label: 'person edit submit button' });
		await waitForSelectorReady(page, 'a[href*="/edit?"]', {
			label: 'person detail edit link after save'
		});
		assert.equal(new URL(page.url()).searchParams.get('updates_page'), '3');
		assert.equal(await page.$eval('a.back-link', (el) => el.getAttribute('href')), networkResults);
		await clickWhenReady(page, 'a.back-link', { label: 'back to network results link' });
		await waitForPage(page, 'navigation to /networks', () => location.pathname === '/networks');
		await waitForSelectorReady(page, 'a[href^="/networks/' + person.id + '?"]', {
			label: 'person row in network results'
		});
		assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, networkResults);
		// A job-origin person returns to that exact job, including its original results.
		await page.goto(base + detail + '&network_page=2', { waitUntil: 'networkidle0' });
		await clickWhenReady(page, `a[href^="/networks/${person.id}?"]`, {
			label: 'person link from job detail'
		});
		await waitForPage(
			page,
			`navigation to /networks/${person.id} from job`,
			(id) => location.pathname === `/networks/${id}`,
			[person.id]
		);
		await waitForSelectorReady(page, 'a[href*="/edit?"]', { label: 'person edit link' });
		const jobBack = await page.$eval('a.back-link', (el) => el.getAttribute('href'));
		assert.equal(new URL(jobBack, base).pathname, `/jobs/${job.id}`);
		assert.equal(new URL(jobBack, base).searchParams.get('return_to'), returnTo);
		assert.equal(new URL(jobBack, base).searchParams.get('network_page'), '2');
		await clickWhenReady(page, 'a.back-link', { label: 'back to job detail link' });
		await waitForSelectorReady(page, 'button::-p-text(Change stage)', {
			label: 'Change stage button on job detail',
			visible: true
		});
		// A destination retired by another client while editing must preserve the draft.
		addWorkflowStage({ name: 'Retired while editing' });
		const retiring = listWorkflowStages().find((stage) => stage.name === 'Retired while editing');
		await button('Change stage');
		await waitForSelectorReady(page, '#move-stage', {
			label: 'Change stage select',
			visible: true
		});
		await page.select('#move-stage', String(retiring.id));
		await page.type('#move-note', 'Keep this stage-change draft');
		const previousPlacement = getJob(job.id).currentStageId;
		archiveWorkflowStage(retiring.id);
		await clickWhenReady(
			page,
			'#job-update-form button[type="submit"]:not([formaction]), #reminder-editor button[type="submit"]:not([formaction])',
			{ label: 'Change stage submit button (retired destination)' }
		);
		await waitForSelectorReady(page, '#move-stage[aria-invalid="true"]', {
			label: 'retired destination validation error'
		});
		await settle();
		assert.equal(await page.$eval('#move-note', (el) => el.value), 'Keep this stage-change draft');
		assert.equal(await page.$(`#move-stage option[value="${retiring.id}"]`), null);
		assert.equal(getJob(job.id).currentStageId, previousPlacement);
		await discardDraft('job-update-form');
		// Treat a response as uncertain: read authoritative state before retrying the same move.
		const beforeRetry = getJob(job.id).updates.length;
		await post('changeStage', {
			stage_id: closed.id,
			event_date: '2020-01-01',
			note: 'Uncertain response'
		});
		assert.equal(getJob(job.id).currentStageId, closed.id);
		assert.equal(
			(
				await post('changeStage', {
					stage_id: closed.id,
					event_date: '2020-01-01',
					note: 'Uncertain response'
				})
			).status,
			303
		);
		assert.equal(getJob(job.id).updates.length, beforeRetry + 1);
		await page.goto(base + '/settings#workflow', { waitUntil: 'networkidle0' });
		await clickWhenReady(page, `#workflow-stage-${custom.id} a[href*="edit_stage"]`, {
			label: `edit workflow stage ${custom.id} link`
		});
		await waitForSelectorReady(page, `#workflow-name-${custom.id}`, {
			label: `workflow stage ${custom.id} name input`,
			visible: true
		});
		await page.locator(`#workflow-name-${custom.id}`).fill('Conversation again');
		await clickWhenReady(
			page,
			`#workflow-stage-${custom.id} form:has(input[value="rename"]) button[type="submit"]`,
			{ label: `rename workflow stage ${custom.id} button` }
		);
		await waitForPage(page, 'Workflow saved toast', () =>
			Boolean(document.querySelector('.toast')?.textContent.includes('Workflow saved'))
		);
		assert.equal(listWorkflowStages().find((s) => s.id === custom.id).name, 'Conversation again');
		const screening = listWorkflowStages().find((s) => s.name === 'Screening');
		await clickWhenReady(
			page,
			`#workflow-stage-${screening.id} form:has(input[value="up"]) button`,
			{
				label: `move workflow stage ${screening.id} up button`
			}
		);
		await clickWhenReady(page, 'button[form="workflow-confirm"]', {
			label: 'confirm starting stage change button'
		});
		await waitForPage(
			page,
			`workflow stage ${screening.id} row to show Starting stage`,
			(id) =>
				Boolean(
					document.querySelector('#workflow-stage-' + id)?.textContent.includes('Starting stage')
				),
			[screening.id]
		);
		assert.equal(listWorkflowStages().find((s) => s.is_starting).id, screening.id);
		await waitForDialogClosed(page, { label: 'starting stage confirmation dialog to close' });
		await page.waitForNetworkIdle({ idleTime: 300, timeout: 15000 });
		await page.$eval('#workflow-new-name', (el) => (el.closest('details').open = true));
		await waitForSelectorReady(page, '#workflow-new-name', {
			label: 'new workflow stage name input',
			visible: true
		});
		await page.type('#workflow-new-name', 'Applied');
		await clickWhenReady(page, '#workflow form:has(input[value="add"]) button[type="submit"]', {
			label: 'add workflow stage submit button (duplicate check)'
		});
		await waitForSelectorReady(page, '#workflow-new-name[aria-invalid="true"]', {
			label: 'duplicate workflow stage validation error'
		});
		assert.equal(await page.$eval('#workflow-new-name', (el) => el.value), 'Applied');
		await page.locator('#workflow-new-name').fill('Phone screen');
		await clickWhenReady(page, '#workflow form:has(input[value="add"]) button[type="submit"]', {
			label: 'add workflow stage submit button'
		});
		await waitForPage(page, 'Phone screen workflow stage row', () =>
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
		// Compact job detail preserves full content, zero scores and a logical responsive order.
		const layoutJob = createJob({
			job_title: 'A long engineering role title that wraps on a narrow phone',
			company_name: 'Example company',
			location: 'Remote',
			job_description: 'Description content. '.repeat(80) + 'Description end marker'
		});
		createReminder({
			job_id: layoutJob.id,
			scheduled_at: '2020-01-01T00:00',
			note: 'Follow up with the recruiter.'
		});
		for (let i = 0; i < 8; i++)
			addJobUpdate({
				job_id: layoutJob.id,
				event_date: '2020-01-01',
				note: 'History note ' + i + '. ' + 'Long note. '.repeat(40)
			});
		for (let i = 0; i < 4; i++)
			addJobUpdate({ job_id: layoutJob.id, event_date: '2099-01-01', note: 'Scheduled ' + i });
		for (let i = 0; i < 6; i++)
			await createDocument({
				scope: String(layoutJob.id),
				filename: `layout-${i}.md`,
				content: 'Document content'
			});
		await page.goto(base + `/jobs/${layoutJob.id}`, { waitUntil: 'networkidle0' });
		assert.equal(await page.$('.job-score'), null);
		assert.equal(await page.$eval('#job-information', (el) => el.open), false);
		const order = await page.$$eval(
			'#reminders, #job-information, #job-history, #job-documents, #job-network, #job-description',
			(elements) => elements.map((el) => el.id)
		);
		assert.deepEqual(order, [
			'reminders',
			'job-information',
			'job-history',
			'job-documents',
			'job-network',
			'job-description'
		]);
		assert.equal(
			await page.$$eval(
				'#job-documents li',
				(items) => items.filter((el) => el.checkVisibility()).length
			),
			3
		);
		await page.click('#more-job-documents > summary');
		assert.equal(
			await page.$$eval(
				'#job-documents li',
				(items) => items.filter((el) => el.checkVisibility()).length
			),
			6
		);
		await page.click('#more-job-documents > summary');
		assert.equal(await page.$eval('#more-job-history', (el) => el.open), false);
		await page.click('#more-job-history > summary');
		assert.equal(await page.$eval('#more-job-history', (el) => el.open), true);
		await page.click('#more-job-history > summary');
		await page.click('#job-description summary');
		assert(
			await page.$eval(
				'#job-description details',
				(el) => el.open && el.innerText.includes('Description end marker')
			)
		);
		await page.click('#job-description summary');
		setJobScore(layoutJob.id, {
			score: 0,
			score_comment: 'Zero is a valid assessment.\nRead-only assistant notes.'
		});
		await page.reload({ waitUntil: 'networkidle0' });
		await waitForSelectorReady(page, '.job-score', { label: 'job score button', visible: true });
		assert.equal(await page.$eval('.job-score-number', (el) => el.textContent), '0');
		const headerLayout = () =>
			page.evaluate(() => {
				const score = document.querySelector('.job-score').getBoundingClientRect();
				const copy = document.querySelector('.page-title-copy').getBoundingClientRect();
				const meta = document.querySelector('.page-meta').getBoundingClientRect();
				return (
					meta.top >= copy.bottom &&
					Math.abs(meta.left - copy.left) < 1 &&
					document.querySelector('.job-score').parentElement ===
						document.querySelector('.page-meta') &&
					document.querySelector('.page-meta').children[1].classList.contains('job-score') &&
					score.top >= meta.top
				);
			});
		assert(await headerLayout(), 'Metadata orders current stage before the optional score');
		await clickWhenReady(page, '.job-score', { label: 'job score button' });
		await waitForSelectorReady(page, '[data-slot="dialog-content"]', {
			label: 'job score assessment dialog',
			visible: true
		});
		assert(
			(await page.$eval('[data-slot="dialog-content"]', (el) => el.textContent)).includes(
				'Zero is a valid assessment.'
			)
		);
		assert.equal(
			await page.$('[data-slot="dialog-content"] input, [data-slot="dialog-content"] textarea'),
			null
		);
		await page.keyboard.press('Escape');
		await waitForDialogClosed(page, { label: 'job score dialog to close' });
		await settle();
		assert.equal(await page.$eval('.job-score', (el) => document.activeElement === el), true);
		assert(await page.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
		await page.screenshot({ path: '/tmp/saturday-job-detail-phone.png', fullPage: true });
		await page.setViewport({ width: 1280, height: 960 });
		await page.goto(base + `/jobs/${layoutJob.id}`, { waitUntil: 'networkidle0' });
		await waitForPage(page, '#job-information disclosure to open on desktop', () =>
			Boolean(document.querySelector('#job-information')?.open)
		);
		assert(await headerLayout());
		assert.equal(
			await page.$eval('.navigation-item', (el) => getComputedStyle(el).flexDirection),
			'row'
		);
		for (const width of [768, 900, 1024]) {
			await page.setViewport({ width, height: 960 });
			assert.equal(
				await page.$eval('.navigation-item', (el) => getComputedStyle(el).flexDirection),
				'column'
			);
			assert(await page.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
			assert(
				await page.$eval('.desktop-navigation', (el) => {
					const nav = el.getBoundingClientRect();
					const brand = document.querySelector('.topbar-brand').getBoundingClientRect();
					const topbar = document.querySelector('.app-topbar').getBoundingClientRect();
					return nav.left >= brand.right && nav.right <= topbar.right;
				})
			);
		}
		await page.screenshot({ path: '/tmp/saturday-topnav-compact.png' });
		await page.setViewport({ width: 1280, height: 960 });
		assert(
			await page.evaluate(
				() =>
					document.querySelector('#reminders').getBoundingClientRect().right <
					document.querySelector('#job-history').getBoundingClientRect().left
			)
		);
		await page.screenshot({ path: '/tmp/saturday-job-detail-desktop.png', fullPage: true });
		setJobScore(layoutJob.id, { score: 8.5, score_comment: null });
		await page.reload({ waitUntil: 'networkidle0' });
		await clickWhenReady(page, '.job-score', { label: 'job score button (no notes)' });
		await waitForSelectorReady(page, '[data-slot="dialog-content"]', {
			label: 'job score assessment dialog (no notes)',
			visible: true
		});
		assert(
			(await page.$eval('[data-slot="dialog-content"]', (el) => el.textContent)).includes(
				'No assessment notes provided.'
			)
		);
		await page.keyboard.press('Escape');
		await waitForDialogClosed(page, { label: 'job score dialog (no notes) to close' });
		const nativeDetail = await browser.newPage();
		await nativeDetail.setJavaScriptEnabled(false);
		await nativeDetail.goto(base + `/jobs/${layoutJob.id}`);
		for (const selector of [
			'#job-information',
			'#more-job-history',
			'#more-upcoming-history',
			'#more-job-documents',
			'#job-description details'
		]) {
			await nativeDetail.click(selector + ' > summary');
			assert.equal(await nativeDetail.$eval(selector, (el) => el.open), true);
		}
		await nativeDetail.close();
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
		await rm(root, { recursive: true, force: true });
	}
});
