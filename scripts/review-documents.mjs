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
const networks = await import('../src/lib/server/networks.js');
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
let browser;
const errors = [];
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
	await page.goto(`${base}/profile`, { waitUntil: 'networkidle0' });
	const selectMaster = async () => {
		await page.click('a[href="/profile?select=master_cv"]');
		await page.waitForSelector(`input[type=radio][value="${cv.id}"]`);
		await settled();
		await page.locator(`input[type=radio][value="${cv.id}"]`).click();
		await page.locator('button::-p-text(Use selected file)').click();
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

	await page.click('a[href="/documents/new?designation=cover_letter_template"]');
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
	await page.goto(`${base}/profile`, { waitUntil: 'networkidle0' });
	await settled();
	await page.screenshot({ path: join(scratch, 'profile-mobile.png'), fullPage: true });
	await page.click('a[href="/profile?select=master_cv"]');
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
		await page.evaluate(() => document.activeElement.textContent.includes('Select document')),
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
	await page.locator('button::-p-text(Schedule follow-up)').click();
	await page.waitForSelector('[role=dialog]');
	await settled();
	await page.$eval('#follow_up_date', (e) => {
		e.value = '2000-01-01';
		e.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.type('#follow_up_comment', 'Check in');
	await page.locator('[role=dialog] button::-p-text(Save follow-up)').click();
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
		networks.getNetwork(personId).follow_up_comment,
		'Check in',
		'Interaction preserves follow-up'
	);
	await page.locator('a::-p-text(Link to job)').click();
	await page.waitForSelector('[role=dialog] input[type=radio]');
	await settled();
	await page.click('[role=dialog] input[type=radio]');
	await page.type('#link_notes', 'Hiring manager');
	await page.locator('[role=dialog] button::-p-text(Link job)').click();
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
	await page.locator('[role=dialog] button::-p-text(Link person)').click();
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
	console.log(JSON.stringify({ scratch, errors, job_id: job.id }));
} catch (e) {
	console.error({ scratch, browserErrors: typeof errors !== 'undefined' ? errors : [] });
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
