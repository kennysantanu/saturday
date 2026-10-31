import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import * as app from '../src/lib/server/application.js';
import { withDatabase } from '../src/lib/server/database.js';
import { setExtensionsEnabled } from '../src/lib/server/extensions.js';

test('page-specific Recent buttons precede Add actions without tabs and preserve viewed history and settings', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-recents-browser-'));
	const previous = { ...process.env };
	Object.assign(process.env, {
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	const a = await app.createJob({ job_title: 'Frontend Engineer', company_name: 'Example' });
	const b = await app.createJob({ job_title: 'Product Engineer', company_name: 'Other Company' });
	const p = await app.createNetwork({ name: 'Alex Morgan', organization: 'Example' });
	const before = await app.getJob(a.id);
	await setExtensionsEnabled(true);
	const socket = createServer();
	await new Promise((done) => socket.listen(0, '127.0.0.1', done));
	const port = socket.address().port;
	await new Promise((done) => socket.close(done));
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
			await new Promise((done) => setTimeout(done, 100));
		}
		assert(ready, logs);
		const post = (body, origin = base) =>
			fetch(base + '/api/recents', {
				method: 'POST',
				headers: { origin, 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
		assert.equal(
			(
				await post(
					{ kind: 'job', id: a.id, dataset_id: before.dataset_id },
					'https://elsewhere.example'
				)
			).status,
			403
		);
		assert.equal((await post({ kind: 'invalid' })).status, 400);
		assert.equal(
			(await post({ kind: 'job', id: 99999, dataset_id: before.dataset_id })).status,
			404
		);
		// Server-rendered GETs and prefetches do not count as views.
		await fetch(base + `/jobs/${a.id}`, {
			headers: { accept: 'text/html', 'sec-purpose': 'prefetch' }
		});
		assert.equal((await app.listRecentViews()).jobs.length, 0);
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage(),
			errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.setViewport({ width: 1280, height: 960 });
		await page.goto(base, { waitUntil: 'networkidle0' });
		assert.equal(await page.$('.recent-trigger'), null);
		await page.goto(base + '/jobs', { waitUntil: 'networkidle0' });
		const trigger = 'button[aria-label="Recent jobs"]';
		const peopleTrigger = 'button[aria-label="Recent people"]';
		const actionOrder = async (target, selector) =>
			target.$eval(
				'.page-actions',
				(el, selector) => {
					const recent = el.querySelector(selector);
					const add = el.querySelector('a[href*="/new"]');
					return Boolean(
						recent && add && recent.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING
					);
				},
				selector
			);
		assert.equal(await page.$('.app-topbar .recent-trigger'), null);
		assert(await actionOrder(page, trigger));
		await page.waitForSelector(trigger);
		await page.click(trigger);
		await page.waitForFunction(() =>
			document.querySelector('.recent-message')?.textContent.includes('No recently viewed jobs')
		);
		await page.keyboard.press('Escape');
		assert.equal(await page.$eval(trigger, (el) => el === document.activeElement), true);
		// Hover runs SvelteKit's real preload behavior without opening the detail.
		await page.hover(`a[href^="/jobs/${a.id}?"]`);
		await page.waitForNetworkIdle();
		assert.equal((await app.listRecentViews()).jobs.length, 0);
		await page.click(`a[href^="/jobs/${a.id}?"]`);
		await page.waitForFunction((id) => location.pathname === `/jobs/${id}`, {}, a.id);
		await page.waitForNetworkIdle();
		assert.deepEqual(
			(await app.listRecentViews()).jobs.map((row) => row.id),
			[a.id]
		);
		const timestamp = () =>
			withDatabase(
				(db) =>
					db.prepare('SELECT viewed_at FROM recent_job_views WHERE job_id=?').get(a.id).viewed_at
			);
		const firstView = timestamp();
		await page.goto(base + `/jobs/${b.id}`, { waitUntil: 'networkidle0' });
		await page.goto(base + `/jobs/${a.id}`, { waitUntil: 'networkidle0' });
		assert(timestamp() > firstView);
		await page.goto(base + '/jobs?query=Frontend', { waitUntil: 'networkidle0' });
		await page.click(trigger);
		assert.equal(await page.$('.recent-popover [role="tablist"]'), null);
		await page.waitForSelector('.recent-results .recent-list a');
		assert.deepEqual(
			await page.$$eval('.recent-results .recent-list a .font-medium', (rows) =>
				rows.map((row) => row.textContent)
			),
			['Frontend Engineer', 'Product Engineer']
		);
		await page.screenshot({ path: '/tmp/saturday-recents-desktop.png' });
		await page.keyboard.press('Escape');
		assert.deepEqual(await app.getJob(a.id), before);
		for (const width of [320, 390, 767, 768, 900, 1024, 1280]) {
			await page.setViewport({ width, height: 960 });
			const header = await page.$eval('.app-topbar', (el) => {
				const visible = [...el.querySelectorAll('a,button')].filter(
					(item) => item.getBoundingClientRect().width > 0
				);
				return visible.every((item) => {
					const r = item.getBoundingClientRect();
					return r.left >= 0 && r.right <= innerWidth;
				});
			});
			assert(header, `Header fits at ${width}px with Extensions enabled`);
		}
		await page.goto(base + `/jobs/${a.id}`, { waitUntil: 'networkidle0' });
		// Changing detail query parameters does not count as a fresh record view.
		const lastView = timestamp();
		await page.evaluate(() => {
			const link = document.createElement('a');
			link.href = location.pathname + '?network_page=1';
			link.textContent = 'Query navigation';
			link.id = 'query-navigation';
			document.body.append(link);
		});
		await page.click('#query-navigation');
		await page.waitForNetworkIdle();
		assert.equal(timestamp(), lastView);
		await page.goto(base + `/networks/${p.id}`, { waitUntil: 'networkidle0' });
		assert.equal(await page.$('.recent-trigger'), null);
		await page.goto(base + '/networks', { waitUntil: 'networkidle0' });
		assert(await actionOrder(page, peopleTrigger));
		await page.click(peopleTrigger);
		await page.waitForSelector('.recent-results .recent-list a');
		assert.equal(await page.$('.recent-popover [role="tablist"]'), null);
		assert.equal(await page.$('.recent-list a[href^="/jobs/"]'), null);
		assert.equal(
			await page.$eval('.recent-results .recent-list a .font-medium', (el) => el.textContent),
			'Alex Morgan'
		);
		await page.keyboard.press('Escape');
		await page.close();
		// A separate browser context represents another device accessing the workspace.
		const context = await browser.createBrowserContext(),
			phone = await context.newPage();
		phone.on('pageerror', (error) => errors.push(error.message));
		await phone.bringToFront();
		await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
		await phone.goto(base + '/jobs', { waitUntil: 'networkidle0' });
		assert(await actionOrder(phone, trigger));
		await phone.click(trigger);
		await phone.waitForSelector('.recent-sheet .recent-results .recent-list a');
		await phone.$eval('.recent-sheet', async (el) => {
			await Promise.all(el.getAnimations().map((animation) => animation.finished));
		});
		const geometry = await phone.$eval('.recent-sheet', (el) => {
			const r = el.getBoundingClientRect();
			return { bottom: r.bottom, width: r.width, height: r.height, viewport: innerHeight };
		});
		await phone.screenshot({ path: '/tmp/saturday-recents-mobile.png' });
		assert(Math.abs(geometry.bottom - geometry.viewport) < 2, JSON.stringify(geometry));
		assert(geometry.width <= 390 && geometry.height <= 844 * 0.85 + 1);
		assert.equal(
			await phone.$eval('.recent-results .recent-list a .font-medium', (el) => el.textContent),
			'Frontend Engineer'
		);
		await phone.screenshot({ path: '/tmp/saturday-recents-mobile.png' });
		await phone.keyboard.press('Escape');
		await phone.goto(base + '/networks', { waitUntil: 'networkidle0' });
		assert(await actionOrder(phone, peopleTrigger));
		await phone.click(peopleTrigger);
		await phone.waitForSelector('.recent-sheet .recent-list a');
		assert.equal(
			await phone.$eval('.recent-list a .font-medium', (el) => el.textContent),
			'Alex Morgan'
		);
		assert.equal(await phone.$('.recent-sheet [role="tablist"]'), null);
		await phone.click('.recent-settings');
		await phone.waitForSelector('#recent-limit');
		await phone.waitForNetworkIdle();
		await phone.evaluate(async () => {
			await Promise.all(
				document.getAnimations().map((animation) => animation.finished.catch(() => {}))
			);
		});
		await phone.select('#recent-limit', '5');
		await Promise.all([
			phone.waitForResponse(
				(response) =>
					response.url().includes('?/navigation') && response.request().method() === 'POST'
			),
			phone.click('#navigation button[type="submit"]')
		]);
		await phone.waitForNetworkIdle();
		await phone.waitForFunction(() =>
			document.querySelector('#navigation [role="status"]')?.textContent.includes('saved')
		);
		assert.equal((await app.getNavigationSettings()).limit, 5);
		await phone.click('#navigation input[name="enabled"]');
		await Promise.all([
			phone.waitForResponse(
				(response) =>
					response.url().includes('?/navigation') && response.request().method() === 'POST'
			),
			phone.click('#navigation button[type="submit"]')
		]);
		await phone.waitForNetworkIdle();
		assert.equal((await app.getNavigationSettings()).enabled, false);
		await phone.goto(base + '/jobs', { waitUntil: 'networkidle0' });
		assert.equal(await phone.$(trigger), null);
		await phone.goto(base + `/jobs/${b.id}`, { waitUntil: 'networkidle0' });
		assert.equal((await app.listRecentViews()).jobs.length, 0);
		await phone.goto(base + '/settings#navigation', { waitUntil: 'networkidle0' });
		await phone.click('#navigation input[name="enabled"]');
		await Promise.all([
			phone.waitForResponse(
				(response) =>
					response.url().includes('?/navigation') && response.request().method() === 'POST'
			),
			phone.click('#navigation button[type="submit"]')
		]);
		await phone.waitForNetworkIdle();
		assert.equal((await app.getNavigationSettings()).enabled, true);
		assert.equal((await app.listRecentViews()).jobs[0].id, a.id);
		await phone.click('#navigation form:has(input[name="kind"]) button');
		await phone.waitForFunction(() =>
			document.querySelector('#navigation [role="status"]')?.textContent.includes('cleared')
		);
		assert.equal((await app.listRecentViews()).jobs.length, 0);
		assert.equal((await app.listRecentViews()).people.length, 0);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((done) => child.once('exit', done));
		await rm(root, { recursive: true, force: true });
		for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
		Object.assign(process.env, previous);
	}
});
