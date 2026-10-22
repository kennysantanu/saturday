import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import { createJob } from '../src/lib/server/services.js';
import { createNetwork, listNetworks } from '../src/lib/server/networks.js';

test('Link person keeps its footer visible and preserves selection and notes through search, paging and rejected saves', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-person-picker-'));
	Object.assign(process.env, {
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	const layoutJob = createJob({ job_title: 'Picker job', company_name: 'Example' });
	for (let i = 0; i < 50; i++) createNetwork({ name: `A navigation ${i}` });
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
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage(),
			errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		const settle = () => page.waitForNetworkIdle({ idleTime: 300 });
		const button = (text) => page.click(`button::-p-text(${text})`);
		const origin = '/jobs?query=Picker';
		await page.goto(base + `/jobs/${layoutJob.id}?return_to=${encodeURIComponent(origin)}`, {
			waitUntil: 'networkidle0'
		});
		// Person selection stays compact and retains its draft through search, paging and errors.
		await settle();
		await page.bringToFront();
		await page.setViewport({ width: 320, height: 740 });
		await settle();
		await page.locator('a[href*="link_person=1"]').click();
		await page.waitForSelector('.person-picker');
		await settle();
		assert.equal(
			await page.$$eval('.person-picker input[type="radio"]', (items) => items.length),
			5
		);
		assert.equal(await page.$eval('button[form="job-person-link"]', (el) => el.disabled), true);
		await page.$eval('.person-picker-body', (el) => {
			el.scrollTop = el.scrollHeight;
		});
		assert(
			await page.$eval('button[form="job-person-link"]', (el) => {
				const r = el.getBoundingClientRect();
				return (
					r.top >= 0 &&
					r.bottom <= innerHeight &&
					el
						.closest('[data-slot="dialog-footer"]')
						.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
				);
			})
		);
		await page.screenshot({ path: '/tmp/saturday-person-picker-phone.png' });
		const beforeSelection = await page.$eval('.person-picker', (el) => {
			const rect = el.getBoundingClientRect();
			return { width: rect.width, height: rect.height };
		});
		await page.locator('.person-picker input[type="radio"]:not(:disabled)').click();
		assert.equal(await page.$$eval('#person_query', (els) => els.length), 1);
		assert.equal(await page.$$eval('#new_network_relationship_note', (els) => els.length), 1);
		assert.deepEqual(
			await page.$eval('.person-picker', (el) => {
				const rect = el.getBoundingClientRect();
				return { width: rect.width, height: rect.height };
			}),
			beforeSelection
		);
		assert.equal(
			await page.$eval('.person-picker input[type="radio"]:checked', (el) => !!el),
			true
		);
		await page.waitForSelector('#new_network_relationship_note');
		const chosenPerson = await page.$eval(
			'#job-person-link input[name="network_id"]',
			(el) => el.value
		);
		await page.type('#new_network_relationship_note', 'Keep this relationship draft');
		await page.waitForSelector('#person_query');
		await page.locator('#person_query').fill('A navigation');
		await page.click('button::-p-text(Search people)');
		await page.waitForFunction(
			() => new URL(location.href).searchParams.get('person_query') === 'A navigation'
		);
		await settle();
		assert.equal(
			await page.$eval('#new_network_relationship_note', (el) => el.value),
			'Keep this relationship draft'
		);
		await page.click('nav[aria-label="Person picker pages"] button[aria-label="Next page"]');
		await page.waitForFunction(
			() => new URL(location.href).searchParams.get('person_page') === '2'
		);
		await settle();
		assert.equal(
			await page.$eval('#job-person-link input[name="network_id"]', (el) => el.value),
			chosenPerson
		);
		assert.equal(
			await page.$eval('#new_network_relationship_note', (el) => el.value),
			'Keep this relationship draft'
		);
		await page.click('.person-picker > [data-slot="dialog-footer"] button[data-variant="ghost"]');
		await page.waitForSelector('button::-p-text(Keep editing)');
		await button('Keep editing');
		await page.waitForSelector('button::-p-text(Keep editing)', { hidden: true });
		await settle();
		assert.equal(
			await page.$eval('#new_network_relationship_note', (el) => el.value),
			'Keep this relationship draft'
		);
		await page.$eval('#new_network_relationship_note', (el) => {
			el.value = 'x'.repeat(2001);
			el.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.$eval('#job-person-link', (el) => {
			el.noValidate = true;
		});
		await page.click('button[form="job-person-link"]');
		await page.waitForSelector('#new_network_relationship_note[aria-invalid="true"]');
		await settle();
		assert.equal(await page.$eval('#new_network_relationship_note', (el) => el.value.length), 2001);
		await page.locator('#new_network_relationship_note').fill('Keep this relationship draft');
		await page.setRequestInterception(true);
		const pickerExpired = (request) => {
			if (request.method() === 'POST' && request.url().includes('/networkLink'))
				void request.respond({
					status: 401,
					contentType: 'application/json',
					headers: { 'x-saturday-auth': 'required' },
					body: JSON.stringify({ type: 'failure', status: 401, auth_required: true })
				});
			else void request.continue();
		};
		page.on('request', pickerExpired);
		await page.click('button[form="job-person-link"]');
		await page.waitForSelector('#job-person-link:not([aria-busy="true"])');
		await settle();
		assert.equal(
			await page.$eval('#new_network_relationship_note', (el) => el.value),
			'Keep this relationship draft'
		);
		assert.equal(await page.$eval('button[form="job-person-link"]', (el) => el.disabled), false);
		page.off('request', pickerExpired);
		await page.setRequestInterception(false);
		await page.setViewport({ width: 1280, height: 960 });
		await settle();
		const fieldLayout = await page.evaluate(() => {
			const dialog = document.querySelector('.person-picker');
			const search = document.querySelector('#person_query').getBoundingClientRect();
			const note = document.querySelector('#new_network_relationship_note').getBoundingClientRect();
			return {
				searchLeft: search.left,
				noteLeft: note.left,
				searchWidth: search.width,
				noteWidth: note.width,
				padding: getComputedStyle(dialog).paddingLeft
			};
		});
		assert.equal(fieldLayout.searchLeft, fieldLayout.noteLeft);
		assert.equal(fieldLayout.searchWidth, fieldLayout.noteWidth);
		assert.equal(fieldLayout.padding, '28px');
		await page.screenshot({ path: '/tmp/saturday-person-picker-selected.png' });
		await page.click('button[form="job-person-link"]');
		await page.waitForSelector('.person-picker', { hidden: true });
		await settle();
		assert.equal(
			listNetworks({ job_id: layoutJob.id }).networks[0].job_link.notes,
			'Keep this relationship draft'
		);

		assert.equal(new URL(page.url()).searchParams.get('return_to'), origin);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
		await rm(root, { recursive: true, force: true });
	}
});
