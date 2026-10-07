// Local browser QA using disposable stores. Writes screenshots only to the OS temp directory.
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const scratch = await mkdtemp(join(tmpdir(), 'saturday-documents-ui-'));
process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
process.env.SATURDAY_DB_PATH = join(scratch, 'db.sqlite');
const { createDocument, getDocument } = await import('../src/lib/server/files/documents.js');
const { createJob } = await import('../src/lib/server/services.js');
const cv = await createDocument({
	filename: 'master-cv.md',
	content:
		'# Career history\n\n**Experience** building useful software.\n\n- Engineering\n- Writing'
});
const html = await createDocument({
	filename: 'resume-template.html',
	content:
		'<!doctype html><html><head><style>body{font:16px sans-serif;padding:32px}h1{color:#16324f}</style></head><body><h1>Alex Example</h1><p>Engineer</p><img src="https://example.invalid/probe"><script>fetch("https://example.invalid/probe")</script></body></html>'
});
const job = createJob({ job_title: 'Senior engineer', company_name: 'Example' });
const socket = createServer();
await new Promise((r) => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const child = spawn(process.execPath, ['scripts/start.mjs'], {
	env: { ...process.env, PORT: String(port) },
	stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
child.stderr.on('data', (c) => (logs += c));
let browser;
try {
	const base = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(`${base}/documents`)).ok) break;
		} catch {}
		await new Promise((r) => setTimeout(r, 100));
	}
	browser = await puppeteer.launch({ headless: true });
	const page = await browser.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
	await page.setViewport({ width: 1365, height: 900 });
	const externalRequests = [];
	page.on('request', (request) => {
		if (request.url().startsWith('https://example.invalid')) externalRequests.push(request.url());
	});
	await page.goto(`${base}/documents/${html.id}`, { waitUntil: 'networkidle0' });
	await page.waitForSelector('iframe');
	await new Promise((r) => setTimeout(r, 300));
	assert.deepEqual(externalRequests, [], 'HTML preview must not fetch external resources');
	await page.goto(`${base}/documents`, { waitUntil: 'networkidle0' });
	await page.screenshot({ path: join(scratch, 'desktop.png'), fullPage: true });
	await page.locator('button::-p-text(Select Master CV)').click();
	await page.waitForSelector('input[type=radio]');
	await page.click('input[type=radio]');
	await page.locator('button::-p-text(Use selected file)').click();
	await page.waitForSelector('[data-slot=dialog-overlay]', { hidden: true });
	await page.waitForFunction(() =>
		document.getAnimations().every((a) => a.playState !== 'running')
	);
	await page.waitForSelector('button[aria-label="Remove Master CV designation from master-cv.md"]');
	await page.locator('button[aria-label="Remove Master CV designation from master-cv.md"]').click();
	await page.waitForSelector('[role=dialog]');
	assert.equal((await getDocument({ id: cv.id })).designation, 'master_cv');
	await page.locator('[role=dialog] button::-p-text(Cancel)').click();
	assert.equal((await getDocument({ id: cv.id })).designation, 'master_cv');
	await page.locator('button[aria-label="Remove Master CV designation from master-cv.md"]').click();
	await page.locator('[role=dialog] button::-p-text(Remove designation)').click();
	await page.waitForSelector(
		'button[aria-label="Remove Master CV designation from master-cv.md"]',
		{ hidden: true }
	);
	assert.equal((await getDocument({ id: cv.id })).designation, null);
	await page.waitForFunction(() =>
		document.getAnimations().every((a) => a.playState !== 'running')
	);
	await page.locator('button::-p-text(Select Master CV)').click();
	await page.waitForSelector('input[type=radio]');
	await page.click('input[type=radio]');
	await page.locator('button::-p-text(Use selected file)').click();
	await page.waitForSelector('[data-slot=dialog-overlay]', { hidden: true });
	await page.waitForFunction(() =>
		document.getAnimations().every((a) => a.playState !== 'running')
	);
	await page.waitForSelector('button[aria-label="Remove Master CV designation from master-cv.md"]');
	const uploaded = join(scratch, 'uploaded.txt');
	await writeFile(uploaded, 'Uploaded directly from the picker.');
	const [chooser] = await Promise.all([
		page.waitForFileChooser(),
		page.locator('button::-p-text(Upload)').click()
	]);
	await chooser.accept([uploaded]);
	await page.waitForFunction(() => document.body.textContent.includes('uploaded.txt'));
	assert.equal(await page.$eval('input[type=file]', (e) => e.value), '');
	await page.click('button[aria-label="More actions for master-cv.md"]');
	await page.waitForSelector('[role=menuitem]');
	await page.keyboard.press('Escape');
	await page.focus('button[aria-label="More actions for master-cv.md"]');
	await page.keyboard.press('Enter');
	await page.waitForSelector('[role=menuitem]');
	await page.keyboard.press('ArrowDown');
	await page.locator('[role=menuitem]::-p-text(Rename)').click();
	await page.waitForSelector('[role=dialog] input[name=filename]');
	await new Promise((r) => setTimeout(r, 200));
	assert.ok(
		await page.$eval('[role=dialog]', (e) => e.contains(document.activeElement)),
		'Rename dialog receives focus'
	);
	await page.locator('[role=dialog] button::-p-text(Cancel)').click();
	await page.goto(`${base}/documents/${cv.id}?edit=1`, { waitUntil: 'networkidle0' });
	await page.waitForSelector('.tiptap');
	assert.ok(await page.$eval('.tiptap', (e) => e.textContent.includes('Career history')));
	await page.click('.tiptap');
	await page.keyboard.press('End');
	await page.keyboard.type(' Updated');
	await page.locator('button::-p-text(Save)').click();
	await page.waitForFunction(() => !location.search.includes('edit=1'));
	await page.goto(`${base}/documents/new`, { waitUntil: 'networkidle0' });
	await page.waitForSelector('.tiptap');
	await page.type('input[name=filename]', 'new-note');
	await page.click('.tiptap');
	await page.keyboard.type('A new note');
	await page.locator('button::-p-text(Save)').click();
	await page.waitForFunction(() => !location.pathname.endsWith('/new'));
	await page.goto(`${base}/documents`, { waitUntil: 'networkidle0' });
	await page.setViewport({ width: 390, height: 844 });
	await page.screenshot({ path: join(scratch, 'mobile.png'), fullPage: true });
	assert.ok(
		await page.$$eval('main li', (rows) =>
			rows.every((row) => row.getBoundingClientRect().height < 200)
		),
		'Mobile file rows keep readable filename widths'
	);
	assert.ok(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		'Mobile document page must not overflow'
	);
	await page.locator('button::-p-text(Select Master CV)').click();
	await page.waitForSelector('[role=dialog]');
	await new Promise((r) => setTimeout(r, 400));
	assert.ok(
		await page.$eval('[role=dialog]', (e) => {
			const r = e.getBoundingClientRect();
			return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
		}),
		'Mobile picker stays within viewport'
	);
	await page.screenshot({ path: join(scratch, 'picker-mobile.png'), fullPage: true });
	await page.keyboard.press('Escape');
	await page.goto(`${base}/settings`, { waitUntil: 'networkidle0' });
	assert.ok(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		'Mobile Settings must not overflow'
	);
	await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
	await page.goto(`${base}/documents`, { waitUntil: 'networkidle0' });
	await page.screenshot({ path: join(scratch, 'dark-mobile.png'), fullPage: true });
	await page.setViewport({ width: 683, height: 900 });
	await page.evaluate(() => {
		document.body.style.zoom = '2';
	});
	await page.screenshot({ path: join(scratch, 'zoom.png'), fullPage: true });
	assert.deepEqual(errors, []);
	console.log(JSON.stringify({ scratch, errors, job_id: job.id }));
} catch (e) {
	console.error({ scratch });
	for (const page of (await browser?.pages()) ?? []) {
		await writeFile(join(scratch, 'failed.html'), await page.content());
		await page.screenshot({ path: join(scratch, 'failed.png'), fullPage: true });
	}
	throw e;
} finally {
	await browser?.close();
	child.kill('SIGTERM');
	await new Promise((r) => child.once('close', r));
	await writeFile(join(scratch, 'server.log'), logs);
}
