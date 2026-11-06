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
import { createNetwork, getNetwork, listNetworks } from '../src/lib/server/local/people.js';

test('Link to job searches as you type, keeps selection and note, names the action and supports Add job', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-job-picker-'));
	Object.assign(process.env, {
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	const person = createNetwork({ name: 'Picker person' });
	for (let i = 0; i < 12; i++) createJob({ job_title: `Role ${i}`, company_name: 'Acme' });
	createJob({ job_title: 'Needle engineer', company_name: 'Initech' });
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
		await page.setViewport({ width: 390, height: 740 });
		const settle = () => page.waitForNetworkIdle({ idleTime: 300 });
		await page.goto(`${base}/networks/${person.id}?link_job=1`, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.link-picker');
		// One page of five cards, a result count and no Search button.
		assert.equal(await page.$$eval('.link-picker input[type="radio"]', (e) => e.length), 5);
		assert.match(await page.$eval('.link-picker [role="status"]', (e) => e.textContent), /13 jobs/);
		assert.equal(
			await page.$$eval(
				'.link-picker button',
				(b) => b.filter((x) => /^Search/.test(x.textContent.trim())).length
			),
			0
		);
		assert.equal(await page.$eval('button[form="network-job-link"]', (e) => e.disabled), true);
		// Choosing a job names the primary action.
		await (await page.$$('.link-picker input[type="radio"]'))[1].click();
		assert.match(
			await page.$eval('button[form="network-job-link"]', (e) => e.textContent),
			/^Link Role/
		);
		const chosen = await page.$eval('input[name="job_id"]', (e) => e.value);
		await page.type('#link_notes', 'Keep this note');
		// Typing in search loads results after a pause, without losing the draft.
		await page.type('#job_query', 'needle');
		await page.waitForFunction(
			() => new URL(location.href).searchParams.get('job_query') === 'needle'
		);
		await settle();
		assert.match(
			await page.$eval('.link-picker [role="status"]', (e) => e.textContent),
			/1 job matching search/
		);
		assert.equal(await page.$eval('input[name="job_id"]', (e) => e.value), chosen);
		assert.equal(await page.$eval('#link_notes', (e) => e.value), 'Keep this note');
		// Pick the match and link it.
		await page.locator('.link-picker input[type="radio"]:not(:checked)').click();
		assert.match(
			await page.$eval('button[form="network-job-link"]', (e) => e.textContent),
			/^Link Needle engineer/
		);
		await page.click('button[form="network-job-link"]');
		await page.waitForSelector('.link-picker', { hidden: true });
		await settle();
		const linked = listNetworks({ query: 'Picker person' }).networks[0];
		assert.equal(getNetwork(linked.id).name, 'Picker person');
		assert.equal(new URL(page.url()).searchParams.has('link_job'), false);
		// Add job returns to the picker with the new job preselected.
		const created = await fetch(`${base}/jobs/new?person_id=${person.id}`, {
			method: 'POST',
			headers: {
				origin: base,
				accept: 'text/html',
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: new URLSearchParams({ job_title: 'Brand new', company_name: 'Newco' }),
			redirect: 'manual'
		});
		assert.equal(created.status, 303);
		const target = new URL(created.headers.get('location'), base);
		assert.equal(target.pathname, `/networks/${person.id}`);
		assert.equal(target.searchParams.get('link_job'), '1');
		await page.goto(target.href, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.link-picker');
		assert.match(
			await page.$eval('button[form="network-job-link"]', (e) => e.textContent),
			/^Link Brand new/
		);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill();
		await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
		await rm(root, { recursive: true, force: true });
	}
});
