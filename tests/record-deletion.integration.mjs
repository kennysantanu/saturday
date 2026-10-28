import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import { randomUUID } from 'node:crypto';
import { createJob, getJob, addJobUpdate } from '../src/lib/server/local/jobs.js';
import { createDocument, listDocuments } from '../src/lib/server/files/documents.js';
import * as networks from '../src/lib/server/local/people.js';

test('parent deletion confirms current scope, preserves related records and return paths, and recovers cleanly in the browser', async (t) => {
	assert(
		existsSync(await puppeteer.executablePath()),
		'Managed Chrome is required for deletion UI verification.'
	);
	const root = await mkdtemp(join(tmpdir(), 'saturday-deletion-web-'));
	Object.assign(process.env, {
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	const created = createJob({ job_title: 'Deletion QA', company_name: 'Example' });
	const job = getJob(created.id),
		other = createJob({ job_title: 'Keep', company_name: 'Example' });
	const person = networks.createNetwork({ name: 'Delete person' });
	networks.linkJobNetwork({ job_id: job.id, network_id: person.id });
	networks.linkJobNetwork({ job_id: other.id, network_id: person.id });
	networks.addNetworkUpdate({
		network_id: person.id,
		interaction_date: '2020-01-01',
		note: 'History'
	});
	await createDocument({ scope: job.id, filename: 'tailored.md', content: 'remove with job' });
	await createDocument({ filename: 'keep.md', content: 'keep general document' });
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
		const post = (path, values) =>
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
		const fields = { dataset_id: job.dataset_id, confirm: 'true' };
		for (const values of [
			{ dataset_id: job.dataset_id },
			{ ...fields, dataset_id: randomUUID() },
			{ ...fields, job_id: String(other.id) }
		]) {
			assert.equal((await post(`/jobs/${job.id}?/deleteJob`, values)).status, 400);
			assert(getJob(job.id));
		}
		assert.equal((await fetch(base + `/jobs/${job.id}?/deleteJob`)).status, 200);
		assert(getJob(job.id));
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage(),
			errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		const settle = () => page.waitForNetworkIdle({ idleTime: 300 });
		const detail = `/jobs/${job.id}?return_to=${encodeURIComponent('/jobs?query=Deletion&page=99')}`;
		await page.goto(base + detail, { waitUntil: 'networkidle0' });
		const openDelete = async (kind) => {
			await page
				.locator(`button[aria-label="${kind === 'job' ? 'Job' : 'Person'} actions"]`)
				.click();
			await page.locator(`[role="menuitem"]::-p-text(Delete ${kind})`).click();
			await page.waitForSelector('[role="dialog"]');
			await settle();
		};
		for (const width of [320, 767, 768, 1280]) {
			await page.setViewport({ width, height: 820 });
			await settle();
			await page.evaluate(
				(value) => localStorage.setItem('saturday-theme', value),
				width < 768 ? 'dark' : 'light'
			);
			await page.reload({ waitUntil: 'networkidle0' });
			await openDelete('job');
			assert.equal(
				await page.$eval('[role="dialog"]', (el) => el.contains(document.activeElement)),
				true
			);
			assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Cancel');
			assert.match(
				await page.$eval('[role="dialog"]', (el) => el.textContent),
				/all job-specific documents/
			);
			const geometry = await page.$eval('[role="dialog"]', (el) => {
				const buttons = [...el.querySelectorAll('[data-slot="dialog-footer"] button')].map(
					(button) => button.getBoundingClientRect()
				);
				return {
					cancelTop: buttons[0].top,
					deleteTop: buttons[1].top,
					inside: buttons.every((rect) => rect.top >= 0 && rect.bottom <= innerHeight),
					padding: getComputedStyle(el).paddingLeft
				};
			});
			assert(geometry.inside);
			if (width < 768) {
				assert(geometry.deleteTop < geometry.cancelTop);
				assert.equal(geometry.padding, '20px');
			} else {
				assert.equal(geometry.cancelTop, geometry.deleteTop);
				assert.equal(geometry.padding, '28px');
			}
			await page.screenshot({ path: `/tmp/saturday-delete-job-${width}.png` });
			await page.keyboard.press('Escape');
			await page.waitForSelector('[role="dialog"]', { hidden: true });
			await settle();
			assert.equal(
				await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
				'Job actions'
			);
			assert(getJob(job.id));
		}
		// Auth expiration retains the confirmation and resets progress without deleting.
		await openDelete('job');
		await page.setRequestInterception(true);
		const expired = (request) => {
			if (request.method() === 'POST' && request.url().includes('/deleteJob'))
				void request.respond({
					status: 401,
					contentType: 'application/json',
					body: JSON.stringify({ type: 'failure', status: 401, auth_required: true })
				});
			else void request.continue();
		};
		page.on('request', expired);
		await page.locator('button[form="delete-job"]').click();
		await settle();
		assert.equal(await page.$eval('button[form="delete-job"]', (el) => el.disabled), false);
		assert(getJob(job.id));
		page.off('request', expired);
		await page.setRequestInterception(false);
		// Add data after opening confirmation: execution includes it, without snapshot tokens.
		addJobUpdate({ job_id: job.id, event_date: '2020-01-01', stage_id: null, note: 'late note' });
		await createDocument({ scope: job.id, filename: 'late.md', content: 'late attachment' });
		await page.setRequestInterception(true);
		let release, submitted;
		const captured = new Promise((r) => (submitted = r));
		const hold = (request) => {
			if (request.method() === 'POST' && request.url().includes('/deleteJob')) {
				release = () => request.continue();
				submitted();
			} else void request.continue();
		};
		page.on('request', hold);
		await page.locator('button[form="delete-job"]').click();
		await captured;
		await page.keyboard.press('Escape');
		assert.equal(await page.$$eval('[role="dialog"]', (els) => els.length), 1);
		assert.equal(await page.$eval('button[form="delete-job"]', (el) => el.disabled), true);
		await release();
		await page.waitForFunction(() => location.pathname === '/jobs');
		await settle();
		page.off('request', hold);
		await page.setRequestInterception(false);
		assert.equal(new URL(page.url()).searchParams.get('query'), 'Deletion');
		assert(!new URL(page.url()).searchParams.has('page'));
		assert.equal(getJob(job.id), null);
		assert(getJob(other.id));
		assert.equal(networks.getNetwork(person.id).name, 'Delete person');
		assert.equal(networks.listNetworkJobs({ network_id: person.id }).total, 1);
		assert.equal((await listDocuments()).total, 1);
		const fileManifest = JSON.parse(await readFile(join(root, 'files', 'manifest.json'), 'utf8'));
		assert(!fileManifest.documents.some((entry) => entry.key.startsWith(`jobs/${job.id}/`)));
		assert.match(await page.content(), /Job deleted\./);
		// A duplicate action returns safely instead of re-deleting or trapping the old detail.
		const missing = await post(
			`/jobs/${job.id}?/deleteJob&return_to=${encodeURIComponent('/jobs?query=Deletion')}`,
			fields
		);
		assert.equal(missing.status, 303);
		assert.match(missing.headers.get('location'), /job-missing/);
		// Person deletion returns to its originating job, preserving that job's list context.
		const origin = `/jobs/${other.id}?return_to=${encodeURIComponent('/jobs?view=all')}`;
		await page.goto(base + `/networks/${person.id}?return_to=${encodeURIComponent(origin)}`, {
			waitUntil: 'networkidle0'
		});
		await openDelete('person');
		assert.match(
			await page.$eval('[role="dialog"]', (el) => el.textContent),
			/Linked jobs are kept/
		);
		await page.locator('button[form="delete-person"]').click();
		await page.waitForFunction((id) => location.pathname === `/jobs/${id}`, {}, other.id);
		await settle();
		assert.equal(new URL(page.url()).searchParams.get('return_to'), '/jobs?view=all');
		assert(getJob(other.id));
		assert.equal(networks.listNetworks({ job_id: other.id }).total, 0);
		assert.throws(
			() => networks.getNetwork(person.id),
			(e) => e.code === 'not_found'
		);
		assert.match(await page.content(), /Person deleted\./);
		// Long identities and short phone screens remain scrollable and cancellable.
		const long = createJob({
			job_title: 'Long role '.repeat(18),
			company_name: 'Long company '.repeat(14)
		});
		await page.setViewport({ width: 320, height: 480 });
		await page.goto(base + `/jobs/${long.id}`, { waitUntil: 'networkidle0' });
		await openDelete('job');
		const short = await page.$eval('[role="dialog"]', (el) => {
			el.scrollTop = 0;
			const r = el.getBoundingClientRect();
			return {
				inside: r.top >= 0 && r.bottom <= innerHeight,
				fits: el.scrollWidth <= el.clientWidth
			};
		});
		assert(short.inside && short.fits);
		await page.screenshot({ path: '/tmp/saturday-delete-long-phone.png' });
		await page.locator('[role="dialog"] button::-p-text(Cancel)').click();
		await page.waitForSelector('[role="dialog"]', { hidden: true });
		assert(getJob(long.id));
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
		await rm(root, { recursive: true, force: true });
	}
});

for (const point of ['before-commit', 'after-commit']) {
	test(`production startup recovers an interrupted deletion at ${point}`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'saturday-deletion-startup-'));
		Object.assign(process.env, {
			SATURDAY_INSTALLATION_PATH: '',
			SATURDAY_DB_PATH: join(root, 'db.sqlite'),
			SATURDAY_FILES_PATH: join(root, 'files'),
			SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
			SATURDAY_EXTENSIONS_PATH: join(root, 'code')
		});
		const created = createJob({ job_title: 'Recover on open', company_name: 'Example' }),
			job = getJob(created.id);
		await createDocument({
			scope: job.id,
			filename: 'recover.md',
			content: 'retained before commit'
		});
		const crash = spawn(
			process.execPath,
			[
				'tests/helpers/record-deletion-worker.mjs',
				JSON.stringify({ job_id: job.id, dataset_id: job.dataset_id, point })
			],
			{ env: process.env, stdio: 'ignore' }
		);
		assert.equal(
			await new Promise((r) => crash.once('exit', (_code, signal) => r(signal))),
			'SIGKILL'
		);
		const socket = createServer();
		await new Promise((r) => socket.listen(0, '127.0.0.1', r));
		const port = socket.address().port;
		await new Promise((r) => socket.close(r));
		const child = spawn(process.execPath, ['scripts/start.mjs'], {
			env: { ...process.env, PORT: String(port) },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let logs = '';
		child.stdout.on('data', (c) => (logs += c));
		child.stderr.on('data', (c) => (logs += c));
		try {
			let ready = false;
			for (let i = 0; i < 150; i++) {
				try {
					if ((await fetch(`http://127.0.0.1:${port}/jobs`)).ok) {
						ready = true;
						break;
					}
				} catch {}
				await new Promise((r) => setTimeout(r, 100));
			}
			assert(ready, logs);
			assert.equal(!!getJob(job.id), point === 'before-commit');
			assert.equal(
				existsSync(join(root, 'files', `jobs/${job.id}/recover.md`)),
				point === 'before-commit'
			);
			assert(!existsSync(join(root, 'files.state', 'job-deletion.json')));
		} finally {
			child.kill('SIGTERM');
			await new Promise((r) =>
				child.exitCode !== null || child.signalCode !== null ? r() : child.once('exit', r)
			);
			await rm(root, { recursive: true, force: true });
		}
	});
}
