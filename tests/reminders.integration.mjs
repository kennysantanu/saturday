import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import { createJob, getJob } from '../src/lib/server/local/jobs.js';
import * as people from '../src/lib/server/local/people.js';
import * as reminders from '../src/lib/server/local/reminders.js';
import { getInstallation } from '../src/lib/server/installation.js';
import { accessPath, defaultAccessSettings } from '../src/lib/server/access-settings.js';
import { passwordHash } from '../src/lib/server/access-auth.js';

test('job and person reminder UI supports fixed schedules, dismissal, past editing, atomic activity, recovery and responsive dialogs', async () => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-reminder-ui-'));
	Object.assign(process.env, {
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	const person = people.createNetwork({ name: 'Reminder contact' });
	const socket = createServer();
	await new Promise((r) => socket.listen(0, '127.0.0.1', r));
	const port = socket.address().port;
	await new Promise((r) => socket.close(r));
	const base = `http://127.0.0.1:${port}`,
		child = spawn(process.execPath, ['scripts/start.mjs'], {
			cwd: resolve('.'),
			env: { ...process.env, PORT: String(port) },
			stdio: ['ignore', 'pipe', 'pipe']
		});
	let logs = '',
		browser,
		step = 'startup';
	child.stdout.on('data', (c) => (logs += c));
	child.stderr.on('data', (c) => (logs += c));
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
		const personReminder = reminders.createReminder({
			network_id: person.id,
			scheduled_at: '2099-08-01T00:00',
			note: 'Person-only reminder'
		});
		const dashboard = await (await fetch(base)).text();
		assert(dashboard.includes('Person-only reminder'));
		assert(dashboard.includes('Reminder contact'));
		const j = createJob({ job_title: 'Reminder QA', company_name: 'Example' }),
			other = createJob({ job_title: 'Other owner', company_name: 'Keep' });
		const midnight = reminders.createReminder({
				job_id: j.id,
				scheduled_at: '2099-08-01T00:00',
				note: 'Midnight prompt'
			}),
			timed = reminders.createReminder({
				job_id: j.id,
				scheduled_at: '2099-08-01T09:30',
				note: 'Timed prompt'
			});
		const origin = '/jobs?query=Reminder&view=all';
		const detail = `/jobs/${j.id}?return_to=${encodeURIComponent(origin)}`;
		assert.equal(
			(await post(`/jobs/${other.id}?/reminderDismiss`, { reminder_id: String(midnight.id) }))
				.status,
			400
		);
		const invalid = await post(`/jobs/${j.id}?/addHistory`, {
			event_date: '2020-01-01',
			note: 'Must roll back',
			add_reminder: 'on',
			reminder_date: 'bad'
		});
		assert.equal(invalid.status, 400);
		assert(!getJob(j.id).updates.some((u) => u.note === 'Must roll back'));
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 20000 });
		const page = await browser.newPage(),
			errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		const settle = async () => {
			await page.waitForNetworkIdle({ idleTime: 300 });
			await page.evaluate(async () => {
				await Promise.all(
					document
						.getAnimations()
						.filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
						.map((a) => a.finished.catch(() => {}))
				);
			});
		};
		const button = (text) => page.locator(`button::-p-text(${text})`).click();
		const save = async () => {
			await page.click('#reminder-editor button[type="submit"]:not([formaction])');
			await page.waitForSelector('[role=dialog]', { hidden: true });
			await settle();
			await settle();
		};
		step = 'responsive edit and midnight display';
		for (const width of [320, 640, 767, 768, 1280]) {
			await page.setViewport({ width, height: 900 });
			await page.emulateTimezone(width < 768 ? 'America/New_York' : 'America/Los_Angeles');
			await page.goto(base + detail, { waitUntil: 'networkidle0' });
			await page.evaluate(
				(theme) => localStorage.setItem('saturday-theme', theme),
				width < 768 ? 'dark' : 'light'
			);
			await page.reload({ waitUntil: 'networkidle0' });
			const midnightText = await page.$eval(
				`[data-reminder-id="${midnight.id}"]`,
				(e) => e.textContent
			);
			assert(!midnightText.includes('00:00'));
			assert(midnightText.includes('Aug 1, 2099'));
			assert(
				(await page.$eval(`[data-reminder-id="${timed.id}"]`, (e) => e.textContent)).includes(
					'09:30'
				)
			);
			await page
				.locator(`[data-reminder-id="${midnight.id}"] button::-p-text(Edit reminder)`)
				.click();
			await page.waitForSelector('#reminder-time');
			assert.equal(await page.$eval('#reminder-time', (e) => e.value), '00:00');
			await settle();
			await page.$eval('#reminder-editor [data-slot="dialog-footer"]', (e) =>
				e.scrollIntoView({ block: 'end' })
			);
			const geometry = await page.$eval('#reminder-editor [data-slot="dialog-footer"]', (e) =>
				[...e.querySelectorAll('button')].map((b) => {
					const r = b.getBoundingClientRect();
					return { top: r.top, left: r.left, width: r.width, bottom: r.bottom };
				})
			);
			assert.equal(geometry.length, 3);
			if (width < 768) {
				assert(geometry[2].top < geometry[1].top && geometry[1].top < geometry[0].top);
				assert(geometry.every((r) => Math.abs(r.width - geometry[0].width) < 1));
			} else assert(Math.abs(geometry[0].top - geometry[2].top) < 2);
			assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			await page.screenshot({ path: `/tmp/saturday-reminders-${width}.png` });
			await page.keyboard.press('Escape');
			await page.waitForSelector('[role=dialog]', { hidden: true });
			await settle();
		}
		step = 'create default and dismiss';
		await button('Add reminder');
		await page.waitForSelector('#reminder-time');
		assert.equal(await page.$eval('#reminder-time', (e) => e.value), '00:00');
		await page.locator('#reminder-date').fill('2099-08-02');
		await page.type('#reminder-note', 'Created through UI');
		await save();
		assert.equal(new URL(page.url()).searchParams.get('return_to'), origin);
		const created = reminders
			.listReminders({ job_id: j.id })
			.reminders.find((r) => r.note === 'Created through UI');
		assert(created);
		await page
			.locator(`[data-reminder-id="${created.id}"] button::-p-text(Dismiss reminder)`)
			.click();
		await settle();
		assert.equal(reminders.listReminders({ job_id: j.id, view: 'inactive' }).total, 1);
		await page.locator('summary::-p-text(Past reminders)').click();
		const past = `[data-reminder-id="${created.id}"]`;
		assert.equal(
			await page
				.$$eval(past + ' button', (els) => els.map((e) => e.textContent.trim()))
				.then((x) => x.join(',')),
			'Edit reminder'
		);
		await page.locator(past + ' button').click();
		await page.waitForSelector('#reminder-note');
		await page.locator('#reminder-note').fill('Edited while inactive');
		await save();
		const inactive = reminders.listReminders({ job_id: j.id, view: 'inactive' }).reminders[0];
		assert.equal(inactive.note, 'Edited while inactive');
		assert(!inactive.is_active);
		step = 'restore through editor';
		if (!(await page.$eval('#reminders details', (e) => e.open)))
			await page.locator('summary::-p-text(Past reminders)').click();
		await page.locator(past + ' button').click();
		await page.waitForSelector('#reminder-editor input[name="is_active"]');
		await page.click('#reminder-editor input[name="is_active"]');
		await save();
		assert(reminders.listReminders({ job_id: j.id }).reminders.some((r) => r.id === created.id));
		await page.locator(past + ' button::-p-text(Dismiss reminder)').click();
		await settle();
		step = 'delete confirmation preserves draft';
		if (!(await page.$eval('#reminders details', (e) => e.open)))
			await page.locator('summary::-p-text(Past reminders)').click();
		await page.locator(past + ' button').click();
		await page.waitForSelector('#reminder-note');
		await page.locator('#reminder-note').fill('Unsaved edit');
		await page.locator('#reminder-editor button::-p-text(Delete reminder)').click();
		await page.keyboard.press('Escape');
		assert.equal(await page.$eval('#reminder-note', (e) => e.value), 'Unsaved edit');
		await page.locator('#reminder-editor button::-p-text(Delete reminder)').click();
		await page.locator('[role=dialog] button[formaction*="reminderDelete"]').click();
		await page.waitForSelector('[role=dialog]', { hidden: true });
		await settle();
		assert.equal(reminders.listReminders({ job_id: j.id, view: 'inactive' }).total, 0);
		await settle();
		step = 'combined job history';
		// Parent metadata and reminder removal can leave this action underneath sticky navigation.
		// Put the actual target in clear view before a pointer click.
		await page.$eval('button::-p-text(Add history)', (button) =>
			button.scrollIntoView({ block: 'center' })
		);
		await settle();
		await button('Add history');
		await page.waitForSelector('#history-note');
		await page.type('#history-note', 'History with reminder');
		await page.click('input[name="add_reminder"]');
		await page.waitForSelector('#history-reminder-time');
		assert.equal(await page.$eval('#history-reminder-time', (e) => e.value), '00:00');
		assert.equal(
			await page.$eval('#history-reminder-note', (e) => e.value),
			'History with reminder'
		);
		await page.locator('#history-reminder-date').fill('2099-08-03');
		await page.click('#job-update-form button[type="submit"]');
		await page.waitForSelector('[role=dialog]', { hidden: true });
		await settle();
		assert(getJob(j.id).updates.some((u) => u.note === 'History with reminder'));
		assert(
			reminders
				.listReminders({ job_id: j.id })
				.reminders.some((r) => r.note === 'History with reminder')
		);
		step = 'person activity and standalone editor';
		await page.goto(base + `/networks/${person.id}?return_to=${encodeURIComponent('/')}`, {
			waitUntil: 'networkidle0'
		});
		await button('Add interaction');
		await page.waitForSelector('#interaction_note');
		await page.type('#interaction_note', 'Person interaction');
		await page.click('input[name="add_reminder"]');
		await page.waitForSelector('#interaction-reminder-date');
		await page.locator('#interaction-reminder-date').fill('2099-08-04');
		await page.click('#network-interaction button[type="submit"]');
		await page.waitForSelector('[role=dialog]', { hidden: true });
		await settle();
		assert.equal(people.getNetwork(person.id).interaction_count, 1);
		assert.equal(reminders.listReminders({ network_id: person.id }).total, 2);
		assert.equal(new URL(page.url()).searchParams.get('return_to'), '/');
		step = 'expired reminder draft';
		await button('Add reminder');
		await page.waitForSelector('#reminder-note');
		await page.locator('#reminder-date').fill('2099-09-01');
		await page.type('#reminder-note', 'Preserve this reminder draft');
		const installation = getInstallation();
		await writeFile(
			accessPath(installation),
			JSON.stringify({ ...defaultAccessSettings(), password: await passwordHash('test') }),
			{ mode: 0o600 }
		);
		await page.click('#reminder-editor button[type="submit"]');
		await page.waitForFunction(() => document.body.innerText.includes('Session expired'));
		assert.equal(
			await page.$eval('#reminder-note', (e) => e.value),
			'Preserve this reminder draft'
		);
		assert.equal(await page.$eval('#reminder-editor', (e) => e.hasAttribute('aria-busy')), false);
		await page.keyboard.press('Escape');
		await page.waitForFunction(() =>
			[...document.querySelectorAll('[role=dialog]')].some((el) =>
				el.textContent.includes('Discard unsaved changes?')
			)
		);
		await button('Keep editing');
		assert.equal(
			await page.$eval('#reminder-note', (e) => e.value),
			'Preserve this reminder draft'
		);
		const login = await browser.newPage();
		await login.goto(base + '/signin', { waitUntil: 'networkidle0' });
		await login.type('#signin-password', 'test');
		await login.click('button[type=submit]');
		await login.waitForFunction(() => !location.pathname.startsWith('/signin'));
		await page.bringToFront();
		await save();
		assert(
			reminders
				.listReminders({ network_id: person.id })
				.reminders.some((r) => r.note === 'Preserve this reminder draft')
		);
		assert.deepEqual(errors, []);
	} catch (error) {
		if (browser) {
			const pages = await browser.pages();
			await pages
				.at(-1)
				?.screenshot({ path: '/tmp/saturday-reminders-failure.png', fullPage: true })
				.catch(() => {});
		}
		error.message = `${step}: ${error.message}\n${logs}`;
		throw error;
	} finally {
		await browser?.close();
		child.kill('SIGTERM');
		await new Promise((r) =>
			child.exitCode !== null || child.signalCode !== null ? r() : child.once('exit', r)
		);
		await rm(root, { recursive: true, force: true });
	}
});
