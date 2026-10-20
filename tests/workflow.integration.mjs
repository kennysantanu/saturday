import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import { migrateDatabase } from '../src/lib/server/database.js';
import { createJob, getJob } from '../src/lib/server/services.js';
import { listWorkflowStages } from '../src/lib/server/workflow.js';
import { jobReturn } from '../src/lib/job-navigation.js';

test('production stage/history actions, result round trips and read-only overview', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-workflow-web-'));
	process.env.SATURDAY_DB_PATH = join(root, 'career.sqlite');
	process.env.SATURDAY_FILES_PATH = join(root, 'files');
	process.env.SATURDAY_INSTALLATION_PATH = '';
	process.env.SATURDAY_EXTENSION_STATE_PATH = join(root, 'extensions');
	process.env.SATURDAY_EXTENSIONS_PATH = join(root, 'extension-code');
	migrateDatabase();
	const job = createJob({ job_title: 'Workflow QA', company_name: 'Example' });
	const stages = listWorkflowStages(),
		interview = stages.find((s) => s.name === 'Interview'),
		closed = stages.find((s) => s.name === 'Rejected');
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
	let logs = '';
	child.stdout.on('data', (c) => (logs += c));
	child.stderr.on('data', (c) => (logs += c));
	let browser;
	try {
		let ready = false;
		for (let i = 0; i < 150; i++) {
			try {
				if ((await fetch(base + '/jobs')).ok) {
					ready = true;
					break;
				}
			} catch {}
			await new Promise((r) => setTimeout(r, 100));
		}
		assert(ready, logs);
		const returnTo = '/jobs?query=Workflow&current_stage=' + job.currentStageId;
		const detail = `/jobs/${job.id}?return_to=${encodeURIComponent(returnTo)}`;
		const post = (action, values) =>
			fetch(base + `/jobs/${job.id}?/${action}&return_to=${encodeURIComponent(returnTo)}`, {
				method: 'POST',
				headers: {
					origin: base,
					accept: 'text/html',
					'content-type': 'application/x-www-form-urlencoded'
				},
				body: new URLSearchParams(values),
				redirect: 'manual'
			});
		const html = await (await fetch(base + detail)).text();
		assert(html.includes('Change stage'));
		assert(html.includes('Add history'));
		assert(!html.includes('Dismiss job'));
		assert(!html.includes('Reopen job'));
		const history = await post('addUpdate', {
			stage_id: String(interview.id),
			event_date: '2099-01-01',
			note: 'Scheduled'
		});
		assert.equal(history.status, 303);
		assert.equal(getJob(job.id).currentStageId, job.currentStageId);
		const moved = await post('changeStage', {
			stage_id: String(closed.id),
			event_date: '2020-01-01',
			note: 'Closed'
		});
		assert.equal(moved.status, 303);
		assert.equal(getJob(job.id).currentStageId, closed.id);
		assert.equal(
			new URL(moved.headers.get('location'), base).searchParams.get('return_to'),
			returnTo
		);
		const outside = await (await fetch(base + moved.headers.get('location'))).text();
		assert(outside.includes('outside the original results'));
		const matching = await (await fetch(base + '/jobs?view=all&current_stage=' + closed.id)).text();
		assert(matching.includes('Workflow QA'));
		assert(matching.includes('Search jobs'));
		assert(!matching.includes('layout=board'));
		const invalid = await post('changeStage', {
			stage_id: '999999',
			event_date: '2020-01-01',
			note: 'Keep draft'
		});
		assert.equal(invalid.status, 400);
		assert((await invalid.text()).includes('Keep draft'));
		assert.equal(getJob(job.id).currentStageId, closed.id);
		for (const input of [
			'https://evil.test',
			'//evil.test',
			'/settings',
			'/jobs/1',
			'/\\evil.test'
		])
			assert.equal(jobReturn(input), '/jobs');
		if (!existsSync(await puppeteer.executablePath())) {
			t.diagnostic('Managed Chrome unavailable; native HTTP checks passed.');
			return;
		}
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.setViewport({ width: 1280, height: 960 });
		await page.goto(base + detail + '&change_stage=1', { waitUntil: 'networkidle0' });
		await page.select('#move-stage', String(interview.id));
		await page.type('#move-note', 'Browser stage note');
		await Promise.all([
			page.waitForNavigation({ waitUntil: 'networkidle0' }),
			page.click('form[action*="/changeStage"] button[type="submit"]')
		]);
		assert.equal(getJob(job.id).currentStageId, interview.id);
		await page.goto(base + detail + '&add_history=1', { waitUntil: 'networkidle0' });
		await page.type('#history-note', 'Browser history only');
		await Promise.all([
			page.waitForNavigation({ waitUntil: 'networkidle0' }),
			page.click('form[action*="/addUpdate"] button[type="submit"]')
		]);
		assert.equal(getJob(job.id).currentStageId, interview.id);
		await new Promise((resolve) => setTimeout(resolve, 300));
		await page.screenshot({ path: '/tmp/saturday-workflow-detail.png', fullPage: true });
		await page.setViewport({ width: 320, height: 900 });
		await page.goto(base + '/jobs', { waitUntil: 'networkidle0' });
		assert(await page.$eval('html', (el) => el.scrollWidth <= innerWidth + 1));
		await page.screenshot({ path: '/tmp/saturday-workflow-jobs-phone.png', fullPage: true });
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
		await rm(root, { recursive: true, force: true });
	}
});
