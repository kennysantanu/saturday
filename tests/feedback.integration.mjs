import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import { createDocument } from '../src/lib/server/files/documents.js';
import { migrateDatabase } from '../src/lib/server/database.js';
import { createJob } from '../src/lib/server/local/jobs.js';

test('feedback: toasts pause and announce, one document picker, tidy menus, sheets clear the keyboard, confirmations lock', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-feedback-'));
	Object.assign(process.env, {
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	migrateDatabase();
	const job = createJob({ job_title: 'Staff Engineer', company_name: 'Acme' });
	await createDocument({ filename: 'resume.md', content: '# Resume\n' });
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
	child.stdout.on('data', (c) => (logs += c));
	child.stderr.on('data', (c) => (logs += c));
	const pause = (ms) => new Promise((r) => setTimeout(r, ms));
	try {
		let ready = false;
		for (let i = 0; i < 150; i++) {
			try {
				if ((await fetch(base)).ok) {
					ready = true;
					break;
				}
			} catch {}
			await pause(100);
		}
		assert(ready, logs);
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 30000 });
		const page = await browser.newPage(),
			errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.setViewport({ width: 1100, height: 900 });
		const click = (selector, label) =>
			page.evaluate(
				(s, l) => {
					const el = [...document.querySelectorAll(s)].find((e) =>
						(e.getAttribute('aria-label') ?? e.textContent).includes(l)
					);
					if (!el) throw new Error(`No ${s} containing ${l}`);
					el.click();
				},
				selector,
				label
			);

		// A toast has a tone, is announced as plain text, and waits while the pointer is on it.
		await page.goto(`${base}/documents?saved=document`, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.toast[data-tone="success"]');
		assert.equal(
			await page.$eval('.sr-only[role="status"]', (e) => e.textContent.trim()),
			'Document saved.'
		);
		assert.ok(await page.$('.toast [aria-label="Dismiss message"]'));
		await page.hover('.toast');
		await pause(6200); // longer than the 5 second default
		assert.ok(await page.$('.toast'), 'a toast waits while hovered');
		await page.mouse.move(5, 5);
		await page.waitForFunction(() => !document.querySelector('.toast'), { timeout: 8000 });

		// A menu with one item draws no divider above it.
		await page.goto(`${base}/jobs/${job.id}`, { waitUntil: 'networkidle0' });
		await pause(300);
		await click('button', 'Job actions');
		await page.waitForSelector('[role="menuitem"]');
		assert.equal((await page.$$('[role="menu"] [role="separator"]')).length, 0);
		await page.keyboard.press('Escape');

		// Copy to this job is the shared document picker.
		await page.goto(`${base}/jobs/${job.id}/documents`, { waitUntil: 'networkidle0' });
		await pause(300);
		await click('button', 'Copy to this job');
		await page.waitForSelector('.link-picker .picker-option');
		assert.match(
			await page.$eval('.link-picker [role="status"]', (e) => e.textContent),
			/1 document/
		);
		await pause(400);
		await page.click('.picker-option');
		assert.equal(await page.$eval('input[name="filename"]', (i) => i.value), 'resume.md');
		await click('.link-picker button', 'Copy resume.md');
		await page.waitForFunction(() => !document.querySelector('.link-picker'));
		await page.waitForFunction(() => document.body.innerText.includes('resume.md'));

		// Sheets rise above the soft keyboard on a phone.
		await page.setViewport({ width: 390, height: 844 });
		await page.goto(`${base}/jobs/${job.id}`, { waitUntil: 'networkidle0' });
		await pause(300);
		await click('button', 'Change stage');
		await page.waitForSelector('[data-slot="dialog-content"]');
		await pause(400);
		const bottom = () =>
			page.$eval(
				'[data-slot="dialog-content"]',
				(e) => window.innerHeight - e.getBoundingClientRect().bottom
			);
		const resting = await bottom();
		await page.evaluate(() =>
			document.documentElement.style.setProperty('--keyboard-inset', '300px')
		);
		await pause(200);
		assert.ok(Math.abs((await bottom()) - resting - 300) < 2, 'the sheet moves up by the inset');
		await page.setViewport({ width: 1100, height: 900 });

		// A confirmation ignores Escape and a second click while its form is being sent.
		await page.goto(`${base}/documents`, { waitUntil: 'networkidle0' });
		await pause(300);
		await page.setRequestInterception(true);
		page.on('request', (request) => {
			if (request.method() === 'POST' && request.url().includes('/delete'))
				setTimeout(() => request.continue().catch(() => {}), 1500);
			else request.continue().catch(() => {});
		});
		await click('button', 'More actions for resume.md');
		await page.waitForSelector('[role="menuitem"]');
		await click('[role="menuitem"]', 'Delete');
		await page.waitForSelector('[data-slot="dialog-content"]');
		await pause(400);
		await click('[data-slot="dialog-footer"] button', 'Delete document');
		await page.waitForSelector('[data-slot="dialog-content"][aria-busy="true"]');
		await page.keyboard.press('Escape');
		await pause(300);
		assert.ok(await page.$('[data-slot="dialog-content"]'), 'Escape is ignored while sending');
		assert.ok(
			await page.$$eval('[data-slot="dialog-footer"] button', (b) => b.every((x) => x.disabled)),
			'both buttons are disabled while sending'
		);
		await page.waitForFunction(() => !document.querySelector('[data-slot="dialog-content"]'), {
			timeout: 10000
		});
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill();
	}
});
