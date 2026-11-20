import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import { createJob } from '../src/lib/server/local/jobs.js';
import { withDatabase } from '../src/lib/server/database.js';
import * as networks from '../src/lib/server/local/people.js';

function extractNativeConfirmForm(html, pageUrl) {
	const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
	const match = forms.find(([, , body]) => /name="confirm_note_loss"\s+value="1"/i.test(body));
	assert(match, 'Expected native confirm form with confirm_note_loss=1 in 409 HTML');
	const [, attrs, body] = match;
	const actionMatch = attrs.match(/\baction="([^"]+)"/i);
	assert(actionMatch, 'Expected action attribute on native confirm form');
	const actionUrl = new URL(actionMatch[1].replaceAll('&amp;', '&'), pageUrl);
	const values = {};
	for (const [, tag] of body.matchAll(/<input\b([^>]*?)>/gi)) {
		const name = tag.match(/\bname="([^"]+)"/i)?.[1];
		const value = tag.match(/\bvalue="([^"]*)"/i)?.[1];
		if (name !== undefined && value !== undefined) values[name] = value;
	}
	assert.equal(values.confirm_note_loss, '1');
	return { path: actionUrl.pathname + actionUrl.search, values };
}

test('unlinking a job-person link confirms when a relationship note would be lost, skips confirmation without a note, and enforces 409 server-side', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-unlink-confirm-'));
	Object.assign(process.env, {
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});

	const jobA = createJob({ job_title: 'Platform Engineer', company_name: 'Acme' });
	const jobB = createJob({ job_title: 'Staff Architect', company_name: 'Beta' });
	const jobNoNote = createJob({ job_title: 'Systems Analyst', company_name: 'Gamma' });
	const jobWhitespaceNote = createJob({ job_title: 'Release Engineer', company_name: 'Delta' });
	const jobNoJs = createJob({ job_title: 'Frontend Lead', company_name: 'Epsilon' });
	const jobForeignOnly = createJob({ job_title: 'Security Engineer', company_name: 'Zeta' });
	const personWithNote = networks.createNetwork({ name: 'Dana Referrer' });
	const personWithoutNote = networks.createNetwork({ name: 'Morgan Plain' });
	const personNoJs = networks.createNetwork({ name: 'Riley Native' });
	const personOther = networks.createNetwork({ name: 'Casey Other' });

	networks.linkJobNetwork({
		job_id: jobA.id,
		network_id: personWithNote.id,
		notes: 'Met at PMI chapter, referred by Dana'
	});
	networks.linkJobNetwork({
		job_id: jobB.id,
		network_id: personWithNote.id,
		notes: 'Second job note'
	});
	networks.linkJobNetwork({
		job_id: jobA.id,
		network_id: personWithoutNote.id
	});
	networks.linkJobNetwork({
		job_id: jobNoNote.id,
		network_id: personWithNote.id
	});
	networks.linkJobNetwork({
		job_id: jobWhitespaceNote.id,
		network_id: personWithNote.id
	});
	withDatabase((db) => {
		db.prepare('UPDATE job_networks SET notes=? WHERE job_id=? AND network_id=?').run(
			'   \t\n  ',
			jobWhitespaceNote.id,
			personWithNote.id
		);
	});
	// Dedicated links for no-JS confirm completion on both routes.
	networks.linkJobNetwork({
		job_id: jobA.id,
		network_id: personNoJs.id,
		notes: 'No-JS job-side note'
	});
	networks.linkJobNetwork({
		job_id: jobNoJs.id,
		network_id: personNoJs.id,
		notes: 'No-JS person-side note'
	});
	// Unrelated links for forged route-owned ID tests.
	networks.linkJobNetwork({
		job_id: jobB.id,
		network_id: personOther.id,
		notes: 'Other person note on shared job'
	});
	networks.linkJobNetwork({
		job_id: jobForeignOnly.id,
		network_id: personOther.id,
		notes: 'Foreign-only link note'
	});

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

		const rawPost = (path, values) =>
			fetch(base + path, {
				method: 'POST',
				headers: {
					origin: base,
					accept: 'text/html',
					'content-type': 'application/x-www-form-urlencoded'
				},
				body: new URLSearchParams(values),
				redirect: 'manual'
			});

		// Server-side authority: raw POST without confirm_note_loss returns 409 and keeps the link + note.
		const refusedJobSide = await rawPost(`/jobs/${jobA.id}?/networkUnlink`, {
			network_id: String(personWithNote.id)
		});
		assert.equal(refusedJobSide.status, 409);
		const refusedJobHtml = await refusedJobSide.text();
		assert.match(refusedJobHtml, /Unlink and lose the note\?/);
		assert(
			refusedJobHtml.includes(
				`Unlink Dana Referrer (#${personWithNote.id})? The note saved on this link will be deleted with it.`
			),
			'Expected disambiguated person warning and note-loss sentence in job-side 409 HTML'
		);
		assert(
			refusedJobHtml.includes('Met at PMI chapter, referred by Dana'),
			'Expected clamped note text in job-side 409 HTML'
		);
		assert.match(refusedJobHtml, /name="confirm_note_loss" value="1"/);
		// Refusal Notice renders at the top of the page (above History/Network), visible without scrolling.
		assert(
			refusedJobHtml.indexOf('Unlink and lose the note?') <
				refusedJobHtml.indexOf('id="job-history"'),
			'Expected job-side 409 Notice to render near the top of the page above History'
		);
		assert.equal(
			networks.jobLinkNote({ job_id: jobA.id, network_id: personWithNote.id }).note,
			'Met at PMI chapter, referred by Dana'
		);

		const refusedPersonSide = await rawPost(`/networks/${personWithNote.id}?/unlink`, {
			job_id: String(jobB.id)
		});
		assert.equal(refusedPersonSide.status, 409);
		const refusedPersonHtml = await refusedPersonSide.text();
		assert.match(refusedPersonHtml, /Unlink and lose the note\?/);
		assert(
			refusedPersonHtml.includes(
				`Unlink Staff Architect at Beta (#${jobB.id})? The note saved on this link will be deleted with it.`
			),
			'Expected disambiguated job warning and note-loss sentence in person-side 409 HTML'
		);
		assert(
			refusedPersonHtml.includes('Second job note'),
			'Expected clamped note text in person-side 409 HTML'
		);
		assert.match(refusedPersonHtml, /name="confirm_note_loss" value="1"/);
		// Refusal Notice renders at the top of the page (above Details/Reminders/Linked jobs), visible without scrolling.
		assert(
			refusedPersonHtml.indexOf('Unlink and lose the note?') <
				refusedPersonHtml.indexOf('Linked jobs'),
			'Expected person-side 409 Notice to render near the top of the page above Linked jobs'
		);
		assert(
			refusedPersonHtml.indexOf('Unlink and lose the note?') <
				refusedPersonHtml.indexOf('Reminders'),
			'Expected person-side 409 Notice to render near the top of the page above Reminders'
		);
		assert.equal(
			networks.jobLinkNote({ job_id: jobB.id, network_id: personWithNote.id }).note,
			'Second job note'
		);

		// No-JS confirm completion: extract the native 409 confirm form and POST it on both routes,
		// preserving return_to and page params while dropping the action key.
		const jobReturnTo = '/jobs?view=all';
		const noJsJobQuery = `return_to=${encodeURIComponent(jobReturnTo)}&network_page=1`;
		const noJsJobPage = await fetch(`${base}/jobs/${jobA.id}?${noJsJobQuery}`);
		assert.equal(noJsJobPage.status, 200);
		const noJsJobRefused = await rawPost(`/jobs/${jobA.id}?/networkUnlink&${noJsJobQuery}`, {
			network_id: String(personNoJs.id)
		});
		assert.equal(noJsJobRefused.status, 409);
		const noJsJobRefusedHtml = await noJsJobRefused.text();
		assert(
			noJsJobRefusedHtml.includes(
				`Unlink Riley Native (#${personNoJs.id})? The note saved on this link will be deleted with it.`
			)
		);
		const jobConfirmForm = extractNativeConfirmForm(
			noJsJobRefusedHtml,
			`${base}/jobs/${jobA.id}?${noJsJobQuery}`
		);
		assert.equal(jobConfirmForm.values.network_id, String(personNoJs.id));
		const noJsJobConfirmed = await rawPost(jobConfirmForm.path, jobConfirmForm.values);
		assert.equal(noJsJobConfirmed.status, 303);
		const jobRedirectLocation = new URL(noJsJobConfirmed.headers.get('location') ?? '', base);
		assert.equal(jobRedirectLocation.pathname, `/jobs/${jobA.id}`);
		assert.equal(jobRedirectLocation.searchParams.get('return_to'), jobReturnTo);
		assert.equal(jobRedirectLocation.searchParams.get('network_page'), '1');
		assert.equal(jobRedirectLocation.searchParams.get('saved'), 'network-unlinked');
		assert.equal(
			[...jobRedirectLocation.searchParams.keys()].some((k) => k.startsWith('/')),
			false,
			'Expected job-side confirmed redirect to drop the action key'
		);
		assert.equal(networks.jobLinkNote({ job_id: jobA.id, network_id: personNoJs.id }).note, null);
		assert.equal(networks.networkLinkIds({ job_id: jobA.id }).includes(personNoJs.id), false);

		const personReturnTo = '/networks?sort=name';
		const noJsPersonQuery = `return_to=${encodeURIComponent(personReturnTo)}&jobs_page=1`;
		const noJsPersonPage = await fetch(`${base}/networks/${personNoJs.id}?${noJsPersonQuery}`);
		assert.equal(noJsPersonPage.status, 200);
		const noJsPersonRefused = await rawPost(
			`/networks/${personNoJs.id}?/unlink&${noJsPersonQuery}`,
			{
				job_id: String(jobNoJs.id)
			}
		);
		assert.equal(noJsPersonRefused.status, 409);
		const noJsPersonRefusedHtml = await noJsPersonRefused.text();
		assert(
			noJsPersonRefusedHtml.includes(
				`Unlink Frontend Lead at Epsilon (#${jobNoJs.id})? The note saved on this link will be deleted with it.`
			)
		);
		const personConfirmForm = extractNativeConfirmForm(
			noJsPersonRefusedHtml,
			`${base}/networks/${personNoJs.id}?${noJsPersonQuery}`
		);
		assert.equal(personConfirmForm.values.job_id, String(jobNoJs.id));
		const noJsPersonConfirmed = await rawPost(personConfirmForm.path, personConfirmForm.values);
		assert.equal(noJsPersonConfirmed.status, 303);
		const personRedirectLocation = new URL(noJsPersonConfirmed.headers.get('location') ?? '', base);
		assert.equal(personRedirectLocation.pathname, `/networks/${personNoJs.id}`);
		assert.equal(personRedirectLocation.searchParams.get('return_to'), personReturnTo);
		assert.equal(personRedirectLocation.searchParams.get('jobs_page'), '1');
		assert.equal(personRedirectLocation.searchParams.get('saved'), 'network-unlinked');
		assert.equal(
			[...personRedirectLocation.searchParams.keys()].some((k) => k.startsWith('/')),
			false,
			'Expected person-side confirmed redirect to drop the action key'
		);
		assert.equal(
			networks.jobLinkNote({ job_id: jobNoJs.id, network_id: personNoJs.id }).note,
			null
		);
		assert.equal(
			networks.networkLinkIds({ network_id: personNoJs.id }).includes(jobNoJs.id),
			false
		);

		// Forged route-owned ID: person route ignores forged network_id and protects unrelated links.
		const forgedPersonShared = await rawPost(`/networks/${personWithNote.id}?/unlink`, {
			job_id: String(jobB.id),
			network_id: String(personOther.id)
		});
		assert(
			forgedPersonShared.status === 409 || forgedPersonShared.status === 404,
			`Expected 409 or 404, got ${forgedPersonShared.status}`
		);
		assert.equal(
			networks.jobLinkNote({ job_id: jobB.id, network_id: personOther.id }).note,
			'Other person note on shared job'
		);
		assert.equal(
			networks.jobLinkNote({ job_id: jobB.id, network_id: personWithNote.id }).note,
			'Second job note'
		);
		// Even with confirm_note_loss=1 and a job_id belonging only to personOther, personOther's link survives.
		await rawPost(`/networks/${personWithNote.id}?/unlink`, {
			job_id: String(jobForeignOnly.id),
			network_id: String(personOther.id),
			confirm_note_loss: '1'
		});
		assert.equal(
			networks.jobLinkNote({ job_id: jobForeignOnly.id, network_id: personOther.id }).note,
			'Foreign-only link note'
		);

		// Forged route-owned ID: job route ignores forged job_id and protects unrelated links.
		const forgedJobShared = await rawPost(`/jobs/${jobA.id}?/networkUnlink`, {
			network_id: String(personWithNote.id),
			job_id: String(jobB.id)
		});
		assert(
			forgedJobShared.status === 409 || forgedJobShared.status === 404,
			`Expected 409 or 404, got ${forgedJobShared.status}`
		);
		assert.equal(
			networks.jobLinkNote({ job_id: jobB.id, network_id: personWithNote.id }).note,
			'Second job note'
		);
		assert.equal(
			networks.jobLinkNote({ job_id: jobA.id, network_id: personWithNote.id }).note,
			'Met at PMI chapter, referred by Dana'
		);
		// Even with confirm_note_loss=1 and a foreign network_id belonging only to jobB, jobB's link survives.
		await rawPost(`/jobs/${jobA.id}?/networkUnlink`, {
			network_id: String(personOther.id),
			job_id: String(jobB.id),
			confirm_note_loss: '1'
		});
		assert.equal(
			networks.jobLinkNote({ job_id: jobB.id, network_id: personOther.id }).note,
			'Other person note on shared job'
		);

		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage();
		const pageErrors = [];
		page.on('pageerror', (e) => pageErrors.push(e.message));
		await page.setViewport({ width: 1280, height: 900 });
		const settle = () => page.waitForNetworkIdle({ idleTime: 300 });

		// 1. Job detail page: unlink person WITH note -> dialog appears, Cancel preserves link and note.
		await page.goto(`${base}/jobs/${jobA.id}`, { waitUntil: 'networkidle0' });
		await page.locator('button[aria-label="Unlink Dana Referrer"]').click();
		await page.waitForSelector('[role="dialog"]');
		const jobDialogText = await page.$eval('[role="dialog"]', (el) => el.textContent ?? '');
		assert.match(jobDialogText, /Unlink and lose the note\?/);
		assert(
			jobDialogText.includes(
				`Unlink Dana Referrer (#${personWithNote.id})? The note saved on this link will be deleted with it.`
			)
		);
		assert(jobDialogText.includes('Met at PMI chapter, referred by Dana'));
		assert.doesNotMatch(jobDialogText, /Staff Architect/);

		await page.locator('[role="dialog"] button::-p-text(Cancel)').click();
		await page.waitForSelector('[role="dialog"]', { hidden: true });
		await page.reload({ waitUntil: 'networkidle0' });
		assert.equal(
			networks.jobLinkNote({ job_id: jobA.id, network_id: personWithNote.id }).note,
			'Met at PMI chapter, referred by Dana'
		);
		assert.match(await page.content(), /Met at PMI chapter, referred by Dana/);

		// 2. Job detail page: confirm unlink -> link and note are removed, no Undo offered.
		await page.locator('button[aria-label="Unlink Dana Referrer"]').click();
		await page.waitForSelector('[role="dialog"]');
		await page.locator('[role="dialog"] button[type="submit"]').click();
		await page.waitForSelector('[role="dialog"]', { hidden: true });
		await settle();
		assert.equal(
			networks.jobLinkNote({ job_id: jobA.id, network_id: personWithNote.id }).note,
			null
		);
		assert.equal(networks.networkLinkIds({ job_id: jobA.id }).includes(personWithNote.id), false);
		assert.equal(
			await page.$$eval('button', (buttons) =>
				buttons.some((b) => /\bundo\b/i.test(b.textContent ?? ''))
			),
			false
		);

		// 3. Job detail page: unlink person WITHOUT note -> no dialog, unlinks in one step.
		let dialogOpened = false;
		await page.exposeFunction('__markDialog', () => {
			dialogOpened = true;
		});
		await page.evaluate(() => {
			new MutationObserver(() => {
				if (document.querySelector('[role="dialog"]')) window.__markDialog();
			}).observe(document.body, { childList: true, subtree: true });
		});
		await page.locator('button[aria-label="Unlink Morgan Plain"]').click();
		await page.waitForFunction(
			() => !document.querySelector('button[aria-label="Unlink Morgan Plain"]')
		);
		await settle();
		assert.equal(dialogOpened, false);
		assert.equal(
			networks.networkLinkIds({ job_id: jobA.id }).includes(personWithoutNote.id),
			false
		);

		// 4. Person detail page: unlink job WITH note -> Cancel keeps it, Confirm removes it.
		await page.goto(`${base}/networks/${personWithNote.id}`, { waitUntil: 'networkidle0' });
		await page.locator('button[aria-label="Unlink Staff Architect"]').click();
		await page.waitForSelector('[role="dialog"]');
		const personDialogText = await page.$eval('[role="dialog"]', (el) => el.textContent ?? '');
		assert.match(personDialogText, /Unlink and lose the note\?/);
		assert(
			personDialogText.includes(
				`Unlink Staff Architect at Beta (#${jobB.id})? The note saved on this link will be deleted with it.`
			)
		);
		assert(personDialogText.includes('Second job note'));
		await page.locator('[role="dialog"] button::-p-text(Cancel)').click();
		await page.waitForSelector('[role="dialog"]', { hidden: true });
		await page.reload({ waitUntil: 'networkidle0' });
		assert.equal(
			networks.jobLinkNote({ job_id: jobB.id, network_id: personWithNote.id }).note,
			'Second job note'
		);

		await page.locator('button[aria-label="Unlink Staff Architect"]').click();
		await page.waitForSelector('[role="dialog"]');
		await page.locator('[role="dialog"] button[type="submit"]').click();
		await page.waitForSelector('[role="dialog"]', { hidden: true });
		await settle();
		assert.equal(
			networks.jobLinkNote({ job_id: jobB.id, network_id: personWithNote.id }).note,
			null
		);
		assert.equal(
			networks.networkLinkIds({ network_id: personWithNote.id }).includes(jobB.id),
			false
		);

		// 5. Person detail page: unlink job WITHOUT note and job with WHITESPACE-ONLY note -> no dialog, one step.
		dialogOpened = false;
		await page.evaluate(() => {
			new MutationObserver(() => {
				if (document.querySelector('[role="dialog"]')) window.__markDialog();
			}).observe(document.body, { childList: true, subtree: true });
		});
		await page.locator('button[aria-label="Unlink Systems Analyst"]').click();
		await page.waitForFunction(
			() => !document.querySelector('button[aria-label="Unlink Systems Analyst"]')
		);
		await settle();
		assert.equal(dialogOpened, false);
		assert.equal(
			networks.networkLinkIds({ network_id: personWithNote.id }).includes(jobNoNote.id),
			false
		);

		await page.locator('button[aria-label="Unlink Release Engineer"]').click();
		await page.waitForFunction(
			() => !document.querySelector('button[aria-label="Unlink Release Engineer"]')
		);
		await settle();
		assert.equal(dialogOpened, false);
		assert.equal(
			networks.networkLinkIds({ network_id: personWithNote.id }).includes(jobWhitespaceNote.id),
			false
		);
		assert.equal(networks.networkLinkIds({ network_id: personWithNote.id }).length, 0);
		assert.deepEqual(pageErrors, []);
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((r) => child.once('exit', r));
		await rm(root, { recursive: true, force: true });
	}
});
