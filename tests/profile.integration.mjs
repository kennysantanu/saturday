import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import {
	createDocument,
	listDocuments,
	setMasterDocument
} from '../src/lib/server/files/documents.js';
import {
	waitForDialogClosed,
	waitForPage,
	waitForSelectorReady,
	waitForValue
} from './helpers/wait-for.mjs';

test('profile: grouped slots, document picker, upload into a slot and clearing', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-profile-'));
	Object.assign(process.env, {
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	await createDocument({ filename: 'resume.md', content: '# Resume\n' });
	await createDocument({ filename: 'direction.md', content: '# Direction\n' });
	await createDocument({ filename: 'letter.html', content: '<html><body>Hi</body></html>\n' });
	for (let i = 1; i <= 6; i++) await createDocument({ filename: `note-${i}.md`, content: 'x\n' });
	const listing = await listDocuments({});
	const resume = listing.documents.find((d) => d.filename === 'resume.md');
	await setMasterDocument({
		designation: 'master_cv',
		id: resume.id,
		token: resume.token,
		catalog_token: listing.catalog_token
	});
	const upload = join(root, 'preferences.md');
	await writeFile(upload, '# Preferences\n');
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
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 30000 });
		const page = await browser.newPage(),
			errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.setViewport({ width: 1100, height: 900 });
		const text = (selector) =>
			page.$eval(selector, (e) => e.textContent.replace(/\s+/g, ' ').trim());
		const click = (selector, label) =>
			page.evaluate(
				(s, l) => {
					const el = [...document.querySelectorAll(s)].find((e) =>
						(e.getAttribute('aria-label') ?? e.textContent).includes(l)
					);
					if (!el) throw new Error(`No ${s} containing ${l}`);
					el.click();
				},
				selector,
				label
			);
		const summary = () => text('.page-meta');
		const options = () =>
			page.$$eval('.picker-option .picker-title', (nodes) =>
				nodes.map((n) => n.textContent.trim())
			);

		await page.goto(`${base}/profile`, { waitUntil: 'networkidle0' });
		assert.equal(await summary(), '1 of 5 set up');
		assert.deepEqual(
			await page.$$eval('main h2', (nodes) => nodes.map((n) => n.textContent.trim())),
			['About you', 'Templates']
		);
		assert.equal((await page.$$('.profile-slot')).length, 5);
		assert.equal(
			await page.$$eval(
				'.profile-slot [data-slot="badge"]',
				(n) => n.filter((b) => b.textContent.trim() === 'Not set').length
			),
			4
		);
		// Every repeated action says which slot it belongs to.
		const names = await page.$$eval('.profile-slot a, .profile-slot button', (nodes) =>
			nodes.map((n) => n.getAttribute('aria-label')).filter(Boolean)
		);
		assert.ok(names.includes('Select document for Career direction'), names.join('|'));
		assert.ok(names.includes('Edit Master CV'));
		assert.ok(names.includes('More actions for Master CV'));
		assert.match(await text('.profile-slot'), /resume\.md/);
		assert.match(await text('.profile-slot'), /Markdown · \d+ B ·/);

		// The picker lists only files the slot can use and keeps its choice across paging.
		await click('.profile-slot a', 'Select document for Career direction');
		await page.waitForSelector('[data-slot="dialog-content"] .picker-option');
		assert.match(await text('[data-slot="dialog-title"]'), /Select Career direction/);
		const first = await options();
		assert.equal(first.length, 5);
		assert.ok(
			first.every((name) => name.endsWith('.md')),
			first.join('|')
		);
		await new Promise((r) => setTimeout(r, 400)); // let the dialog finish opening
		await page.click('.picker-option:nth-child(2)');
		assert.ok(await page.$eval('.picker-option:nth-child(2) input', (i) => i.checked));
		const picked = first[1];
		await click('[data-slot="dialog-content"] button', 'Next page');
		await page.waitForFunction(() => location.search.includes('page=2'));
		await page.waitForFunction(
			(name) => document.querySelector('.picker-option .picker-title')?.textContent.trim() === name,
			{},
			picked
		);
		assert.ok(await page.$eval('.picker-option input', (i) => i.checked));
		await click('[data-slot="dialog-content"] button', 'Previous page');
		await page.waitForFunction(() => !location.search.includes('page=2'));

		// Search follows typing and lists only matches.
		await page.type('#picker_query', 'direction');
		await waitForPage(page, 'URL to include query=direction', () =>
			location.search.includes('query=direction')
		);
		await waitForValue(
			'picker options to show filtered matches',
			options,
			(items) => items.length === 2 && items.includes('direction.md')
		);
		assert.match(await text('[data-slot="dialog-content"] [role="status"]'), /matching search/);

		// Choosing a file from the filtered search results keeps it selected even if search is cleared,
		// then submitting assigns it to the slot and closes the dialog.
		await page.evaluate(() => {
			const match = [...document.querySelectorAll('.picker-option')].find((o) =>
				o.textContent.includes('direction.md')
			);
			if (!match) throw new Error('No .picker-option containing direction.md');
			match.click();
		});
		await waitForValue(
			'confirm button to become Use direction.md',
			() =>
				page.$$eval('[data-slot="dialog-content"] button', (nodes) =>
					nodes.map((n) => ({
						text: n.textContent.replace(/\s+/g, ' ').trim(),
						disabled: n.disabled
					}))
				),
			(buttons) => buttons.some((b) => b.text.includes('Use direction.md') && !b.disabled)
		);
		await waitForSelectorReady(page, '.search-clear', {
			label: 'search clear button',
			visible: true
		});
		await click('.search-clear', 'Clear search filenames');
		await waitForPage(
			page,
			'URL to clear query parameter',
			() => !location.search.includes('query=')
		);
		await waitForValue(
			'confirm button to remain Use direction.md after clearing search',
			() =>
				page.$$eval('[data-slot="dialog-content"] button', (nodes) =>
					nodes.map((n) => ({
						text: n.textContent.replace(/\s+/g, ' ').trim(),
						disabled: n.disabled
					}))
				),
			(buttons) => buttons.some((b) => b.text.includes('Use direction.md') && !b.disabled)
		);
		await click('[data-slot="dialog-content"] button', 'Use direction.md');
		await waitForDialogClosed(page, { label: 'Career direction picker dialog to close' });
		await waitForValue('profile summary to show 2 of 5', summary, (value) =>
			value.includes('2 of 5')
		);
		await waitForValue(
			'profile URL search string to clear',
			() => new URL(page.url()).search,
			(search) => search === ''
		);
		assert.equal(new URL(page.url()).search, '');

		// Uploading from the picker fills the slot and closes the dialog.
		await click('.profile-slot a', 'Select document for Assistant preferences');
		await waitForSelectorReady(page, '[data-slot="dialog-content"] .picker-option', {
			label: 'Assistant preferences picker options',
			visible: true
		});
		const chooser = page.waitForFileChooser();
		await click('[data-slot="dialog-content"] button', 'Upload');
		await (await chooser).accept([upload]);
		await waitForValue('profile summary to show 3 of 5 after upload', summary, (value) =>
			value.includes('3 of 5')
		);
		await waitForDialogClosed(page, { label: 'Assistant preferences picker dialog to close' });
		assert.match(await text('main'), /preferences\.md/);

		// Clearing keeps the file.
		await click('.profile-slot button', 'More actions for Master CV');
		await waitForSelectorReady(page, '[role="menuitem"]', {
			label: 'Master CV actions menu',
			visible: true
		});
		await click('[role="menuitem"]', 'Clear selection');
		await waitForValue(
			'Clear selection confirm button to be ready',
			() =>
				page.$$eval('[data-slot="dialog-content"] button', (nodes) =>
					nodes.map((n) => ({
						text: n.textContent.replace(/\s+/g, ' ').trim(),
						disabled: n.disabled
					}))
				),
			(buttons) => buttons.some((b) => b.text.includes('Clear selection') && !b.disabled)
		);
		await click('[data-slot="dialog-content"] button', 'Clear selection');
		await waitForValue('profile summary to show 2 of 5 after clearing', summary, (value) =>
			value.includes('2 of 5')
		);
		assert.ok(
			(await listDocuments({})).documents.some((d) => d.filename === 'resume.md'),
			'the cleared file stays in Documents'
		);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		child.kill();
	}
});
