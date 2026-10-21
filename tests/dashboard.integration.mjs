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
import { createJob, moveJobStage, addJobUpdate, getJob } from '../src/lib/server/services.js';
import {
	listWorkflowStages,
	renameWorkflowStage,
	archiveWorkflowStage
} from '../src/lib/server/workflow.js';

test('Dashboard pipeline HTTP and browser paging, detail returns, closed jobs and responsive layout', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-pipeline-web-'));
	Object.assign(process.env, {
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'extension-code')
	});
	migrateDatabase();
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
	let logs = '',
		browser;
	child.stdout.on('data', (chunk) => (logs += chunk));
	child.stderr.on('data', (chunk) => (logs += chunk));
	try {
		let ready = false;
		for (let i = 0; i < 150; i++) {
			try {
				if ((await fetch(base)).ok) {
					ready = true;
					break;
				}
			} catch {}
			await new Promise((r) => setTimeout(r, 100));
		}
		assert(ready, logs);
		assert((await (await fetch(base)).text()).includes('Welcome to Saturday'));
		const stages = listWorkflowStages();
		const id = (name) => stages.find((s) => s.name === name).id;
		const newId = id('New'),
			appliedId = id('Applied'),
			acceptedId = id('Accepted'),
			offerId = id('Offer');
		const jobs = [];
		for (let i = 0; i < 127; i++) {
			const job = createJob({
				job_title: `Pipeline role ${i} ${'Long title '.repeat(7)}`,
				company_name: 'Long company name '.repeat(8),
				is_starred: i === 0
			});
			jobs.push(job);
			if (i >= 21)
				moveJobStage(job.id, {
					stage_id: i >= 106 ? acceptedId : appliedId,
					event_date: '2020-01-01'
				});
		}
		addJobUpdate({ job_id: jobs[0].id, stage_id: id('Interview'), event_date: '2099-01-01' });
		archiveWorkflowStage(id('Interview'));
		renameWorkflowStage(
			newId,
			'New opportunities with a deliberately long stage name for narrow screens'
		);
		const html = await (await fetch(base)).text();
		assert(html.includes('Job pipeline'));
		assert(!html.includes('Recently updated'));
		assert(!html.includes('Jobs you’re still pursuing'));
		assert(html.indexOf('id="job-pipeline"') < html.indexOf('id="notifications-heading"'));
		assert(html.indexOf('id="notifications-heading"') < html.indexOf('id="history-heading"'));
		assert(html.includes('Archived milestones'));
		assert(!html.includes(`id="pipeline-stage-${id('Interview')}"`));
		assert(html.includes(`/jobs?view=all&amp;current_stage=${newId}`));
		assert(html.includes(`/jobs?view=all&amp;milestone_stage=${id('Interview')}`));
		assert(
			(await (await fetch(base + `/jobs?view=all&current_stage=${acceptedId}`)).text()).includes(
				'Pipeline role 106'
			)
		);
		if (!existsSync(await puppeteer.executablePath())) {
			t.diagnostic('Managed Chrome unavailable; HTTP passed.');
			return;
		}
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage(),
			errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
		await page.setViewport({ width: 1280, height: 960 });
		await page.goto(base + '/#job-pipeline', { waitUntil: 'networkidle0' });
		assert.equal(await page.$$('.pipeline-column').then((els) => els.length), 3);
		await page.screenshot({ path: '/tmp/saturday-pipeline-initial.png' });
		assert(await page.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
		assert(await page.$eval('.pipeline-board', (el) => el.scrollWidth <= el.clientWidth + 1));
		assert.equal(await page.$eval('[aria-label="Previous stages"]', (el) => el.disabled), true);
		const column = (stageId) => `.pipeline-column:has(#pipeline-stage-${stageId})`;
		const stageOrder = listWorkflowStages()
			.filter((s) => !s.is_archived)
			.map((s) => s.id);
		async function browseTo(stageId) {
			for (let attempt = 0; attempt < stageOrder.length; attempt++) {
				if (await page.$(column(stageId))) return;
				const first = await page.$eval('.pipeline-heading', (el) =>
					Number(el.id.replace('pipeline-stage-', ''))
				);
				const direction =
					stageOrder.indexOf(stageId) < stageOrder.indexOf(first) ? 'Previous' : 'Next';
				await page.click(`[aria-label="${direction} stages"]`);
				await page.waitForNetworkIdle({ idleTime: 300 });
			}
			assert.fail(`Stage ${stageId} was not reachable`);
		}
		assert(
			await page.$$eval('.pipeline-card', (cards) =>
				cards.every(
					(card) =>
						card.children.length === 2 &&
						card.getBoundingClientRect().right <=
							card.closest('.pipeline-column').getBoundingClientRect().right &&
						[...card.children].every((line) => getComputedStyle(line).whiteSpace === 'nowrap')
				)
			)
		);
		assert(!(await page.$eval('.pipeline-board', (el) => el.textContent)).includes('Open stage'));
		assert(
			!(await page.$eval('.pipeline-board', (el) => el.textContent)).includes('View all in Jobs')
		);
		assert.equal(
			await page.$eval(`#pipeline-stage-${newId} a`, (el) => el.getAttribute('href')),
			`/jobs?view=all&current_stage=${newId}`
		);
		assert.equal(await page.$$(column(newId) + ' .pipeline-card').then((els) => els.length), 20);
		const next = (stageId) => column(stageId) + ' nav a:last-child';
		await page.click(next(newId));
		await page.waitForFunction(
			(stageId) => document.activeElement?.id === `pipeline-stage-${stageId}`,
			{},
			newId
		);
		assert.equal(new URL(page.url()).searchParams.get(`pipeline_page_${newId}`), '2');
		assert.equal(await page.$$(column(newId) + ' .pipeline-card').then((els) => els.length), 1);
		await page.waitForNetworkIdle({ idleTime: 300 });
		await browseTo(acceptedId);
		await page.click(next(acceptedId));
		await page.waitForFunction(
			(stageId) => document.activeElement?.id === `pipeline-stage-${stageId}`,
			{},
			acceptedId
		);
		assert.equal(new URL(page.url()).searchParams.get(`pipeline_page_${newId}`), '2');
		assert.equal(new URL(page.url()).searchParams.get(`pipeline_page_${acceptedId}`), '2');
		await browseTo(newId);
		await page.$eval(column(newId) + ' .pipeline-card', (el) =>
			el.scrollIntoView({ block: 'center', inline: 'center' })
		);
		await page.waitForNetworkIdle({ idleTime: 300 });
		await page.click(column(newId) + ' .pipeline-card');
		await page.waitForFunction(() => location.pathname.startsWith('/jobs/'));
		await page.waitForNetworkIdle({ idleTime: 300 });
		const movedJobId = Number(new URL(page.url()).pathname.split('/').at(-1));
		const returnTo = new URL(page.url()).searchParams.get('return_to');
		assert(returnTo.includes(`pipeline_page_${acceptedId}=2`));
		assert(returnTo.endsWith(`#pipeline-stage-${newId}`));
		moveJobStage(movedJobId, { stage_id: offerId, event_date: '2020-01-01' });
		await page.click(`a[href="${returnTo}"]`);

		await page.waitForFunction(
			(stageId) => document.activeElement?.id === `pipeline-stage-${stageId}`,
			{},
			newId
		);
		assert.equal(await page.$$(column(newId) + ' .pipeline-card').then((els) => els.length), 20);
		await browseTo(offerId);
		assert.equal(await page.$$(column(offerId) + ' .pipeline-card').then((els) => els.length), 1);
		await browseTo(acceptedId);
		assert.equal(
			await page.$$(column(acceptedId) + ' .pipeline-card').then((els) => els.length),
			1
		);
		await browseTo(newId);
		assert.equal(await page.$$(column(newId) + ' nav').then((els) => els.length), 0);
		await page.waitForNetworkIdle({ idleTime: 300 });
		await page.focus(`#pipeline-stage-${newId}`);
		await page.keyboard.press('Tab');
		assert.equal(
			await page.evaluate(() => document.activeElement?.getAttribute('href')),
			`/jobs?view=all&current_stage=${newId}`
		);
		await page.screenshot({ path: '/tmp/saturday-pipeline-desktop.png' });
		await page.$eval('.dashboard-overview', (el) => el.scrollIntoView({ block: 'start' }));
		assert(
			await page.$$eval('.milestone-count strong', (counts) =>
				counts.every(
					(el) =>
						el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) + 1
				)
			)
		);
		assert(
			await page.evaluate(() => {
				const left = document
					.querySelector('[aria-labelledby="notifications-heading"]')
					.getBoundingClientRect();
				const right = document
					.querySelector('[aria-labelledby="history-heading"]')
					.getBoundingClientRect();
				const board = document.querySelector('#job-pipeline').getBoundingClientRect();
				return (
					Math.abs(left.top - right.top) < 2 && right.left > left.right && left.top >= board.bottom
				);
			})
		);
		await page.screenshot({ path: '/tmp/saturday-dashboard-overview-desktop.png' });
		await page.emulateMediaFeatures([
			{ name: 'prefers-color-scheme', value: 'dark' },
			{ name: 'prefers-reduced-motion', value: 'reduce' }
		]);
		await page.setViewport({ width: 320, height: 900 });
		await page.waitForFunction(() => document.querySelectorAll('.pipeline-column').length === 1);
		await page.goto(base + '/#job-pipeline', { waitUntil: 'networkidle0' });
		assert(await page.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
		assert(await page.$eval('.pipeline-board', (el) => el.scrollWidth <= el.clientWidth + 1));
		assert.equal(await page.$$('.pipeline-column').then((els) => els.length), 1);
		await page.focus('[aria-label="Next stages"]');
		await page.keyboard.press('Enter');
		await page.waitForNetworkIdle({ idleTime: 300 });
		assert.equal(
			await page.$eval('.pipeline-heading', (el) => el.id),
			`pipeline-stage-${appliedId}`
		);
		assert.equal(await page.$$('.pipeline-column').then((els) => els.length), 1);
		await page.setViewport({ width: 1280, height: 960 });
		await page.waitForFunction(() => document.querySelectorAll('.pipeline-column').length === 3);
		assert(await page.$(column(appliedId)));
		await page.setViewport({ width: 320, height: 900 });
		await page.waitForFunction(() => document.querySelectorAll('.pipeline-column').length === 1);
		await page.screenshot({ path: '/tmp/saturday-pipeline-phone-dark.png' });
		await page.$eval('.dashboard-overview', (el) => el.scrollIntoView({ block: 'start' }));
		assert(
			await page.evaluate(() => {
				const left = document
					.querySelector('[aria-labelledby="notifications-heading"]')
					.getBoundingClientRect();
				const right = document
					.querySelector('[aria-labelledby="history-heading"]')
					.getBoundingClientRect();
				return right.top >= left.bottom && Math.abs(left.left - right.left) < 2;
			})
		);
		await page.screenshot({ path: '/tmp/saturday-dashboard-overview-phone.png' });
		// A 640px viewport approximates a 1280px desktop at 200% page zoom for reflow.
		await page.setViewport({ width: 640, height: 480 });
		assert(await page.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
		await page.screenshot({ path: '/tmp/saturday-pipeline-reflow.png' });
		const native = await browser.newPage();
		await native.setJavaScriptEnabled(false);
		await native.goto(
			base +
				`/?pipeline_stage=${appliedId}&pipeline_page_${appliedId}=2#pipeline-stage-${appliedId}`
		);
		assert.equal(
			await native.$$(column(appliedId) + ' .pipeline-card').then((els) => els.length),
			20
		);
		await Promise.all([native.waitForNavigation(), native.click(next(appliedId))]);
		assert.equal(new URL(native.url()).searchParams.get(`pipeline_page_${appliedId}`), '3');
		await Promise.all([native.waitForNavigation(), native.click('[aria-label="Next stages"]')]);
		assert.equal(await native.$$('.pipeline-column').then((els) => els.length), 1);
		assert.equal(new URL(native.url()).searchParams.get(`pipeline_page_${appliedId}`), '3');
		await native.close();
		// The all-closed workspace must retain the board and ordinary Add job action.
		for (const job of jobs)
			if (!getJob(job.id).currentStage.is_closed)
				moveJobStage(job.id, { stage_id: acceptedId, event_date: '2020-01-01' });
		await page.goto(base, { waitUntil: 'networkidle0' });
		assert.equal(await page.$$('.activity-summary').then((els) => els.length), 0);
		assert.equal(await page.$$('.pipeline-column').then((els) => els.length), 1);
		await browseTo(acceptedId);
		assert.equal(
			await page.$$(column(acceptedId) + ' .pipeline-card').then((els) => els.length),
			20
		);
		await browseTo(stageOrder.at(-1));
		assert.equal(await page.$eval('[aria-label="Next stages"]', (el) => el.disabled), true);
		assert((await page.content()).includes('Nothing due'));
		assert(!(await page.content()).includes('Welcome to Saturday'));
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
		await rm(root, { recursive: true, force: true });
	}
});
