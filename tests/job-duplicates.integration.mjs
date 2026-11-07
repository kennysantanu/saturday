import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
import { createJob, getJob, searchJobs } from '../src/lib/server/local/jobs.js';
import { createNetwork, listNetworks } from '../src/lib/server/local/people.js';
import { createTag } from '../src/lib/server/local/tags.js';

test('Add job preserves native/enhanced drafts, requires an explicit override and retains person/return context', async () => {
	const previous = { ...process.env };
	const root = await mkdtemp(join(tmpdir(), 'saturday-duplicates-web-'));
	Object.assign(process.env, {
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	const existing = createJob({ job_title: 'Duplicate QA', company_name: 'Example' });
	const person = createNetwork({ name: 'Fictional duplicate QA contact' });
	const tag = createTag({ collection: 'job', name: 'qa', color: '#123456' });
	const socket = createServer();
	await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
	const port = socket.address().port;
	await new Promise((resolve) => socket.close(resolve));
	const base = `http://127.0.0.1:${port}`;
	const child = spawn(process.execPath, ['scripts/start.mjs'], {
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
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert(ready, logs);
		const endpoint = `${base}/jobs/new?person_id=${person.id}`;
		const draft = {
			job_title: 'Duplicate QA',
			company_name: 'Example',
			job_description: 'Retain description',
			notes: 'Retain notes',
			is_starred: '1',
			tags_present: '1',
			tag_ids: String(tag.id)
		};
		const post = (values) =>
			fetch(endpoint, {
				method: 'POST',
				headers: { origin: base, accept: 'text/html' },
				body: new URLSearchParams(values),
				redirect: 'manual'
			});
		const response = await post(draft),
			html = await response.text();
		await writeFile(join(tmpdir(), 'saturday-duplicate-native-response.html'), html);
		assert.equal(response.status, 409, html.slice(0, 800));
		assert(html.includes('A similar job already exists'));
		assert(html.includes('Retain description') && html.includes('Retain notes'));
		assert(html.includes('Create anyway') && html.includes(`Open existing job #${existing.id}`));
		assert(html.includes(person.name));
		assert.equal(searchJobs({ view: 'all' }).total, 1);
		assert.equal(listNetworks({ job_id: existing.id }).total, 0);
		// Native submission: normal Save still checks; only the named override button opts out.
		assert.equal((await post(draft)).status, 409);
		const saved = await post({ ...draft, allow_duplicate: 'true' });
		assert.equal(saved.status, 303);
		const redirect = new URL(saved.headers.get('location'), base);
		assert.equal(redirect.pathname, `/networks/${person.id}`);
		assert.equal(redirect.searchParams.get('link_job'), '1');
		const created = getJob(Number(redirect.searchParams.get('job')));
		assert.notEqual(created.id, existing.id);
		assert.equal(created.notes, draft.notes);
		assert.equal(created.description, draft.job_description);
		assert.equal(created.isStarred, true);
		assert.equal(created.tags[0].id, tag.id);
		assert.equal(listNetworks({ job_id: created.id }).total, 0); // Linking is a separate explicit step.

		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage(),
			errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await page.setViewport({ width: 320, height: 740 });
		const origin = '/jobs?view=all&query=Duplicate';
		const url = base + '/jobs/new?return_to=' + encodeURIComponent(origin);
		await page.goto(url, { waitUntil: 'networkidle0' });
		await page.locator('#job_title').fill('Duplicate QA');
		await page.locator('#company_name').fill('Example');
		await page.locator('#notes').fill('Enhanced draft remains');
		await page.click('button[type="submit"]::-p-text(Save job)');
		await page.waitForSelector('[role="alert"]');
		await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'alert');
		assert.equal(await page.$eval('#notes', (el) => el.value), 'Enhanced draft remains');
		assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'alert');
		assert.equal(searchJobs({ view: 'all' }).total, 2);
		assert(
			await page.$eval('[role="alert"] a.link', (el) => {
				const params = new URL(el.href).searchParams;
				return params.get('return_to') === '/jobs?view=all&query=Duplicate' && !params.has('saved');
			})
		);
		assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		await page.screenshot({
			path: join(tmpdir(), 'saturday-duplicate-warning-phone.png'),
			fullPage: true
		});
		await page.$eval('a[href="#job_title"]', (el) =>
			el.scrollIntoView({ block: 'center', behavior: 'instant' })
		);
		await page.click('a[href="#job_title"]');
		await page.waitForSelector('button[name="allow_duplicate"]', { hidden: true });
		assert.equal(await page.evaluate(() => document.activeElement?.id), 'job_title');
		await page.locator('#job_title').fill('A distinct opening');
		await page.click('button[type="submit"]::-p-text(Save job)');
		await page.waitForFunction(() => /\/jobs\/\d+$/.test(location.pathname));
		assert.equal(new URL(page.url()).searchParams.get('return_to'), origin);
		assert.equal(searchJobs({ view: 'all' }).total, 3);

		await page.goto(url, { waitUntil: 'networkidle0' });
		await page.locator('#job_title').fill('Duplicate QA');
		await page.locator('#company_name').fill('Example');
		await page.click('button[type="submit"]::-p-text(Save job)');
		await page.waitForSelector('button[name="allow_duplicate"]');
		await page.click('button[name="allow_duplicate"]');
		await page.waitForFunction(() => /\/jobs\/\d+$/.test(location.pathname));
		assert.equal(searchJobs({ view: 'all' }).total, 4);
		assert.equal(new URL(page.url()).searchParams.get('return_to'), origin);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((resolve) =>
			child.exitCode !== null ? resolve() : child.once('exit', resolve)
		);
		for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
		Object.assign(process.env, previous);
		await rm(root, { recursive: true, force: true });
	}
});
