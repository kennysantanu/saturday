import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import * as tags from '../src/lib/server/local/tags.js';
import { createJob, getJob, searchJobs } from '../src/lib/server/local/jobs.js';
import { createNetwork, getNetwork, listNetworks } from '../src/lib/server/local/people.js';
import { accessPath, defaultAccessSettings } from '../src/lib/server/access-settings.js';
import { passwordHash } from '../src/lib/server/access-auth.js';

test('colored job and people tags support creation, assignment, filters, Settings merge, responsive dialogs and draft recovery', async () => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-tags-ui-'));
	Object.assign(process.env, {
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	const first = tags.createTag({ collection: 'job', name: 'Career Fair', color: '#ffffff' }),
		second = tags.createTag({ collection: 'job', name: 'Referral', color: '#000000' }),
		networkTag = tags.createTag({ collection: 'person', name: 'Mentor' });
	const j = createJob({
		job_title: 'Tags QA',
		company_name: 'Example',
		tag_ids: [first.id, second.id]
	});
	const p = createNetwork({ name: 'Tag contact', tag_ids: [networkTag.id] });
	for (let i = 0; i < 24; i++)
		tags.createTag({ collection: 'job', name: `choice ${String(i).padStart(2, '0')}` });
	tags.createTag({ collection: 'job', name: 'a'.repeat(50), color: '#ffff00' });
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
	child.stdout.on('data', (x) => (logs += x));
	child.stderr.on('data', (x) => (logs += x));
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
				body: values,
				redirect: 'manual'
			});
		step = 'ordinary forms and API scope';
		const values = new URLSearchParams({
			name: 'Ordinary person',
			tags_present: '1',
			tag_ids: String(networkTag.id)
		});
		assert.equal((await post('/networks/new', values)).status, 303);
		const ordinary = listNetworks({ name: 'Ordinary person' }).networks[0];
		assert.equal(ordinary.tags[0].id, networkTag.id);
		assert.equal(
			(
				await post(
					`/networks/${ordinary.id}/edit`,
					new URLSearchParams({ name: 'Ordinary person', tags_present: '1' })
				)
			).status,
			303
		);
		assert.equal(getNetwork(ordinary.id).tags.length, 0);
		assert.equal(
			(
				await fetch(base + '/api/tags', {
					method: 'POST',
					headers: { origin: 'https://other.invalid', 'content-type': 'application/json' },
					body: JSON.stringify({ action: 'create', collection: 'job', name: 'bad' })
				})
			).status,
			403
		);
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 20000 });
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		const settle = async () => {
			await page.waitForNetworkIdle({ idleTime: 150, timeout: 10000 });
			await page.evaluate(async () => {
				await Promise.all(
					document
						.getAnimations()
						.filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
						.map((animation) => animation.finished.catch(() => {}))
				);
			});
		};
		const go = async (path) => {
			await page.goto(base + path, { waitUntil: 'networkidle0' });
		};
		const button = async (label, scope = '') => {
			await page.evaluate(
				(label, scope) => {
					const root = scope ? document.querySelector(scope) : document;
					const b = [...root.querySelectorAll('button')].find(
						(b) => b.getClientRects().length && b.textContent.trim() === label
					);
					if (!b) throw Error(`Missing button ${label} in ${scope}`);
					b.click();
				},
				label,
				scope
			);
			await settle();
		};
		const fill = async (label, value, scope = '[role="dialog"]') => {
			const id = await page.evaluate(
				(label, scope) => {
					const root = scope ? document.querySelector(scope) : document;
					const field = [...root.querySelectorAll('label')].find(
						(e) => e.textContent.replace('*', '').trim() === label
					);
					if (!field) throw Error(`Missing field ${label}`);
					return field.htmlFor;
				},
				label,
				scope
			);
			await page.locator(`[id="${id}"]`).fill(value);
		};
		// Tag search runs after a short pause in typing.
		const searched = async () => {
			await new Promise((r) => setTimeout(r, 500));
			await settle();
		};
		const dialog = () => page.waitForSelector('[role="dialog"]');
		const closed = () => page.waitForSelector('[role="dialog"]', { hidden: true });
		step = 'responsive chips and dialogs';
		for (const width of [320, 640, 767, 768, 1280]) {
			await page.setViewport({ width, height: 950 });
			await go(`/jobs/${j.id}`);
			await page.evaluate(
				(theme) => localStorage.setItem('saturday-theme', theme),
				width < 768 ? 'dark' : 'light'
			);
			await page.reload({ waitUntil: 'networkidle0' });
			await button('Edit tags');
			await dialog();
			assert(
				await page.$$eval('[role="dialog"] .tag-choice label', (els) =>
					els.every((el) => el.getBoundingClientRect().height >= 44)
				)
			);
			assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			await page.$eval('[role="dialog"] [data-slot="dialog-footer"]', (e) =>
				e.scrollIntoView({ block: 'end' })
			);
			const rects = await page.$$eval(
				'[role="dialog"] [data-slot="dialog-footer"] button',
				(buttons) =>
					buttons.map((b) => {
						const r = b.getBoundingClientRect();
						return { top: r.top, width: r.width };
					})
			);
			assert.equal(rects.length, 2);
			if (width < 768) {
				assert(rects[1].top < rects[0].top);
				assert(Math.abs(rects[0].width - rects[1].width) < 1);
			} else assert(Math.abs(rects[0].top - rects[1].top) < 2);
			await page.screenshot({ path: `/tmp/saturday-tags-${width}.png` });
			await page.keyboard.press('Escape');
			await closed();
		}
		step = 'inline create preserves person draft';
		await go('/networks/new');
		await fill('Name', 'Created with tags', '');
		await fill('Notes', 'Preserve this person note', '');
		await button('Create a tag');
		await fill('Tag name', 'Campus faIR', '');
		await fill('Hex color', '#12ABCD', '');
		await button('Create tag');
		assert.equal(await page.$eval('input[name="name"]', (e) => e.value), 'Created with tags');
		assert.equal(listNetworks({ name: 'Created with tags' }).total, 0);
		const created = tags.listTags({ collection: 'person', query: 'campus fair' }).tags[0];
		assert.equal(created.name, 'campus_fair');
		assert.equal(created.color, '#12abcd');
		await button('Save person');
		await page.waitForFunction(() => location.pathname.match(/^\/networks\/\d+$/));
		const createdPerson = listNetworks({ name: 'Created with tags' }).networks[0];
		assert.equal(createdPerson.tags[0].id, created.id);
		assert.equal(createdPerson.notes, 'Preserve this person note');
		step = 'duplicate create offers existing without recoloring';
		await go(`/jobs/${j.id}`);
		await button('Edit tags');
		await button('Create a tag');
		await fill('Tag name', 'CAREER__fair');
		await fill('Hex color', '#123456');
		await button('Create tag');
		await button('Use existing tag');
		await button('Save tags');
		await closed();
		assert.equal(
			tags.getTagSelection({ collection: 'job', tag_ids: [first.id] })[0].color,
			'#ffffff'
		);
		step = 'selection paging and filtering preserve context';
		await go('/jobs?view=all');
		await page.evaluate(() => document.querySelector('button.filter-toggle').click());
		await fill('Search tags', 'referral', '');
		await searched();
		await page.click(`[data-choice="${second.id}"] input`);
		await page.waitForFunction(
			(id) =>
				document.activeElement?.closest('[data-choice]')?.getAttribute('data-choice') ===
				String(id),
			{},
			second.id
		);
		await page.keyboard.press('Space');
		await page.keyboard.press('Space');
		await button('Apply filters');
		assert.equal(new URL(page.url()).searchParams.get('view'), 'all');
		assert.deepEqual(new URL(page.url()).searchParams.getAll('tag_ids'), [String(second.id)]);
		assert.equal(await page.$$eval('a.list-row', (els) => els.length), 1);
		assert(
			(await page.$eval('[aria-label="Applied filters"]', (e) => e.textContent)).includes(
				'referral'
			)
		);
		step = 'malformed bookmarked filters retain an editable error without invalid chip keys';
		for (const route of ['/jobs', '/networks']) {
			await go(route + '?tag_ids=bad&tag_ids=worse');
			assert.match(
				await page.$eval('[role="group"][aria-label="Tags"] [role="alert"]', (e) => e.textContent),
				/number|record|ID/i
			);
			await button('Apply filters');
			assert(!new URL(page.url()).searchParams.has('tag_ids'));
		}
		step = 'Settings edit color and validation';
		await go('/settings#tags');
		const group = '[role="group"][aria-label="Job tags"]';
		await page.click(`${group} button[aria-label="Edit career fair"]`);
		await dialog();
		await fill('Tag name', 'Career+Fair');
		await button('Save tag');
		assert.equal(
			await page.$eval('[role="dialog"] input[autocomplete="off"]', (e) => e.value),
			'Career+Fair'
		);
		await fill('Tag name', 'Career Fair');
		await fill('Hex color', '#ff0000');
		await button('Save tag');
		await closed();
		assert.equal(
			tags.getTagSelection({ collection: 'job', tag_ids: [first.id] })[0].color,
			'#ff0000'
		);
		step = 'Settings merge and unique counts';
		await button('Merge tags', group);
		await dialog();
		const fg = '[role="dialog"] [role="group"][aria-label="First tag"]',
			sg = '[role="dialog"] [role="group"][aria-label="Second tag"]';
		await fill('Search first tag', 'career fair', fg);
		await searched();
		await page.click(`${fg} [data-choice="${first.id}"] input`);
		assert.equal(
			await page.$eval('[role="dialog"] input[autocomplete="off"]', (e) => e.value),
			'career fair'
		);
		await fill('Search second tag', 'referral', sg);
		await searched();
		await page.click(`${sg} [data-choice="${second.id}"] input`);
		await fill('Tag name', 'Event leads');
		await fill('Hex color', '#11cc55');
		await button('Merge tags', '[role="dialog"]');
		await closed();
		assert.equal(getJob(j.id).tags.length, 1);
		assert.equal(getJob(j.id).tags[0].id, first.id);
		assert.equal(getJob(j.id).tags[0].display_name, 'event leads');
		assert.equal(searchJobs({ tag_ids: [second.id] }).total, 0);
		step = 'unavailable selected tag recovers without losing other draft choices';
		await go(`/networks/${p.id}`);
		await button('Edit tags');
		tags.deleteTag({ collection: 'person', tag_id: networkTag.id, confirm: true });
		await button('Save tags');
		await page.waitForFunction(() =>
			document.querySelector('[role="dialog"]')?.textContent.includes('Unavailable')
		);
		await page.click(`[data-choice="${networkTag.id}"] input`);
		await button('Save tags');
		await closed();
		assert.equal(getNetwork(p.id).tags.length, 0);
		step = 'delete inside edit and cancellation preserves color draft';
		await go('/settings#tags');
		await fill('Search job tags', 'event leads', group);
		await searched();
		await page.click(`${group} button[aria-label="Edit event leads"]`);
		await fill('Hex color', '#123456');
		await button('Delete tag');
		await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 2);
		await page.evaluate(() => {
			const dialogs = [...document.querySelectorAll('[role="dialog"]')];
			const last = dialogs.at(-1);
			[...last.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel').click();
		});
		await settle();
		assert.equal(
			await page.$eval('[role="dialog"] input[maxlength="7"]', (e) => e.value),
			'#123456'
		);
		await button('Save tag');
		await closed();
		step = 'confirmed tag deletion preserves people';
		const pg = '[role="group"][aria-label="People tags"]';
		await fill('Search people tags', 'campus fair', pg);
		await searched();
		await page.click(`${pg} button[aria-label="Edit campus fair"]`);
		await button('Delete tag');
		await page.evaluate(() => {
			const last = [...document.querySelectorAll('[role="dialog"]')].at(-1);
			[...last.querySelectorAll('button')]
				.find((b) => b.textContent.trim() === 'Delete tag')
				.click();
		});
		await settle();
		await closed();
		assert.equal(getNetwork(createdPerson.id).tags.length, 0);
		assert.equal(getNetwork(createdPerson.id).name, 'Created with tags');
		step = 'native form checkbox submission and invalid-draft retention';
		const plain = await browser.newPage();
		await plain.setJavaScriptEnabled(false);
		await plain.goto(base + `/jobs/${j.id}/edit`, { waitUntil: 'networkidle0' });
		await plain.click(`input[name="tag_ids"][value="${first.id}"]`);
		await Promise.all([
			plain.waitForNavigation({ waitUntil: 'networkidle0' }),
			plain.click('button[type="submit"]')
		]);
		assert.equal(getJob(j.id).tags.length, 0);
		const plainTag = tags.listTags({ collection: 'job', query: 'choice 00' }).tags[0];
		await plain.goto(base + '/jobs/new', { waitUntil: 'networkidle0' });
		await plain.type('input[name="job_title"]', 'Failed job draft');
		await plain.click(`input[name="tag_ids"][value="${plainTag.id}"]`);
		await Promise.all([
			plain.waitForNavigation({ waitUntil: 'networkidle0' }),
			plain.click('button[type="submit"]')
		]);
		assert.equal(await plain.$eval('input[name="job_title"]', (e) => e.value), 'Failed job draft');
		assert(await plain.$eval(`input[name="tag_ids"][value="${plainTag.id}"]`, (e) => e.checked));
		await plain.close();
		await go('/jobs?view=all&tag_ids=' + second.id);
		assert((await page.content()).includes('Unavailable tag #' + second.id));
		assert.equal(await page.$$eval('a.list-row', (els) => els.length), 0);
		await go('/settings#tags');
		await fill('Search job tags', 'event leads', group);
		await searched();
		step = 'expired sign-in retains edit draft and supports manual retry';
		await fill('Search job tags', 'event leads', group);
		await searched();
		await page.click(`${group} button[aria-label="Edit event leads"]`);
		await fill('Tag name', 'Retained after login');
		const protectedSettings = {
			...defaultAccessSettings(),
			password: await passwordHash('p'),
			generation: 2
		};
		await writeFile(accessPath(), JSON.stringify(protectedSettings));
		await button('Save tag');
		assert.equal(
			await page.$eval('[role="dialog"] input[autocomplete="off"]', (e) => e.value),
			'Retained after login'
		);
		assert.equal(
			await page.$eval('[role="dialog"] button[type="submit"]', (e) => e.disabled),
			false
		);
		const signin = await browser.newPage();
		await signin.goto(base + '/signin', { waitUntil: 'networkidle0' });
		await signin.type('#signin-password', 'p');
		await signin.click('button[type="submit"]');
		await signin.waitForFunction(() => !location.pathname.startsWith('/signin'));
		await signin.close();
		await button('Save tag');
		await closed();
		assert.equal(
			tags.getTagSelection({ collection: 'job', tag_ids: [first.id] })[0].name,
			'retained_after_login'
		);
		assert.deepEqual(errors, []);
	} catch (error) {
		if (browser)
			await (
				await browser.pages()
			)
				.at(-1)
				?.screenshot({ path: '/tmp/saturday-tags-failure.png', fullPage: true })
				.catch(() => {});
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
