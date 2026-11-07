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
import { createReminder, listReminders } from '../src/lib/server/local/reminders.js';

const day = (offset) => {
	const d = new Date();
	d.setDate(d.getDate() + offset);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('Dashboard groups attention by urgency, caps the list, dismisses with Undo and works without scripts', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-attention-'));
	Object.assign(process.env, {
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	const jobs = Array.from({ length: 7 }, (_, i) =>
		createJob({ job_title: `Attention role ${i}`, company_name: 'Acme' })
	);
	// Two overdue, one today, four upcoming: seven in total, so two sit behind "Show 2 more".
	const offsets = [-3, -1, 0, 1, 2, 3, 4];
	const reminders = jobs.map((job, i) =>
		createReminder({ job_id: job.id, scheduled_at: `${day(offsets[i])}T23:00`, note: `Note ${i}` })
	);
	// 23:00 today is not overdue before then; make the second one clearly overdue by yesterday.
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
		await page.setViewport({ width: 1100, height: 900 });
		await page.goto(base, { waitUntil: 'networkidle0' });
		const text = (selector) =>
			page.$eval(selector, (e) => e.textContent.replace(/\s+/g, ' ').trim());
		// Grouped by urgency, with a cap of five rows and the rest behind a native disclosure.
		const headings = await page.$$eval('#needs-attention h4', (h) =>
			h.map((x) => x.textContent.replace(/\s+/g, ' ').trim())
		);
		assert.match(headings[0], /^Overdue \(2\)/);
		assert.equal(await page.$$eval('#needs-attention > div .attention-row', (r) => r.length), 5);
		assert.match(await text('#needs-attention summary'), /Show 2 more/);
		assert.match(await text('.attention-summary'), /2 overdue/);
		assert.match(await text('#needs-attention .attention-when'), /3 days overdue/);
		// Dismiss the first reminder: it leaves the list and the toast offers Undo.
		await page.click('#needs-attention .attention-action button');
		await page.waitForFunction(() => document.body.innerText.includes('Reminder dismissed.'));
		await page.waitForNetworkIdle({ idleTime: 300 });
		assert.equal(
			listReminders({ job_id: jobs[0].id, view: 'all' }).reminders.find(
				(r) => r.id === reminders[0].id
			).is_active,
			false
		);
		assert.match(await text('.attention-summary'), /1 overdue/);
		await page.click('.toast button::-p-text(Undo)');
		await page.waitForFunction(() => document.body.innerText.includes('Reminder restored.'));
		await page.waitForNetworkIdle({ idleTime: 300 });
		assert.equal(
			listReminders({ job_id: jobs[0].id, view: 'all' }).reminders.find(
				(r) => r.id === reminders[0].id
			).is_active,
			true
		);
		assert.match(await text('.attention-summary'), /2 overdue/);
		// Without scripts the form posts and redirects back with a confirmation.
		const plain = await browser.newPage();
		await plain.setJavaScriptEnabled(false);
		await plain.goto(base, { waitUntil: 'networkidle0' });
		await Promise.all([
			plain.waitForNavigation({ waitUntil: 'networkidle0' }),
			plain.click('#needs-attention .attention-action button')
		]);
		assert.equal(new URL(plain.url()).pathname, '/');
		assert.equal(
			listReminders({ job_id: jobs[0].id, view: 'all' }).reminders.find(
				(r) => r.id === reminders[0].id
			).is_active,
			false
		);
		await plain.close();
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill();
		await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
		await rm(root, { recursive: true, force: true });
	}
});
