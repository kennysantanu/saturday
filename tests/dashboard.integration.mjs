import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
		t.diagnostic(
			`${await browser.version()}; ${process.platform}/${process.arch}; Node ${process.version}`
		);
		const page = await browser.newPage(),
			errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		let dashboardRequests = 0;
		page.on('request', (request) => {
			if (request.url().startsWith(base)) dashboardRequests++;
		});
		const browsingState = () =>
			page.evaluate(() => ({
				url: location.href,
				history: history.length,
				scroll: scrollY
			}));
		const flushEdge = (edge) =>
			page.$eval(
				'.pipeline-board',
				(el, edge) => {
					const columns = [...el.querySelectorAll('.pipeline-column')];
					const card = edge === 'left' ? columns[0] : columns.at(-1);
					return (
						Math.abs(card.getBoundingClientRect()[edge] - el.getBoundingClientRect()[edge]) < 1
					);
				},
				edge
			);
		await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
		await page.setViewport({ width: 1280, height: 960 });
		await page.goto(base + '/#job-pipeline', { waitUntil: 'networkidle0' });
		assert.equal(await page.$$('.pipeline-column').then((els) => els.length), 3);
		await page.screenshot({ path: '/tmp/saturday-pipeline-initial.png' });
		assert(await page.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
		assert(
			await page.$eval('.pipeline-window', (el) => getComputedStyle(el).overflowX === 'hidden')
		);
		assert.equal(await page.$eval('[aria-label="Previous stages"]', (el) => el.disabled), true);
		assert(
			await page.$eval('.pipeline-browser', (el) => {
				const board = el.querySelector('.pipeline-window').getBoundingClientRect();
				const position = el.querySelector('.pipeline-position').getBoundingClientRect();
				return [...el.querySelectorAll('.pipeline-arrow')].every((arrow) => {
					const r = arrow.getBoundingClientRect();
					return (
						r.top >= board.bottom &&
						Math.abs(r.top - position.top) < 1 &&
						Math.abs(r.bottom - position.bottom) < 1 &&
						r.height >= 44
					);
				});
			})
		);
		assert(await flushEdge('left'));
		const initialColumnWidth = await page.$eval(
			'.pipeline-column',
			(el) => el.getBoundingClientRect().width
		);
		const initialBrowsingState = await browsingState();
		const initialRequests = dashboardRequests;
		// Keyboard navigation crosses stage windows without stealing vertical list keys.
		const initialHeadings = await page.$$eval('.pipeline-heading', (els) => els.map((el) => el.id));
		await page.$eval(`#pipeline-stage-${newId} a`, (el) => el.focus({ preventScroll: true }));
		await page.keyboard.press('ArrowRight');
		assert.equal(
			await page.evaluate(() => document.activeElement?.id),
			`pipeline-stage-${appliedId}`
		);
		await page.$eval(`#${initialHeadings.at(-1)}`, (el) => el.focus({ preventScroll: true }));
		await page.keyboard.press('ArrowRight');
		await page.waitForNetworkIdle({ idleTime: 300 });
		assert.equal(
			await page.$eval('.pipeline-heading', (el) => el.id),
			`pipeline-stage-${appliedId}`
		);
		assert.deepEqual(await browsingState(), initialBrowsingState);
		assert.equal(dashboardRequests, initialRequests);
		await page.reload({ waitUntil: 'networkidle0' });
		const firstCard = await page.$('.pipeline-card');
		await firstCard.evaluate((el) => el.focus({ preventScroll: true }));
		const focusedJob = await page.evaluate(() => document.activeElement?.getAttribute('href'));
		await page.keyboard.press('ArrowRight');
		assert.equal(
			await page.evaluate(() => document.activeElement?.getAttribute('href')),
			focusedJob
		);
		assert.equal(new URL(page.url()).searchParams.get('pipeline_stage'), null);
		// Allow ordinary job-link preloading to finish before measuring horizontal browsing.
		await firstCard.hover();
		await page.waitForNetworkIdle({ idleTime: 300 });
		const wheelState = await browsingState();
		const wheelRequests = dashboardRequests;
		// Horizontal wheel movement snaps once per gesture; momentum cannot skip stages.
		for (let i = 0; i < 5; i++) await page.mouse.wheel({ deltaX: 30, deltaY: 0 });
		await page.waitForNetworkIdle({ idleTime: 300 });
		assert.equal(
			await page.$eval('.pipeline-heading', (el) => el.id),
			`pipeline-stage-${appliedId}`
		);
		assert.deepEqual(await browsingState(), wheelState);
		assert.equal(dashboardRequests, wheelRequests);
		await page.mouse.wheel({ deltaX: -80, deltaY: 0 });
		await page.waitForNetworkIdle({ idleTime: 300 });
		assert.equal(await page.$eval('.pipeline-heading', (el) => el.id), `pipeline-stage-${newId}`);
		await page.mouse.wheel({ deltaX: 0, deltaY: 180 });
		await page.waitForNetworkIdle({ idleTime: 300 });
		assert.equal(await page.$eval('.pipeline-heading', (el) => el.id), `pipeline-stage-${newId}`);
		assert(await page.$eval('.pipeline-jobs', (el) => el.scrollTop > 0));
		await page.reload({ waitUntil: 'networkidle0' });
		const fades = () =>
			page.$eval('.pipeline-track', (el) => ({
				before: Boolean(el.querySelector('.pipeline-preview[data-preview="before"]')),
				after: Boolean(el.querySelector('.pipeline-preview[data-preview="after"]')),
				clickThrough: [...el.querySelectorAll('.pipeline-preview')].every(
					(preview) =>
						preview.inert &&
						preview.getAttribute('aria-hidden') === 'true' &&
						getComputedStyle(preview).pointerEvents === 'none' &&
						parseFloat(getComputedStyle(preview).opacity) < 1
				)
			}));
		const recordSlides = () =>
			page.$eval('.pipeline-track', (el) => {
				window.pipelineSlides = [];
				const animate = el.animate.bind(el);
				el.animate = (frames, options) => {
					window.pipelineSlides.push({ frames, duration: options.duration });
					const animation = animate(frames, options);
					if (window.pauseNextPipelineSlide) {
						window.pauseNextPipelineSlide = false;
						animation.pause();
						animation.currentTime = options.duration / 2;
						window.pausedPipelineSlide = animation;
					}
					return animation;
				};
			});
		await recordSlides();
		assert(
			await page.$eval(
				'.pipeline-track',
				(el) => el.children.length <= el.querySelectorAll('.pipeline-column').length + 2
			)
		);
		assert.deepEqual(await fades(), { before: false, after: true, clickThrough: true });
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
				await page.$eval(`[aria-label="${direction} stages"]`, (el) =>
					el.focus({ preventScroll: true })
				);
				await page.keyboard.press('Enter');
				await page.waitForNetworkIdle({ idleTime: 300 });
			}
			assert.fail(`Stage ${stageId} was not reachable`);
		}
		const arrowState = await browsingState();
		const arrowRequests = dashboardRequests;
		await browseTo(stageOrder.at(-1));
		assert(await flushEdge('right'));
		assert.equal(
			await page.$eval('.pipeline-column', (el) => el.getBoundingClientRect().width),
			initialColumnWidth
		);
		assert.deepEqual(await browsingState(), arrowState);
		assert.equal(dashboardRequests, arrowRequests);
		await page.screenshot({ path: '/tmp/saturday-pipeline-end-desktop.png' });
		await browseTo(newId);
		assert(await flushEdge('left'));
		assert(
			await page.$$eval('.pipeline-card', (cards) =>
				cards.every(
					(card) =>
						card.children.length === 2 &&
						card.getBoundingClientRect().left >=
							card.closest('.pipeline-column').getBoundingClientRect().left + 8 &&
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
		const native = await browser.newPage();
		await native.setJavaScriptEnabled(false);
		await native.goto(base + '/#job-pipeline');
		assert.equal(await native.$$(column(newId) + ' .pipeline-card').then((els) => els.length), 20);
		await Promise.all([native.waitForNavigation(), native.click(next(newId))]);
		assert.equal(new URL(native.url()).searchParams.get(`pipeline_page_${newId}`), '2');
		assert.equal(await native.$$(column(newId) + ' .pipeline-card').then((els) => els.length), 1);
		assert.equal(await native.$eval('[aria-label="Next stages"]', (el) => el.disabled), true);
		await Promise.all([
			native.waitForNavigation(),
			native.click('#job-pipeline a[href="/jobs?view=all"]')
		]);
		assert.equal(new URL(native.url()).pathname, '/jobs');
		await native.close();
		await page.click(next(newId));
		await page.waitForFunction(
			(stageId) => document.activeElement?.id === `pipeline-stage-${stageId}`,
			{},
			newId
		);
		assert.equal(new URL(page.url()).searchParams.get(`pipeline_page_${newId}`), '2');
		assert.equal(await page.$$(column(newId) + ' .pipeline-card').then((els) => els.length), 1);
		await page.waitForNetworkIdle({ idleTime: 300 });
		await page.evaluate(() => {
			window.pauseNextPipelineSlide = true;
		});
		await page.click('[aria-label="Next stages"]');
		await page.waitForFunction(() => Boolean(window.pausedPipelineSlide));
		assert.equal(await page.evaluate(() => window.pausedPipelineSlide.currentTime), 120);
		await page.screenshot({ path: '/tmp/saturday-pipeline-slide-midpoint.png' });
		await page.evaluate(() => {
			window.pausedPipelineSlide.play();
			window.pausedPipelineSlide = null;
		});
		await page.waitForNetworkIdle({ idleTime: 300 });
		await browseTo(acceptedId);
		assert.equal((await fades()).before, true);
		assert(
			await page.evaluate(() =>
				window.pipelineSlides.some(
					({ frames, duration }) =>
						duration === 240 &&
						new DOMMatrixReadOnly(frames[0].transform).m41 >
							new DOMMatrixReadOnly(frames[1].transform).m41
				)
			)
		);
		await page.click(next(acceptedId));
		await page.waitForFunction(
			(stageId) => document.activeElement?.id === `pipeline-stage-${stageId}`,
			{},
			acceptedId
		);
		assert.equal(new URL(page.url()).searchParams.get(`pipeline_page_${newId}`), '2');
		assert.equal(new URL(page.url()).searchParams.get(`pipeline_page_${acceptedId}`), '2');
		const preservedBoardUrl = page.url();
		await page.reload({ waitUntil: 'networkidle0' });
		assert.equal(page.url(), preservedBoardUrl);
		assert.equal(
			await page.$$(column(acceptedId) + ' .pipeline-card').then((els) => els.length),
			1
		);
		await page.click(`#pipeline-stage-${acceptedId} a`);
		await page.waitForFunction(() => location.pathname === '/jobs');
		await page.waitForNetworkIdle({ idleTime: 300 });
		await page.goBack({ waitUntil: 'networkidle0' });
		await page.waitForSelector(column(acceptedId));
		assert.equal(page.url(), preservedBoardUrl);
		assert.equal(new URL(page.url()).searchParams.get(`pipeline_page_${newId}`), '2');

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
		assert(returnTo.endsWith('#job-pipeline'));
		assert(!returnTo.includes('pipeline_stage='));
		moveJobStage(movedJobId, { stage_id: offerId, event_date: '2020-01-01' });
		await page.click(`a[href="${returnTo}"]`);

		await page.waitForSelector(column(newId));
		await page.waitForNetworkIdle({ idleTime: 300 });
		assert.equal(await page.$eval('.pipeline-heading', (el) => el.id), `pipeline-stage-${newId}`);
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
		const accessibility = await page.createCDPSession();
		const tree = await accessibility.send('Accessibility.getFullAXTree');
		assert(
			tree.nodes.some(
				(node) => node.role?.value === 'heading' && node.name?.value === 'Job pipeline'
			)
		);
		assert(
			tree.nodes.some(
				(node) =>
					node.role?.value === 'link' &&
					/^Job #\d+: Pipeline role.* at Long company/i.test(node.name?.value ?? '')
			)
		);
		await writeFile('/tmp/saturday-pipeline-accessibility.json', JSON.stringify(tree, null, 2));
		await accessibility.detach();
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
		assert(
			await page.$eval('.pipeline-window', (el) => getComputedStyle(el).overflowX === 'hidden')
		);
		assert.equal(await page.$$('.pipeline-column').then((els) => els.length), 1);
		assert(
			await page.$eval('.pipeline-browser', (el) => {
				const board = el.querySelector('.pipeline-window').getBoundingClientRect();
				const position = el.querySelector('.pipeline-position').getBoundingClientRect();
				const browser = el.getBoundingClientRect();
				return (
					Math.abs(board.left - browser.left) < 1 &&
					Math.abs(board.width - browser.width) < 1 &&
					[...el.querySelectorAll('.pipeline-arrow')].every((arrow) => {
						const r = arrow.getBoundingClientRect();
						return (
							r.top >= board.bottom &&
							Math.abs(r.top - position.top) < 1 &&
							Math.abs(r.bottom - position.bottom) < 1
						);
					})
				);
			})
		);
		await recordSlides();
		await page.focus('[aria-label="Next stages"]');
		await page.keyboard.press('Enter');
		await page.waitForNetworkIdle({ idleTime: 300 });
		assert.equal(
			await page.$eval('.pipeline-heading', (el) => el.id),
			`pipeline-stage-${appliedId}`
		);
		assert.equal(await page.$$('.pipeline-column').then((els) => els.length), 1);
		assert.equal(await page.evaluate(() => window.pipelineSlides.length), 0);
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
		// Exercise touch events under mobile emulation; physical-device review remains separate.
		const touch = await browser.newPage();
		await touch.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
		await touch.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
		await touch.goto(base + '/#job-pipeline', { waitUntil: 'networkidle0' });
		assert.equal(await touch.$$('.pipeline-column').then((els) => els.length), 1);
		const touchSession = await touch.createCDPSession();
		async function swipe(from, to) {
			await touchSession.send('Input.dispatchTouchEvent', {
				type: 'touchStart',
				touchPoints: [from]
			});
			for (let i = 1; i <= 6; i++) {
				await touchSession.send('Input.dispatchTouchEvent', {
					type: 'touchMove',
					touchPoints: [
						{ x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 }
					]
				});
			}
			await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await touch.waitForNetworkIdle({ idleTime: 300 });
		}
		const touchUrl = touch.url();
		const touchHistory = await touch.evaluate(() => history.length);
		const swipePoint = await touch.$eval('.pipeline-card', (el) => {
			const r = el.getBoundingClientRect();
			return { x: r.left + r.width * 0.8, y: r.top + r.height / 2 };
		});
		await swipe(swipePoint, { x: swipePoint.x - 140, y: swipePoint.y + 3 });
		assert.equal(touch.url(), touchUrl); // Swiping a job neither opens it nor navigates the route.
		assert.equal(await touch.evaluate(() => history.length), touchHistory);
		assert.equal(
			await touch.$eval('.pipeline-heading', (el) => el.id),
			`pipeline-stage-${appliedId}`
		);
		await swipe({ x: swipePoint.x - 140, y: swipePoint.y }, swipePoint);
		assert.equal(await touch.$eval('.pipeline-heading', (el) => el.id), `pipeline-stage-${newId}`);
		// Vertical gestures inside a populated stage retain native list scrolling.
		const verticalPoint = await touch.$eval('.pipeline-jobs', (el) => {
			const r = el.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: Math.min(r.bottom, innerHeight - 60) - 20 };
		});
		await swipe(verticalPoint, { x: verticalPoint.x + 2, y: verticalPoint.y - 120 });
		assert.equal(await touch.$eval('.pipeline-heading', (el) => el.id), `pipeline-stage-${newId}`);
		assert(await touch.$eval('.pipeline-jobs', (el) => el.scrollTop > 0));
		await touchSession.detach();
		const arrow = await touch.$('[aria-label="Next stages"]');
		const box = await arrow.boundingBox();
		assert(box && box.width >= 40 && box.height >= 40);
		await touch.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
		await touch.waitForNetworkIdle({ idleTime: 300 });
		assert.equal(
			await touch.$eval('.pipeline-heading', (el) => el.id),
			`pipeline-stage-${appliedId}`
		);
		assert(await touch.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
		await touch.screenshot({ path: '/tmp/saturday-pipeline-touch-emulation.png' });
		await touch.close();
		// The all-closed workspace must retain the board and ordinary Add job action.
		for (const job of jobs)
			if (!getJob(job.id).currentStage.is_closed)
				moveJobStage(job.id, { stage_id: acceptedId, event_date: '2020-01-01' });
		await page.setViewport({ width: 320, height: 900 });
		await page.goto(base, { waitUntil: 'networkidle0' });
		await page.reload({ waitUntil: 'networkidle0' });
		assert.equal(await page.$$('.activity-summary').then((els) => els.length), 0);
		assert.equal(await page.$$('.pipeline-column').then((els) => els.length), 1);
		await browseTo(acceptedId);
		assert.equal(
			await page.$$(column(acceptedId) + ' .pipeline-card').then((els) => els.length),
			20
		);
		await browseTo(stageOrder.at(-1));
		assert.equal(await page.$eval('[aria-label="Next stages"]', (el) => el.disabled), true);
		assert.deepEqual(await fades(), { before: true, after: false, clickThrough: true });
		assert(await flushEdge('right'));
		await page.$eval('#job-pipeline', (el) => el.scrollIntoView({ block: 'start' }));
		await page.screenshot({ path: '/tmp/saturday-pipeline-end-phone.png' });
		await browseTo(newId);
		assert(await flushEdge('left'));
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
