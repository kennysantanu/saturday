import { listReminders } from '../src/lib/server/local/reminders.js';
// Local browser QA using disposable stores. Writes screenshots only to the OS temp directory.
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { connectMcp } from '../tests/helpers/mcp-client.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const scratch = await mkdtemp(join(tmpdir(), 'saturday-documents-ui-'));
Object.assign(process.env, {
	SATURDAY_PROJECT_ROOT: process.cwd(),
	SATURDAY_INSTALLATION_PATH: '',
	SATURDAY_FILES_PATH: join(scratch, 'files'),
	SATURDAY_DB_PATH: join(scratch, 'db.sqlite'),
	SATURDAY_EXTENSION_STATE_PATH: join(scratch, 'extension-state'),
	SATURDAY_EXTENSIONS_PATH: join(scratch, 'extensions-code')
});
const { createDocument, getDocument } = await import('../src/lib/server/files/documents.js');
const networks = await import('../src/lib/server/local/people.js');
const { createJob, getJob } = await import('../src/lib/server/local/jobs.js');
const { listWorkflowStages } = await import('../src/lib/server/local/workflow.js');
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
const extensionService = await import('../src/lib/server/extensions.js');
const { pathToFileURL } = await import('node:url');
const samplePath = new URL('../examples/extensions/interview-practice/', import.meta.url);
const sampleInfo = await extensionService.inspectExtension(samplePath.pathname);
const sampleEntry = {
	id: sampleInfo.manifest.id,
	manifest: sampleInfo.manifest,
	fingerprint: sampleInfo.fingerprint,
	enabled: true,
	source: { type: 'local', reference: samplePath.pathname }
};
const { cp } = await import('node:fs/promises');
process.env.SATURDAY_EXTENSIONS_PATH = join(scratch, 'extensions-code');
await cp(samplePath.pathname, join(process.env.SATURDAY_EXTENSIONS_PATH, 'interview-practice'), {
	recursive: true
});
const { atomicJson } = await import('../src/lib/server/files/store.js');
await extensionService.withExtensionLock(async () => {
	await atomicJson(extensionService.extensionPaths().catalog, {
		version: 1,
		extensions_enabled: false,
		installed: [sampleEntry]
	});
	await extensionService.initializeExtension(sampleEntry, {
		server: () => import(new URL('server.js', samplePath).href)
	});
});
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
let browser, client;
let step = 'startup';
const errors = [];
const verification = {
	format: 'saturday.browser-verification',
	version: 1,
	environment: { platform: process.platform, arch: process.arch, node: process.version },
	manual_review:
		'Visual/font quality, real zoom, screen readers, physical devices and actual assistant clients remain user tests.'
};
try {
	const base = `http://127.0.0.1:${port}`;
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(`${base}/documents`)).ok) break;
		} catch {}
		await new Promise((r) => setTimeout(r, 100));
	}
	browser = await puppeteer.launch({ headless: true });
	verification.environment.browser = await browser.version();
	verification.build = (await (await fetch(`${base}/health`)).json()).build;
	const page = await browser.newPage();
	const settled = async () => {
		await page.waitForNetworkIdle({ idleTime: 100 });
		await page.waitForFunction(() =>
			document.getAnimations().every((a) => a.playState !== 'running')
		);
	};

	page.on('pageerror', (e) => errors.push(e.message));
	await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
	await page.setViewport({ width: 1365, height: 900 });

	await page.goto(`${base}/settings`, { waitUntil: 'networkidle0' });
	assert.equal(await page.$('nav a[href="/extensions"]'), null);
	await page.click('#extensions input[type="checkbox"]');
	await Promise.all([
		page.waitForResponse((r) => r.request().method() === 'POST'),
		page.click('form[action="?/extensions"] button[type="submit"]')
	]);
	await settled();
	assert.ok(await page.$('nav a[href="/extensions"]'));
	await page.goto(`${base}/extensions/interview-practice?new=1`, { waitUntil: 'networkidle0' });
	await page.type('textarea[name="question"]', 'Explain a difficult project');
	await page.type('textarea[name="answer"]', 'Saved example answer');
	await Promise.all([
		page.waitForResponse((r) => r.request().method() === 'POST'),
		page.locator('button::-p-text(Save question)').click()
	]);
	await settled();
	await page.locator('a::-p-text(Explain a difficult project)').click();
	await settled();
	await page.locator('button::-p-text(Practice)').click();
	await settled();
	assert.equal(await page.$eval('textarea[name="answer"]', (e) => e.value), '');
	assert.ok(!(await page.$eval('#main', (e) => e.textContent)).includes('Saved example answer'));
	await page.type('textarea[name="answer"]', 'A practice draft');
	await page.locator('a::-p-text(Add question)').click();
	await page.waitForSelector('[role=dialog]');
	await page.locator('[role=dialog] button::-p-text(Keep editing)').click();
	await settled();
	assert.equal(await page.$eval('textarea[name="answer"]', (e) => e.value), 'A practice draft');
	await Promise.all([
		page.waitForResponse((r) => r.request().method() === 'POST'),
		page.locator('button::-p-text(Save answer)').click()
	]);
	await settled();
	await page.locator('a::-p-text(Explain a difficult project)').click();
	await settled();
	assert.equal(await page.$eval('textarea[name="answer"]', (e) => e.value), 'A practice draft');
	// The sixth destination must also fit the compact top navigation at tablet widths.
	for (const width of [768, 900, 1024, 1280]) {
		await page.setViewport({ width, height: 900 });
		await settled();
		assert.equal(await page.$$eval('.desktop-navigation a', (items) => items.length), 6);
		assert.equal(
			await page.$eval('.navigation-item', (el) => getComputedStyle(el).flexDirection),
			width < 1104 ? 'column' : 'row'
		);
		assert(await page.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
		assert(
			await page.$eval('.desktop-navigation', (el) => {
				const nav = el.getBoundingClientRect();
				const brand = document.querySelector('.topbar-brand').getBoundingClientRect();
				const bar = document.querySelector('.app-topbar').getBoundingClientRect();
				return nav.left >= brand.right && nav.right <= bar.right;
			})
		);
	}
	await page.setViewport({ width: 390, height: 844 });
	await settled();
	assert.ok(await page.$eval('html', (e) => e.scrollWidth <= e.clientWidth + 1));
	assert.equal(
		await page.$$eval(
			'.tab-bar .tab-item',
			(items) => new Set(items.map((item) => item.offsetTop)).size
		),
		1,
		'Six navigation items stay on one scrollable row'
	);
	await page.screenshot({ path: join(scratch, 'extensions-mobile.png'), fullPage: true });
	await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
	await page.screenshot({ path: join(scratch, 'extensions-dark.png'), fullPage: true });
	await page.setViewport({ width: 1365, height: 900 });
	await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
	await page.goto(`${base}/extensions`, { waitUntil: 'networkidle0' });
	await page.click('button[aria-label="More actions for Interview Practice"]');
	await page.locator('[role=menuitem]::-p-text(Back up)').click();
	await settled();
	const extBackups = await extensionService.listExtensionBackups();
	assert.equal(extBackups.length, 1);
	await page.click('button[aria-label="More actions for Interview Practice"]');
	await page.locator('[role=menuitem]::-p-text(Restore)').click();
	await page.waitForSelector('[role=dialog]');
	await page.select('[role=dialog] select[name="backup_id"]', extBackups[0].backup_id);
	await Promise.all([
		page.waitForNavigation(),
		page.locator('[role=dialog] button::-p-text(Preview restore)').click()
	]);
	await settled();
	await page.locator('button::-p-text(Restore extension)').click();
	await page.waitForSelector('[role=dialog]');
	await Promise.all([
		page.waitForNavigation(),
		page.locator('[role=dialog] button::-p-text(Restore extension)').click()
	]);
	await settled();
	await page.click('button[aria-label="More actions for Interview Practice"]');
	await page.locator('[role=menuitem]::-p-text(Disable)').click();
	await settled();
	assert.equal(await page.$('a[href="/extensions/interview-practice"]'), null);
	await page.click('button[aria-label="More actions for Interview Practice"]');
	await page.locator('[role=menuitem]::-p-text(Enable)').click();
	await settled();
	assert.ok(await page.$('a[href="/extensions/interview-practice"]'));
	await page.click('button[aria-label="More actions for Interview Practice"]');
	await page.locator('[role=menuitem]::-p-text(Remove extension)').click();
	await page.waitForSelector('[role=dialog]');
	await page.locator('[role=dialog] button::-p-text(Cancel)').click();
	await settled();
	await extensionService.setExtensionsEnabled(false);
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
	step = 'Profile document selection';
	await page.goto(`${base}/profile`, { waitUntil: 'networkidle0' });
	const selectMaster = async () => {
		await page.click('a[href="/profile?select=master_cv"]');
		await page.waitForSelector(`input[type=radio][value="${cv.id}"]`);
		await settled();
		await page.locator(`input[type=radio][value="${cv.id}"]`).click();
		await page.locator('button[type="submit"][form="profile-select"]').click();
		await page.waitForSelector('[role=dialog]', { hidden: true });
		await settled();
	};
	await selectMaster();
	assert.equal((await getDocument({ id: cv.id })).designation, 'master_cv');
	await page.click('button[aria-label="More actions for Master CV"]');
	await page.locator('[role=menuitem]::-p-text(Clear selection)').click();
	await page.waitForSelector('[role=dialog]');
	await page.locator('[role=dialog] button::-p-text(Cancel)').click();
	await settled();
	assert.equal((await getDocument({ id: cv.id })).designation, 'master_cv');
	await page.click('button[aria-label="More actions for Master CV"]');
	await page.locator('[role=menuitem]::-p-text(Clear selection)').click();
	await page.locator('[role=dialog] button::-p-text(Clear selection)').click();
	await page.waitForSelector('[role=dialog]', { hidden: true });
	await settled();
	assert.equal((await getDocument({ id: cv.id })).designation, null);
	await selectMaster();

	step = 'Profile document creation';
	await page.click('button[aria-label="More ways to add Cover letter template"]');
	await page.locator('[role="menuitem"]::-p-text(Create new document)').click();
	await page.waitForSelector('textarea[name=content]');
	await page.type('textarea[name=content]', '<p>Dear hiring team</p>');
	await settled();
	assert.equal(await page.$eval('form[action="?/save"]', (form) => form.checkValidity()), true);
	await Promise.all([
		page.waitForResponse((response) => response.request().method() === 'POST'),
		page.locator('button::-p-text(Save and select)').click()
	]);
	await page.waitForFunction(() => location.pathname === '/profile');
	assert.equal(
		(await getDocument({ designation: 'cover_letter_template', include_content: true })).content,
		'<p>Dear hiring team</p>'
	);
	await settled();
	await page.screenshot({ path: join(scratch, 'profile-desktop.png'), fullPage: true });
	await page.goto(`${base}/documents`, { waitUntil: 'networkidle0' });
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
	step = 'mobile Profile picker';
	await page.goto(`${base}/profile`, { waitUntil: 'networkidle0' });
	await settled();
	await page.screenshot({ path: join(scratch, 'profile-mobile.png'), fullPage: true });
	await page.click('button[aria-label="More actions for Master CV"]');
	await page.locator('[role=menuitem]::-p-text(Choose another document)').click();
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
	await page.waitForSelector('[role=dialog]', { hidden: true });
	await settled();
	assert.ok(
		await page.evaluate(() =>
			document.activeElement.matches('button[aria-label="More actions for Master CV"]')
		),
		'Picker cancellation returns focus to its trigger'
	);
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
	// Network uses the same pages, controls and dialogs, with disposable records.
	await page.setViewport({ width: 1365, height: 900 });
	await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
	step = 'people and relationships';
	await page.goto(`${base}/networks/new`, { waitUntil: 'networkidle0' });
	await page.locator('button::-p-text(Save person)').click();
	await page.waitForSelector('#name[aria-invalid="true"]');
	assert.equal(
		await page.evaluate(() => document.activeElement.id),
		'name',
		'Invalid person field receives focus'
	);
	await page.type('#name', 'Alex Example');
	await page.type('#role', 'Recruiter');
	await page.type('#organization', 'Acme');
	await page.locator('button::-p-text(Save person)').click();
	await page.waitForFunction(() => /\/networks\/[0-9a-f-]+$/.test(location.pathname));
	const personId = new URL(page.url()).pathname.split('/').at(-1);
	await settled();
	await page.locator('button::-p-text(Add reminder)').click();
	await page.waitForSelector('[role=dialog]');
	await settled();
	await page.$eval('#reminder-date', (e) => {
		e.value = '2000-01-01';
		e.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.type('#reminder-note', 'Check in');
	await page.locator('[role=dialog] button[type=submit]::-p-text(Add reminder)').click();
	await page.waitForSelector('[role=dialog]', { hidden: true });
	await settled();
	await page.locator('button::-p-text(Add interaction)').click();
	await page.waitForSelector('[role=dialog]');
	await settled();
	await page.locator('[role=dialog] button::-p-text(Save interaction)').click();
	await page.waitForSelector('#interaction_note[aria-invalid="true"]');
	assert.equal(await page.evaluate(() => document.activeElement.id), 'interaction_note');
	await page.type('#interaction_note', 'Met at a conference.');
	await page.locator('[role=dialog] button::-p-text(Save interaction)').click();
	await page.waitForSelector('[role=dialog]', { hidden: true });
	await settled();
	assert.equal(
		listReminders({ network_id: personId }).reminders[0].note,
		'Check in',
		'Interaction preserves reminder'
	);
	await page.locator('a::-p-text(Link to job)').click();
	await page.waitForSelector('[role=dialog] input[type=radio]');
	await settled();
	await page.click('[role=dialog] input[type=radio]');
	await page.type('#link_notes', 'Hiring manager');
	await page.locator('button[type="submit"][form="network-job-link"]').click();
	await page.waitForSelector('[role=dialog]', { hidden: true });
	await settled();
	assert.equal(networks.listNetworkJobs({ network_id: personId }).total, 1);
	await page.locator('button::-p-text(Edit link note)').click();
	await page.waitForSelector('#relationship_notes');
	await settled();
	await page.type('#relationship_notes', ' and referrer');
	await page.locator('[role=dialog] button::-p-text(Save note)').click();
	await page.waitForSelector('[role=dialog]', { hidden: true });
	await settled();
	assert.equal(
		networks.listNetworkJobs({ network_id: personId }).jobs[0].job_link.notes,
		'Hiring manager and referrer'
	);
	await page.screenshot({ path: join(scratch, 'network-detail-desktop.png'), fullPage: true });
	await page.locator('button::-p-text(Edit interaction)').click();
	await page.waitForSelector('#network-interaction');
	await page.locator('#network-interaction button::-p-text(Delete interaction)').click();
	await page.waitForSelector('button[form="network-interaction"]');
	await settled();
	await page
		.locator(
			'[data-slot="dialog-content"]:has(button[form="network-interaction"]) button::-p-text(Cancel)'
		)
		.click();
	assert.equal(networks.getNetwork(personId).interaction_count, 1);
	await page.waitForSelector('button[form="network-interaction"]', { hidden: true });
	await settled();
	await page.locator('#network-interaction button::-p-text(Delete interaction)').click();
	await page.locator('button[form="network-interaction"]').click();
	await page.waitForSelector('[role=dialog]', { hidden: true });
	await settled();
	assert.equal(networks.getNetwork(personId).interaction_count, 0);
	await page.goto(`${base}/jobs/${job.id}`, { waitUntil: 'networkidle0' });
	assert.ok((await page.content()).includes('Hiring manager and referrer'));
	await page.locator('button::-p-text(Edit link note)').click();
	await page.waitForSelector('#network_relationship_note');
	await settled();
	await page.$eval('#network_relationship_note', (e) => {
		e.value = '';
		e.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.locator('[role=dialog] button::-p-text(Save note)').click();
	await page.waitForSelector('[role=dialog]', { hidden: true });
	await settled();
	assert.equal(networks.listNetworkJobs({ network_id: personId }).jobs[0].job_link.notes, null);
	await page.locator('button[aria-label="Unlink Alex Example"]').click();
	await page.waitForFunction(() => document.body.textContent.includes('No linked people yet'));
	await settled();
	await page.locator('a::-p-text(Link person)').click();
	await page.waitForSelector('[role=dialog]');
	await settled();
	await page.locator('[role=dialog] a::-p-text(Add person)').click();
	await page.waitForSelector('#name');
	await settled();
	await page.type('#name', 'Casey Example');
	await page.locator('button::-p-text(Save person)').click();
	await page.waitForSelector('#job-person-link input[type="radio"]:checked');
	await settled();
	assert.equal(
		networks.listNetworks({ job_id: job.id }).total,
		0,
		'Context creation waits for explicit linking'
	);
	await page.locator('button[type="submit"][form="job-person-link"]').click();
	await page.waitForSelector('[role=dialog]', { hidden: true });
	await settled();
	assert.equal(networks.listNetworks({ job_id: job.id }).total, 1);
	await page.goto(`${base}/networks?role=recruiter&organization=Acme`, {
		waitUntil: 'networkidle0'
	});
	await page.screenshot({ path: join(scratch, 'network-list-desktop.png'), fullPage: true });
	await page.setViewport({ width: 320, height: 740 });
	await page.screenshot({ path: join(scratch, 'network-list-mobile.png'), fullPage: true });
	assert.ok(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		'320px Network list fits'
	);
	assert.ok(
		await page.$$eval('.tab-item span', (labels) =>
			labels.every((e) => {
				const a = e.getBoundingClientRect(),
					b = e.parentElement.getBoundingClientRect();
				return a.left >= b.left && a.right <= b.right;
			})
		),
		'All five mobile navigation labels fit'
	);
	await page.goto(`${base}/networks/${personId}`, { waitUntil: 'networkidle0' });
	await page.locator('button::-p-text(Add interaction)').click();
	await page.waitForSelector('[role=dialog]');
	await settled();
	await new Promise((r) => setTimeout(r, 300));
	assert.ok(
		await page.$eval('[role=dialog]', (e) => {
			const r = e.getBoundingClientRect();
			return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
		}),
		'Network sheet fits narrow viewport'
	);
	await page.screenshot({ path: join(scratch, 'network-dialog-mobile.png'), fullPage: true });
	await page.keyboard.press('Escape');
	await page.waitForSelector('[role=dialog]', { hidden: true });
	await settled();
	await page.emulateMediaFeatures([
		{ name: 'prefers-color-scheme', value: 'dark' },
		{ name: 'prefers-reduced-motion', value: 'reduce' }
	]);
	await settled();
	await page.screenshot({ path: join(scratch, 'network-detail-dark.png'), fullPage: true });
	// Half the CSS viewport with double device scale emulates 200% browser zoom,
	// including media-query reflow, rather than CSS zoom's mismatched breakpoints.
	await page.setViewport({ width: 341, height: 450, deviceScaleFactor: 2 });
	await settled();
	assert.ok(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
		'Network detail supports 200% zoom'
	);
	assert.ok(
		await page.$$eval('.tab-item span', (labels) =>
			labels.every((e) => {
				const a = e.getBoundingClientRect(),
					b = e.parentElement.getBoundingClientRect();
				return a.left >= b.left && a.right <= b.right;
			})
		),
		'Zoomed navigation labels fit'
	);
	await page.screenshot({ path: join(scratch, 'network-zoom.png'), fullPage: true });
	// Broad reflow and labeling checks complement the interactive workflows above.
	for (const scheme of ['light', 'dark']) {
		await page.emulateMediaFeatures([
			{ name: 'prefers-color-scheme', value: scheme },
			{ name: 'prefers-reduced-motion', value: 'reduce' }
		]);
		for (const width of [1365, 320]) {
			await page.setViewport({ width, height: 900 });
			for (const path of [
				'/',
				'/jobs',
				'/jobs/new',
				`/jobs/${job.id}`,
				'/networks',
				`/networks/${personId}`,
				'/documents',
				'/settings'
			]) {
				await page.goto(`${base}${path}`, { waitUntil: 'networkidle0' });
				assert.ok(
					await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
					`${scheme} ${width}px ${path} must fit`
				);
				const unnamed = await page.evaluate(() =>
					[...document.querySelectorAll('main input, main select, main textarea, main button')]
						.filter((e) => {
							if (!e.getClientRects().length || e.type === 'hidden') return false;
							return !(
								e.getAttribute('aria-label') ||
								e.getAttribute('aria-labelledby') ||
								e.labels?.length ||
								(e.tagName === 'BUTTON' && e.textContent.trim())
							);
						})
						.map((e) => e.outerHTML)
				);
				assert.deepEqual(unnamed, [], `Visible controls need names: ${path}`);
				await page.screenshot({
					path: join(scratch, `${scheme}-${width}-${path.replaceAll('/', '_') || 'dashboard'}.png`),
					fullPage: true
				});
			}
		}
	}
	await page.goto(`${base}/jobs/new`, { waitUntil: 'networkidle0' });
	await page.locator('button::-p-text(Save job)').click();
	await page.waitForSelector('#job_title[aria-invalid="true"]');
	assert.equal(await page.evaluate(() => document.activeElement.id), 'job_title');
	assert.ok(
		await page.$eval('#job_title', (e) =>
			document.getElementById(e.getAttribute('aria-describedby')).textContent.trim()
		),
		'Invalid field describes its error'
	);
	await page.type('#job_title', 'Unsaved job');
	await page.locator('a::-p-text(Cancel)').click();
	await page.waitForSelector('[role=dialog]');
	await page.waitForFunction(() =>
		document.querySelector('[role=dialog]').contains(document.activeElement)
	);
	for (let i = 0; i < 8; i++) {
		await page.keyboard.press('Tab');
		assert.ok(
			await page.$eval('[role=dialog]', (e) => e.contains(document.activeElement)),
			'Dialog traps keyboard focus'
		);
	}
	await page.keyboard.press('Escape');
	await page.waitForSelector('[role=dialog]', { hidden: true });
	await settled();
	assert.equal(
		await page.$eval('#job_title', (e) => e.value),
		'Unsaved job',
		'Cancel keeps unsaved input'
	);
	await page.locator('a::-p-text(Cancel)').click();
	await page.waitForSelector('[role=dialog]');
	await page.locator('[role=dialog] button::-p-text(Discard changes)').click();
	await page.waitForFunction(() => location.pathname === '/jobs');
	// One continuous release workflow catches integration gaps between otherwise
	// independently tested features. Start from Dashboard rather than seeded detail.
	step = 'continuous job workflow';
	await page.setViewport({ width: 1280, height: 900 });
	await page.goto(base, { waitUntil: 'networkidle0' });
	await page.locator('.desktop-navigation a[href="/jobs"]').click();
	await page.waitForFunction(() => location.pathname === '/jobs');
	await page.locator('main a::-p-text(Add job)').click();
	await page.waitForSelector('#job_title');
	await settled();
	await page.type('#job_title', 'Release workflow engineer');
	await page.type('#company_name', 'Fictional Release Labs');
	await page.locator('button::-p-text(Create a tag)').click();
	await page
		.locator('[role="group"][aria-label="Create tag"] input[id$="-name"]')
		.fill('Release QA');
	await page.locator('[role="group"][aria-label="Create tag"] input[id$="-hex"]').fill('#2468AC');
	await page.locator('button::-p-text(Create tag)').click();
	await page.waitForFunction(
		() =>
			document.querySelector('.tag-choice input:checked') ||
			document.querySelector('[role="group"][aria-label="Tags"] [role="alert"]')
	);
	assert.ok(
		await page.$('.tag-choice input:checked'),
		await page.$eval('main', (e) => e.textContent)
	);
	assert.equal(await page.$eval('#job_title', (e) => e.value), 'Release workflow engineer');
	await page.locator('button::-p-text(Save job)').click();
	await page.waitForFunction(() => /^\/jobs\/\d+$/.test(location.pathname));
	await settled();
	const workflowId = Number(new URL(page.url()).pathname.split('/').at(-1));
	const createdJob = getJob(workflowId);
	assert.equal(new URL(page.url()).searchParams.get('return_to'), '/jobs');
	assert.equal(createdJob.tags[0].name, 'release_qa');
	assert.equal(createdJob.tags[0].color, '#2468ac');
	await page.goto(`${base}/jobs`, { waitUntil: 'networkidle0' });
	await page.locator('#query').fill('Release workflow');
	await page.select('#sort', 'created');
	await page.waitForFunction(() => new URL(location.href).searchParams.get('sort') === 'created');
	await settled();
	await page.locator('button.filter-toggle').click();
	await page.waitForSelector('.filter-panel:not(.is-collapsed)');
	await page.click(`[data-choice="${createdJob.tags[0].id}"] input`);
	await page.locator('button::-p-text(Apply filters)').click();
	await page.waitForFunction(
		(id) => new URL(location.href).searchParams.getAll('tag_ids').includes(String(id)),
		{},
		createdJob.tags[0].id
	);
	await settled();
	const filters = new URL(page.url()).search;
	assert.equal(new URL(page.url()).searchParams.get('sort'), 'created');
	assert.deepEqual(new URL(page.url()).searchParams.getAll('tag_ids'), [
		String(createdJob.tags[0].id)
	]);
	assert.equal(await page.$$eval(`a[href^="/jobs/${workflowId}?"]`, (els) => els.length), 1);
	assert.equal(await page.$(`a[href^="/jobs/${job.id}?"]`), null);
	await page.locator(`a[href^="/jobs/${workflowId}?"]`).click();
	await page.waitForSelector('button::-p-text(Change stage)');
	await settled();
	assert.equal(new URL(page.url()).searchParams.get('return_to'), '/jobs' + filters);
	const applied = listWorkflowStages().find((stage) => stage.name === 'Applied');
	const interview = listWorkflowStages().find((stage) => stage.name === 'Interview');
	const saveHistory = async () => {
		await page.click('#job-update-form button[type="submit"]:not([formaction])');
		await page.waitForSelector('[role="dialog"]', { hidden: true });
		await settled();
	};
	await page.locator('button::-p-text(Change stage)').click();
	await page.waitForSelector('#move-stage');
	await settled();
	await page.select('#move-stage', String(applied.id));
	await page.type('#move-note', 'Application submitted');
	await page.click('input[name="add_reminder"]');
	await page.locator('#history-reminder-date').fill('2099-08-01');
	assert.equal(await page.$eval('#history-reminder-time', (e) => e.value), '00:00');
	await page.locator('#history-reminder-note').fill('Check application progress');
	await saveHistory();
	assert.equal(getJob(workflowId).currentStageId, applied.id);
	const reminder = listReminders({ job_id: workflowId }).reminders[0];
	assert.equal(reminder.scheduled_at, '2099-08-01T00:00');
	await page.click('button::-p-text(Add history)');
	await page.waitForSelector('#history-stage');
	await settled();
	await page.select('#history-stage', String(interview.id));
	await page.locator('#history-date').fill('2099-08-02');
	await page.type('#history-note', 'Scheduled interview');
	await saveHistory();
	const milestone = getJob(workflowId).updates.find(
		(entry) => entry.note === 'Scheduled interview'
	);
	assert.equal(getJob(workflowId).currentStageId, applied.id);
	await page.click('button[aria-label^="Edit history: Interview"]');
	await page.waitForSelector('#correction-note');
	await settled();
	await page.locator('#correction-note').fill('Interview details corrected');
	await saveHistory();
	assert.equal(getJob(workflowId).currentStageId, applied.id);
	assert.equal(
		getJob(workflowId).updates.find((entry) => entry.id === milestone.id).note,
		'Interview details corrected'
	);
	assert.equal(listReminders({ job_id: workflowId }).reminders[0].note, reminder.note);
	await page
		.locator(`[data-reminder-id="${reminder.id}"] button::-p-text(Dismiss reminder)`)
		.click();
	await settled();
	assert.equal(listReminders({ job_id: workflowId }).total, 0);
	assert.equal(
		listReminders({ job_id: workflowId, view: 'inactive' }).reminders[0].id,
		reminder.id
	);
	assert.equal(getJob(workflowId).currentStageId, applied.id);
	await page.screenshot({ path: join(scratch, 'release-workflow.png'), fullPage: true });
	await page.goto(base, { waitUntil: 'networkidle0' });
	assert.ok(await page.$(`.pipeline-column a[href^="/jobs/${workflowId}?"]`));
	assert.ok(!(await page.$eval('main', (e) => e.textContent)).includes(reminder.note));
	verification.continuous_workflow =
		'passed: Dashboard to Jobs, create job with inline tag, search/tag/sort, stage plus reminder, independent scheduled history/edit, dismiss reminder and Dashboard';
	// Verify browser and a reconnected stdio client see the same stored job/build.
	step = 'MCP reads, write, reconnect and help';
	client = await connectMcp();
	const info = await client.call('get_saturday_info');
	assert.equal(info.build.id, verification.build.id);
	assert.equal(client.initialized.serverInfo.version, verification.build.id);
	assert.equal((await client.call('get_job', { job_id: workflowId })).current_stage_id, applied.id);
	await client.call('edit_job', {
		job_id: workflowId,
		notes: 'Updated through the release protocol check'
	});
	await page.goto(`${base}/jobs/${workflowId}`, { waitUntil: 'networkidle0' });
	assert.ok((await page.content()).includes('Updated through the release protocol check'));
	await client.close();
	client = await connectMcp();
	assert.equal(
		(await client.call('get_job', { job_id: workflowId })).notes,
		'Updated through the release protocol check'
	);
	const help = await client.call('search_documentation', { query: 'reminders' });
	assert.ok(help.results.length);
	const hit = help.results[0];
	assert.ok(
		(
			await client.call('read_documentation', {
				document_id: hit.document_id,
				section_id: hit.section_id
			})
		).markdown.length
	);
	verification.mcp =
		'passed: matching web/protocol identity, reads, write visible in browser, reconnect and bundled help';
	// Keep the actual generated PDF and HTML outside the checkout for user review.
	step = 'HTTP PDF generation and download';
	const pdfSource =
		'<!doctype html><html lang="en"><meta charset="utf-8"><title>Fictional release CV</title><style>@page{size:A4;margin:18mm}body{font:11pt sans-serif;line-height:1.5}h1{font-size:24pt}h2{font-size:14pt}</style><h1>Alex Example</h1><p>Fictional software engineer · person@example.invalid</p><h2>Experience</h2><p>Built accessible tools for a fictional team.</p><ul><li>Application design and testing</li><li>Résumé and document workflows</li></ul><h2>Education</h2><p>Example University · Computer Science</p></html>';
	const source = await createDocument({ filename: 'release-review.html', content: pdfSource });
	await page.goto(`${base}/documents/${source.id}`, { waitUntil: 'networkidle0' });
	assert.ok(await page.$('form[action="?/pdf"] button[type="submit"]'));
	// Exercise the real form action without opening Chrome's embedded PDF viewer:
	// that viewer prevents reliable headless network-idle checks on later pages.
	const generated = await fetch(`${base}/documents/${source.id}?/pdf`, {
		method: 'POST',
		headers: {
			origin: base,
			accept: 'text/html',
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({ token: source.token }),
		redirect: 'manual'
	});
	assert.equal(generated.status, 303);
	const pdfId = new URL(generated.headers.get('location'), base).pathname.split('/').at(-1);
	const downloadPdf = await fetch(`${base}/api/files/${pdfId}`);
	assert.equal(downloadPdf.status, 200);
	const pdfBytes = Buffer.from(await downloadPdf.arrayBuffer());
	assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
	assert.match(pdfBytes.subarray(-1024).toString(), /%%EOF\s*$/);
	assert.ok(pdfBytes.length > 1000);
	assert.equal((await getDocument({ id: source.id, include_content: true })).content, pdfSource);
	await writeFile(join(scratch, 'release-review.pdf'), pdfBytes);
	await writeFile(join(scratch, 'release-review.html'), pdfSource);
	step = 'invalid PDF preserves HTML source';
	const badSource = '<style>@page{size:100in}</style><p>Keep this failed source.</p>';
	const badPdf = await createDocument({ filename: 'failed-pdf.html', content: badSource });
	await page.goto(`${base}/documents/${badPdf.id}`, { waitUntil: 'networkidle0' });
	await page.locator('button::-p-text(Generate PDF)').click();
	await page.waitForSelector('[role="alert"]');
	await settled();
	assert.equal(new URL(page.url()).pathname, `/documents/${badPdf.id}`);
	assert.equal((await getDocument({ id: badPdf.id, include_content: true })).content, badSource);
	assert.equal((await getDocument({ id: badPdf.id })).token, badPdf.token);
	await writeFile(join(scratch, 'failed-pdf.html'), badSource);
	await page.screenshot({ path: join(scratch, 'pdf-failure.png'), fullPage: true });
	verification.pdf = {
		status: 'passed',
		bytes: pdfBytes.length,
		sha256: createHash('sha256').update(pdfBytes).digest('hex'),
		checks:
			'HTTP form generation/download, PDF signature/EOF, unchanged HTML and browser invalid-page failure; embedded viewer and visual acceptance deferred'
	};
	step = 'no-JavaScript filters';
	const noJs = await browser.newPage();
	await noJs.setJavaScriptEnabled(false);
	await noJs.goto(`${base}/networks?organization=Acme&role=recruiter`, {
		waitUntil: 'networkidle0'
	});
	assert.ok((await noJs.content()).includes('Alex Example'));
	assert.equal(await noJs.$eval('#role', (e) => e.value), 'recruiter');
	await noJs.$eval('#organization', (e) => {
		e.value = 'Missing';
	});
	await Promise.all([noJs.waitForNavigation(), noJs.click('button[type=submit]')]);
	assert.ok(
		(await noJs.content()).includes('No matching people'),
		'GET filters work without JavaScript'
	);
	await noJs.close();
	assert.deepEqual(errors, []);
	await writeFile(
		join(scratch, 'verification.json'),
		JSON.stringify({ ...verification, errors }, null, 2) + '\n'
	);
	console.log(JSON.stringify({ scratch, errors, job_id: job.id }));
} catch (e) {
	console.error({ scratch, step, error: e.message, browserErrors: errors });
	for (const [index, page] of ((await browser?.pages()) ?? []).entries()) {
		await writeFile(join(scratch, `failed-${index}.html`), await page.content());
		await page
			.screenshot({ path: join(scratch, `failed-${index}.png`), fullPage: true, timeout: 5000 })
			.catch(() => {});
	}
	throw e;
} finally {
	await client?.close();
	await browser?.close();
	child.kill('SIGTERM');
	await new Promise((r) => child.once('close', r));
	await writeFile(join(scratch, 'server.log'), logs);
}
