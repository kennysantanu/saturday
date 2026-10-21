import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';

test('browser-local themes persist, follow System live, and apply before hydration with safe fallbacks', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-theme-'));
	const socket = createServer();
	await new Promise((done) => socket.listen(0, '127.0.0.1', done));
	const port = socket.address().port;
	await new Promise((done) => socket.close(done));
	const base = `http://127.0.0.1:${port}`;
	const child = spawn(process.execPath, ['scripts/start.mjs'], {
		cwd: resolve('.'),
		env: {
			...process.env,
			PORT: String(port),
			SATURDAY_DB_PATH: join(root, 'db.sqlite'),
			SATURDAY_FILES_PATH: join(root, 'files'),
			SATURDAY_INSTALLATION_PATH: '',
			SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
			SATURDAY_EXTENSIONS_PATH: join(root, 'extension-code')
		},
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
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage(),
			errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.setViewport({ width: 1280, height: 960 });
		const media = await page.createCDPSession();
		const system = (value, contrast = 'no-preference') =>
			media.send('Emulation.setEmulatedMedia', {
				features: [
					{ name: 'prefers-color-scheme', value },
					{ name: 'prefers-contrast', value: contrast }
				]
			});
		const resolved = async (target, value) => {
			await target.bringToFront();
			await target.waitForFunction(
				(value) => document.documentElement.dataset.theme === value,
				{},
				value
			);
			assert.equal(await target.$eval('html', (el) => getComputedStyle(el).colorScheme), value);
		};
		const token = (name) =>
			page.$eval('html', (el, name) => getComputedStyle(el).getPropertyValue(name).trim(), name);
		await system('light');
		await page.goto(base + '/settings#appearance', { waitUntil: 'networkidle0' });
		await page.waitForSelector('#theme:not(:disabled)');
		assert.equal(await page.$eval('#theme', (el) => el.value), 'system');
		await resolved(page, 'light');
		const url = page.url();
		let writes = 0;
		page.on('request', (request) => {
			if (request.method() === 'POST') writes++;
		});
		await page.select('#theme', 'dark');
		await resolved(page, 'dark');
		assert.equal(await token('--background'), '#14171d');
		// Shared Tailwind dark variants must follow the override, even with a light OS.
		await page.waitForFunction(
			(color) =>
				getComputedStyle(document.querySelector('button[class~="dark:border-input"]'))
					.borderColor === color,
			{},
			'rgb(98, 110, 129)'
		);
		assert.equal(await page.evaluate(() => localStorage.getItem('saturday-theme')), 'dark');
		assert.equal(page.url(), url);
		assert.equal(writes, 0);
		await page.screenshot({ path: '/tmp/saturday-theme-dark.png' });
		await page.reload({ waitUntil: 'networkidle0' });
		await resolved(page, 'dark');
		assert.equal(await page.$eval('#theme', (el) => el.value), 'dark');

		const tab = await browser.newPage();
		await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
		await tab.goto(url, { waitUntil: 'networkidle0' });
		await resolved(tab, 'dark');
		await page.select('#theme', 'light');
		await resolved(tab, 'light');
		assert.equal(await tab.$eval('#theme', (el) => el.value), 'light');
		await system('dark');
		await resolved(page, 'light');
		assert.equal(await token('--background'), '#f4f5f8');
		await page.waitForFunction(
			(color) =>
				getComputedStyle(document.querySelector('button[class~="dark:border-input"]'))
					.borderColor === color,
			{},
			'rgb(223, 227, 235)'
		);
		await page.screenshot({ path: '/tmp/saturday-theme-light.png' });
		await page.select('#theme', 'system');
		await resolved(page, 'dark');
		await resolved(tab, 'light');
		assert.equal(await page.evaluate(() => localStorage.getItem('saturday-theme')), null);
		await system('light');
		await resolved(page, 'light');
		await system('dark');
		await resolved(page, 'dark');

		await page.select('#theme', 'light');
		await system('dark', 'more');
		assert.equal(await token('--border'), '#727b8d');
		await page.select('#theme', 'dark');
		await system('light', 'more');
		assert.equal(await token('--border'), '#97a4b9');
		await page.setViewport({ width: 320, height: 900 });
		await page.$eval('#appearance', (el) => el.scrollIntoView({ block: 'start' }));
		assert(await page.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
		await page.screenshot({ path: '/tmp/saturday-theme-phone.png' });
		await media.detach();
		await tab.close();

		// Stop hydration entirely: the early head script alone must apply the saved choice.
		const startup = await browser.newPage();
		await startup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
		await startup.evaluateOnNewDocument(() => localStorage.setItem('saturday-theme', 'light'));
		await startup.setRequestInterception(true);
		startup.on('request', (request) =>
			request.resourceType() === 'script' ? void request.abort() : void request.continue()
		);
		await startup.goto(url, { waitUntil: 'networkidle0' });
		await resolved(startup, 'light');
		assert.equal(await startup.$eval('#theme', (el) => el.disabled), true);
		await startup.close();

		const isolated = await browser.createBrowserContext();
		const independent = await isolated.newPage();
		await independent.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
		await independent.goto(url, { waitUntil: 'networkidle0' });
		await resolved(independent, 'dark');
		assert.equal(await independent.$eval('#theme', (el) => el.value), 'system');
		await independent.evaluate(() => localStorage.setItem('saturday-theme', 'unexpected'));
		await independent.reload({ waitUntil: 'networkidle0' });
		await resolved(independent, 'dark');
		assert.equal(await independent.$eval('#theme', (el) => el.value), 'system');

		const blocked = await isolated.newPage();
		await blocked.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
		blocked.on('pageerror', (error) => errors.push(error.message));
		await blocked.evaluateOnNewDocument(() =>
			Object.defineProperty(window, 'localStorage', {
				get() {
					throw new DOMException('Storage blocked', 'SecurityError');
				}
			})
		);
		await blocked.goto(url, { waitUntil: 'networkidle0' });
		await resolved(blocked, 'dark');
		assert.equal(await blocked.$eval('#theme', (el) => el.disabled), true);
		assert((await blocked.content()).includes('Browser storage is unavailable'));
		await isolated.close();

		const native = await browser.newPage();
		await native.setJavaScriptEnabled(false);
		await native.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
		await native.goto(url, { waitUntil: 'networkidle0' });
		assert.equal(await native.$eval('html', (el) => getComputedStyle(el).colorScheme), 'dark');
		await native.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
		assert.equal(await native.$eval('html', (el) => getComputedStyle(el).colorScheme), 'light');
		await native.close();
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((done) => (child.exitCode !== null ? done() : child.once('exit', done)));
		await rm(root, { recursive: true, force: true });
	}
});
