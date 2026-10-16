import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
const exec = promisify(execFile);
async function waitFor(check) {
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((res) => setTimeout(res, 100));
	}
	throw new Error('Browser transition timed out.');
}
test('browser password controls, responsive sign-in and expired-write draft preservation', async (t) => {
	if (!existsSync(await puppeteer.executablePath()))
		return t.skip('Managed Chrome is not installed.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-auth-browser-'));
	const socket = createServer();
	await new Promise((res) => socket.listen(0, '127.0.0.1', res));
	const port = socket.address().port;
	await new Promise((res) => socket.close(res));
	const env = {
		...process.env,
		SATURDAY_PROJECT_ROOT: resolve('.'),
		SATURDAY_DB_PATH: join(root, 'saturday.db'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'extension-code'),
		SATURDAY_INSTALLATION_PATH: '',
		PORT: String(port)
	};
	const run = (file, ...args) =>
		exec(process.execPath, [file, ...args], { env, maxBuffer: 1024 * 1024 });
	const base = `http://127.0.0.1:${port}`,
		password = '7';
	let browser,
		step = 'password and draft workflow';
	try {
		const setup = JSON.parse(
			(
				await run(
					'scripts/setup.mjs',
					'--skip-dependencies',
					'--skip-build',
					'--skip-pdf',
					'--json'
				)
			).stdout
		);
		env.SATURDAY_INSTALLATION_PATH = setup.descriptor_path;
		await run('scripts/start.mjs', '--background', '--json');
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 10000 });
		const page = await browser.newPage(),
			errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.setViewport({ width: 1280, height: 960 });
		await page.goto(base + '/settings#password', { waitUntil: 'networkidle0' });
		await page.type('#enable-password', password);
		await page.type('#enable-confirm', password);
		await page.click('form[action="?/password"] button[type="submit"]');
		await page.waitForSelector('#logout-all');
		await page.waitForNetworkIdle();
		await page.$eval('#password', (element) => element.scrollIntoView());
		await page.screenshot({ path: '/tmp/saturday-password-desktop.png' });
		await page.click('details:has(#disable-password) > summary');
		await page.type('#disable-current', password);
		await page.click('#disable-password button[type="button"]');
		await page.waitForSelector('[role="dialog"]');
		await Promise.all([
			page.waitForNavigation({ waitUntil: 'networkidle0' }),
			page.click('button[form="disable-password"]')
		]);
		await page.waitForSelector('#enable-password');
		assert.equal(JSON.parse(await readFile(join(root, 'access.json'))).password, null);
		assert.equal(await page.$('#logout-all'), null);
		await page.type('#enable-password', password);
		await page.type('#enable-confirm', password);
		await page.click('form[action="?/password"] button[type="submit"]');
		await page.waitForSelector('#logout-all');
		await page.waitForNetworkIdle();
		await page.click('input[name="no_expiration"]');
		assert.equal(await page.$eval('input[name="no_expiration"]', (element) => element.value), 'on');
		await page.click('form[action="?/password"] button[type="submit"]');
		await waitFor(
			async () =>
				JSON.parse(await readFile(join(root, 'access.json'))).idle_timeout_seconds === null
		);
		await page.waitForNetworkIdle();
		assert.equal(await page.$eval('input[name="hours"]', (element) => element.disabled), true);
		await Promise.all([
			page.waitForNavigation({ waitUntil: 'networkidle0' }),
			page.click('form[action="?/logout"] button[type="submit"]')
		]);
		assert.ok(page.url().includes('/signin'));
		await page.setViewport({ width: 390, height: 844 });
		await page.click('details > summary');
		assert.ok(
			(await page.$eval('details', (element) => element.innerText)).includes(
				'MCP tools cannot disable or reset'
			)
		);
		assert.ok(
			(await page.$eval('details', (element) => element.innerText)).includes(
				'disable --installation'
			)
		);
		assert.equal(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
			true
		);
		await page.screenshot({ path: '/tmp/saturday-password-recovery-mobile.png', fullPage: true });
		await page.type('#signin-password', 'incorrect password');
		await page.click('button[type="submit"]');
		await page.waitForFunction(() => document.body.innerText.includes('Incorrect password.'));
		assert.equal(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
			true
		);
		await page.screenshot({ path: '/tmp/saturday-password-mobile.png' });
		await page.$eval('#signin-password', (element) => (element.value = ''));
		await page.type('#signin-password', password);
		await page.click('button[type="submit"]');
		await page.waitForFunction(() => !location.pathname.startsWith('/signin'));
		await page.goto(base + '/settings#password', { waitUntil: 'networkidle0' });
		assert.equal(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
			true
		);
		const card = await page.$('#password');
		await card.screenshot({ path: '/tmp/saturday-password-settings-mobile.png' });
		await page.setViewport({ width: 1280, height: 960 });
		await page.goto(base + '/jobs/new', { waitUntil: 'networkidle0' });
		await page.type('input[name="job_title"]', 'Unsaved authentication draft');
		await page.type('input[name="company_name"]', 'Draft company');
		const operator = await browser.createBrowserContext(),
			admin = await operator.newPage();
		await admin.goto(base + '/signin', { waitUntil: 'networkidle0' });
		await admin.type('#signin-password', password);
		await admin.click('button[type="submit"]');
		await admin.waitForFunction(() => !location.pathname.startsWith('/signin'));
		await admin.goto(base + '/settings#password', { waitUntil: 'networkidle0' });
		const logoutButton = await admin.evaluateHandle(() =>
			[...document.querySelectorAll('button')].find(
				(element) => element.textContent?.trim() === 'Log out all devices'
			)
		);
		await logoutButton.asElement().click();
		await admin.waitForSelector('[role="dialog"]');
		await Promise.all([
			admin.waitForNavigation({ waitUntil: 'networkidle0' }),
			admin.click('button[form="logout-all"]')
		]);
		await page.bringToFront();
		await page.click('button[type="submit"]');
		await page.waitForFunction(() =>
			document.body.innerText.includes('Session expired — sign in, then retry')
		);
		assert.ok(page.url().endsWith('/jobs/new'));
		assert.equal(
			await page.$eval('input[name="job_title"]', (element) => element.value),
			'Unsaved authentication draft'
		);
		assert.equal(
			await page.$eval('input[name="company_name"]', (element) => element.value),
			'Draft company'
		);
		assert.equal(await page.$eval('form', (element) => element.getAttribute('aria-busy')), null);
		await page.screenshot({ path: '/tmp/saturday-password-expired-draft.png' });
		const signin = await browser.newPage();
		await signin.goto(base + '/signin', { waitUntil: 'networkidle0' });
		await signin.type('#signin-password', password);
		await signin.click('button[type="submit"]');
		await signin.waitForFunction(() => !location.pathname.startsWith('/signin'));
		await page.bringToFront();
		await page.click('button[type="submit"]');
		await page.waitForFunction(() => /^\/jobs\/\d+$/.test(location.pathname));
		await page.waitForFunction(() =>
			document.querySelector('h1')?.textContent?.includes('Unsaved authentication draft')
		);
		step = 'open documents';
		await page.goto(base + '/documents', { waitUntil: 'networkidle0' });
		step = 'revoke before upload';
		await signin.evaluate(() =>
			fetch('/settings?/logout', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: 'all=true&confirm=true'
			})
		);
		const uploadPath = join(root, 'retained-upload.txt');
		await writeFile(uploadPath, 'Upload remains available after session revocation.');
		step = 'select upload';
		await (await page.$('input[type="file"]')).uploadFile(uploadPath);
		await page.waitForFunction(() =>
			document.body.innerText.includes('Selected file: retained-upload.txt')
		);
		step = 'open sign-in for upload';
		await signin.bringToFront();
		await signin.goto(base + '/signin', { waitUntil: 'networkidle0' });
		step = 'enter password for upload';
		await signin.type('#signin-password', password);
		step = 'submit password for upload';
		await signin.click('button[type="submit"]');
		await signin.waitForFunction(() => !location.pathname.startsWith('/signin'));
		step = 'return to upload';
		await page.bringToFront();
		await page.waitForFunction(() =>
			[...document.querySelectorAll('button')].some(
				(button) => button.textContent?.trim() === 'Retry upload' && !button.disabled
			)
		);
		const retry = await page.evaluateHandle(() =>
			[...document.querySelectorAll('button')].find(
				(button) => button.textContent?.trim() === 'Retry upload'
			)
		);
		step = 'retry upload';
		await retry.asElement().click();
		await page.waitForFunction(() =>
			[...document.querySelectorAll('a')].some((link) =>
				link.textContent?.includes('retained-upload.txt')
			)
		);
		step = 'revoke before browser Back';
		await signin.evaluate(() =>
			fetch('/settings?/logout', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: 'all=true&confirm=true'
			})
		);
		step = 'browser Back';
		await page.goBack({ waitUntil: 'networkidle0' });
		await page.waitForFunction(
			() =>
				location.pathname === '/signin' ||
				(document.body.innerText.includes('Session expired — sign in, then retry') &&
					getComputedStyle(document.querySelector('.app-shell')).visibility === 'hidden')
		);
		assert.deepEqual(errors, []);
	} catch (error) {
		console.error({ step });
		console.error(
			await readFile(join(root, 'logs/server.log'), 'utf8').catch(() => 'No server log')
		);
		throw error;
	} finally {
		await browser?.close();
		await run('scripts/start.mjs', 'stop', '--json').catch(() => {});
		await waitFor(async () => {
			try {
				const record = JSON.parse(await readFile(join(root, 'server.state/server.json')));
				try {
					process.kill(record.pid, 0);
					return false;
				} catch {
					return true;
				}
			} catch {
				return true;
			}
		}).catch(() => {});
		await rm(root, { recursive: true, force: true });
	}
});
