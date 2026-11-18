import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import {
	createDocument,
	editDocument,
	getDocument,
	listDocuments
} from '../src/lib/server/files/documents.js';

test('document editor: no false unsaved state, formatting, Ctrl+S, rename in place and a ready New document form', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-document-editor-'));
	Object.assign(process.env, {
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	});
	await createDocument({ filename: 'resume.md', content: '# Resume\n\n- one\n- two\n' });
	await createDocument({
		filename: 'long.md',
		content: Array.from(
			{ length: 80 },
			(_, i) => `Paragraph ${i} with some words to fill a line.`
		).join('\n\n')
	});
	const tableText = '| a | b |\n| --- | --- |\n| `x y` | z |\n';
	await createDocument({ filename: 'table.md', content: tableText });
	await createDocument({ filename: 'copy.md', content: tableText });
	await createDocument({
		filename: 'letter.html',
		content: '<!doctype html>\n<html><body><h1>Cover</h1><p>Dear hiring manager</p></body></html>\n'
	});
	const hazardText =
		'Before <style> inside text.\n\n- item with <script> inside\n- second item\n\nAfter paragraph.\n';
	await createDocument({ filename: 'hazard.md', content: hazardText });
	const docs = (await listDocuments({})).documents;
	const hazardId = docs.find((d) => d.filename === 'hazard.md').id;
	const id = docs.find((d) => d.filename === 'resume.md').id;
	const tableId = docs.find((d) => d.filename === 'table.md').id;
	const copyId = docs.find((d) => d.filename === 'copy.md').id;
	const longId = docs.find((d) => d.filename === 'long.md').id;
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
		const status = () =>
			page.$eval('.editor-actionbar [role="status"]', (e) => e.textContent.trim());
		// Reaching a document by clicking (client-side navigation, not a reload) must not loop and
		// must leave the editor usable: the stored text ends with a newline, which the editor drops.
		const cdp = await page.createCDPSession();
		const clickLink = (text, hrefPart = '') =>
			page.evaluate(
				(text, hrefPart) =>
					[...document.querySelectorAll('a')]
						.find((a) => a.textContent.trim() === text && a.href.includes(hrefPart))
						?.click(),
				text,
				hrefPart
			);
		await page.goto(`${base}/documents`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 500));
		await clickLink('resume.md');
		await page.waitForSelector('.document-prose');
		await new Promise((r) => setTimeout(r, 500));
		await clickLink('Edit', 'edit=1');
		await page.waitForSelector('.editor-sticky');
		await new Promise((r) => setTimeout(r, 800));
		const proseBox = await page.$eval('.document-prose p, .document-prose li', (e) => {
			const r = e.getBoundingClientRect();
			return { x: r.x + 12, y: r.y + 10 };
		});
		for (const n of [1, 2]) {
			const point = { x: proseBox.x, y: proseBox.y, button: 'left', clickCount: n };
			await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
			await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
		}
		await new Promise((r) => setTimeout(r, 400));
		assert.match(
			await page.evaluate(() => getSelection().toString()),
			/\S/,
			'a word is selectable right after Edit'
		);
		assert.deepEqual(errors, [], 'no reactivity errors while navigating to the editor');
		// An HTML preview renders on its first visit, after the Markdown pages.
		await page.goto(`${base}/documents`, { waitUntil: 'networkidle0' });
		await new Promise((r) => setTimeout(r, 500));
		await clickLink('letter.html');
		await page.waitForSelector('iframe');
		await page.waitForFunction(() =>
			document.querySelector('iframe')?.getAttribute('srcdoc')?.includes('Dear hiring manager')
		);
		assert.deepEqual(errors, []);
		// Opening the editor is not a change.
		await page.goto(`${base}/documents/${id}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.markdown-editor .document-prose');
		await new Promise((r) => setTimeout(r, 400));
		assert.equal(await status(), 'No changes yet');
		// Toolbar names, heading menu and link row.
		for (const label of [
			'Bold',
			'Italic',
			'Strikethrough',
			'Bulleted list',
			'Numbered list',
			'Quote',
			'Link'
		])
			assert(await page.$(`.editor-toolbar [aria-label="${label}"]`), label);
		assert(await page.$('.editor-toolbar select[aria-label="Text style"]'));
		// Typing is a change; Ctrl+S saves and returns to the document.
		await page.click('.markdown-editor .document-prose');
		await page.keyboard.press('End');
		await page.keyboard.type(' typed');
		await page.waitForFunction(
			() =>
				document.querySelector('.editor-bar-actions [role="status"]')?.textContent.trim() ===
				'Unsaved changes'
		);
		// Words can be selected by double-click and by dragging, and a selection survives rendering.
		const wordBox = await page.$eval('.document-prose p, .document-prose li', (e) => {
			const r = e.getBoundingClientRect();
			return { x: r.x + 12, y: r.y + 10 };
		});
		for (const n of [1, 2]) {
			const point = { x: wordBox.x, y: wordBox.y, button: 'left', clickCount: n };
			await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
			await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
		}
		await new Promise((r) => setTimeout(r, 500));
		assert.match(await page.evaluate(() => getSelection().toString()), /\S/);
		await page.keyboard.press('ArrowRight');
		// A draft survives a reload (the leave prompt is accepted) and is offered back.
		await new Promise((r) => setTimeout(r, 900));
		page.once('dialog', (dialog) => dialog.accept());
		await page.goto(`${base}/documents/${id}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForFunction(() =>
			document.body.innerText.includes('Restore your unsaved draft')
		);
		await page.locator('button::-p-text(Restore draft)').click();
		await page.waitForFunction(
			() =>
				document.querySelector('.editor-bar-actions [role="status"]')?.textContent.trim() ===
				'Unsaved changes'
		);
		await page.waitForFunction(() =>
			document.querySelector('.markdown-editor')?.textContent.includes('typed')
		);
		// Strikethrough is part of the visual editor: it stays visual and is stored as ~~text~~.
		const strikeBox = await page.$eval('.document-prose h1, .document-prose li', (e) => {
			const r = e.getBoundingClientRect();
			return { x: r.x + 12, y: r.y + r.height / 2 };
		});
		for (const n of [1, 2]) {
			const point = { x: strikeBox.x, y: strikeBox.y, button: 'left', clickCount: n };
			await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
			await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
		}
		await page.click('.editor-toolbar [aria-label="Strikethrough"]');
		await new Promise((r) => setTimeout(r, 300));
		assert(await page.$('.markdown-editor .document-prose'), 'still in the visual editor');
		assert.match(await page.$eval('input[name="content"]', (e) => e.value), /~~/);
		await Promise.all([
			page.waitForNavigation({ waitUntil: 'networkidle0' }),
			page.keyboard.down('Control').then(() => page.keyboard.press('s'))
		]);
		await page.keyboard.up('Control');
		assert.equal(new URL(page.url()).pathname, `/documents/${id}`);
		await page.waitForFunction(() =>
			document.querySelector('.markdown-editor')?.textContent.includes('typed')
		);
		assert(
			await page.$('.markdown-editor .document-prose s, .markdown-editor .document-prose del')
		);
		// Detail page: metadata and an actions menu; rename keeps you on the document.
		assert.match(await page.$eval('.page-meta', (e) => e.textContent), /Markdown · /);
		// Let the client-side navigation finish hydrating before opening the menu.
		await page.waitForSelector('button[aria-label^="More actions for"]');
		await new Promise((r) => setTimeout(r, 800));
		await (await page.$('button[aria-label^="More actions for"]')).click();
		await page.locator('[role="menuitem"]::-p-text(Rename)').click();
		await page.waitForSelector('[role="dialog"] input[name="filename"]');
		await page.$eval('[role="dialog"] input[name="filename"]', (e) => (e.value = ''));
		await page.type('[role="dialog"] input[name="filename"]', 'cv.md');
		await Promise.all([
			page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('cv.md')),
			page.click('[role="dialog"] button[type="submit"]')
		]);
		assert.equal(new URL(page.url()).pathname, `/documents/${id}`);
		// New document: name preselected, placeholder shown, suffix attached.
		await page.goto(`${base}/documents/new`, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.markdown-editor .document-prose');
		assert.equal(await page.$eval('#document_name', (e) => e.value), 'Untitled');
		assert.equal(await page.evaluate(() => document.activeElement?.id), 'document_name');
		assert.match(await page.$eval('.editor-placeholder', (e) => e.textContent), /Start writing/);
		assert.equal(await page.$eval('.input-affix .affix', (e) => e.textContent), '.md');
		assert.equal(await status(), 'Not saved yet');
		await page.click('.markdown-editor .document-prose');
		await page.keyboard.type('Hello');
		await Promise.all([
			page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Untitled.md')),
			page.click('.editor-bar button[type="submit"]')
		]);
		// The toolbar stays pinned while a long document scrolls, on desktop and on a phone.
		await page.goto(`${base}/documents/${longId}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.editor-sticky');
		await page.evaluate(() => window.scrollTo(0, 1500));
		await new Promise((r) => setTimeout(r, 300));
		const pinned = () =>
			page.$eval('.editor-sticky', (e) => Math.round(e.getBoundingClientRect().top));
		const desktopTop = await pinned();
		assert(desktopTop >= 60 && desktopTop <= 120, `desktop toolbar top ${desktopTop}`);
		assert.equal(await page.$eval('.editor-actionbar', (e) => getComputedStyle(e).display), 'none');
		await page.setViewport({ width: 390, height: 700 });
		await page.goto(`${base}/documents/${longId}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.editor-sticky');
		await page.evaluate(() => window.scrollTo(0, 1500));
		await new Promise((r) => setTimeout(r, 300));
		const phoneTop = await pinned();
		assert(phoneTop >= 0 && phoneTop <= 24, `phone toolbar top ${phoneTop}`);
		assert.notEqual(
			await page.$eval('.editor-actionbar', (e) => getComputedStyle(e).display),
			'none'
		);
		assert.equal(
			await page.$eval('.editor-bar-actions', (e) => getComputedStyle(e).display),
			'none'
		);
		// One tab stop in the toolbar; arrow keys move within it.
		assert.equal(await page.$$eval('.editor-toolbar [tabindex="0"]', (e) => e.length), 1);
		assert.deepEqual(errors, []);
		// A space typed inside code in a table cell would be squeezed out on save. Save is refused, the
		// stored file is untouched, and the "Not saved yet" notice appears and takes focus.
		await page.setViewport({ width: 1100, height: 900 });
		await page.goto(`${base}/documents/${tableId}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.markdown-editor .document-prose td code');
		await new Promise((r) => setTimeout(r, 400));
		await page.click('.markdown-editor .document-prose td code');
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type(' ');
		assert.equal(await page.$eval('.document-prose td code', (e) => e.textContent), 'x  y');
		await page.keyboard.down('Control');
		await page.keyboard.press('s');
		await page.keyboard.up('Control');
		const notice = await page.waitForSelector('[role="alert"]');
		assert.match(await notice.evaluate((e) => e.textContent), /Not saved yet/);
		// The refused save must not unmount the live editor: it holds the only intact copy of the edit.
		assert.equal(
			await page.$('#document_content'),
			null,
			'the source view did not replace the editor'
		);
		assert.equal(
			await page.$eval('.document-prose td code', (e) => e.textContent),
			'x  y',
			'the edit is still in the visual editor'
		);
		assert.equal(
			await page.evaluate(() => document.activeElement?.getAttribute('role')),
			'alert',
			'focus moves to the notice'
		);
		assert.equal(await status(), 'Not saved yet');
		assert.equal(new URL(page.url()).pathname, `/documents/${tableId}`);
		assert.equal(
			(await listDocuments({})).documents.find((d) => d.id === tableId).size,
			tableText.length,
			'the stored file was not rewritten'
		);
		// The notice does not block the editor: correct the edit in place and save again.
		await page.click('.markdown-editor .document-prose td code');
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.press('Backspace');
		assert.equal(await page.$eval('.document-prose td code', (e) => e.textContent), 'x y');
		await page.keyboard.down('Control');
		await page.keyboard.press('s');
		await page.keyboard.up('Control');
		await page.waitForFunction(() => !new URL(location.href).searchParams.has('edit'), {
			timeout: 10000
		});
		assert.equal(
			await page.evaluate(() => document.body.innerText.includes('Not saved yet')),
			false,
			'recovered save shows no refusal notice'
		);
		const recovered = (await getDocument({ id: tableId, include_content: true })).content;
		assert.match(recovered, /`x y`/, 'the corrected edit was saved');
		assert.doesNotMatch(recovered, /x {2}y/);
		// Put the original bytes back so the scenarios below start from the same file.
		const after = await getDocument({ id: tableId });
		await editDocument({ id: tableId, token: after.token, content: tableText });
		// Bypass 1: switching to Markdown must not destroy lossy live edits and then let source save them.
		// Pages left with unsaved edits ask before leaving; accept so each scenario starts fresh.
		page.on('dialog', (dialog) => dialog.accept());
		// Type the extra space inside the code span; retry in case the editor was still settling.
		const typeCodeSpace = async () => {
			for (let attempt = 0; attempt < 5; attempt++) {
				await new Promise((r) => setTimeout(r, 500));
				await page.click('.markdown-editor .document-prose td code');
				await page.keyboard.press('Home');
				await page.keyboard.press('ArrowRight');
				await page.keyboard.type(' ');
				if ((await page.$eval('.document-prose td code', (e) => e.textContent)) === 'x  y') return;
			}
			assert.fail('could not type the extra space inside the code span');
		};
		const lossyEdit = async (docId) => {
			await page.goto(`${base}/documents/${docId}?edit=1`, { waitUntil: 'networkidle0' });
			await page.waitForSelector('.markdown-editor .document-prose td code');
			await typeCodeSpace();
		};
		const stored = async (docId) =>
			(await listDocuments({})).documents.find((d) => d.id === docId).size;
		await lossyEdit(tableId);
		await page.locator('.segmented button::-p-text(Markdown)').click();
		const switchNotice = await page.waitForSelector('[role="alert"]');
		assert.match(await switchNotice.evaluate((e) => e.textContent), /Can’t show Markdown yet/);
		assert.equal(await page.$('#document_content'), null, 'the visual editor was not discarded');
		assert.equal(await page.$eval('.document-prose td code', (e) => e.textContent), 'x  y');
		assert.equal(await stored(tableId), tableText.length, 'nothing was saved');
		// Crash: the draft keeps the live document, so the lossy edit (and its exact text) survives a reload,
		// and a draft whose Markdown equals the stored file is not discarded as "no changes".
		await new Promise((r) => setTimeout(r, 1000));
		await page.goto(`${base}/documents/${tableId}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForFunction(() =>
			document.body.innerText.includes('Restore your unsaved draft')
		);
		await page.waitForSelector('.markdown-editor .document-prose td code');
		await page.locator('button::-p-text(Restore draft)').click();
		await page.waitForFunction(
			() => document.querySelector('.document-prose td code')?.textContent === 'x  y',
			{ timeout: 5000 }
		);
		// Path 2: an edit that serializes to the same Markdown still reschedules the draft write.
		await new Promise((r) => setTimeout(r, 1000));
		await page.evaluate(() => localStorage.clear());
		await page.click('.markdown-editor .document-prose td code');
		await page.keyboard.press('Home');
		await page.keyboard.press('ArrowRight');
		await page.keyboard.type(' ');
		await page.waitForFunction(
			() => document.querySelector('.document-prose td code')?.textContent === 'x   y',
			{ timeout: 5000 }
		);
		await new Promise((r) => setTimeout(r, 1200));
		assert.match(
			await page.evaluate(() => JSON.stringify(Object.values(localStorage))),
			/x {3}y/,
			'a change invisible in Markdown still rewrote the draft'
		);
		// Path 1: restoring a draft with live JSON while in source view keeps that JSON for Visual and for later drafts.
		await page.goto(`${base}/documents/${tableId}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForFunction(() =>
			document.body.innerText.includes('Restore your unsaved draft')
		);
		await page.waitForSelector('.markdown-editor .document-prose');
		await page.locator('.segmented button::-p-text(Markdown)').click();
		await page.waitForSelector('#document_content');
		await page.locator('button::-p-text(Restore draft)').click();
		await new Promise((r) => setTimeout(r, 1200));
		assert.match(
			await page.evaluate(() => JSON.stringify(Object.values(localStorage))),
			/x {3}y/,
			'the draft kept its live document through a source-mode restore'
		);
		await page.$eval('.segmented button:first-child', (e) => e.click());
		await page.waitForFunction(
			() => document.querySelector('.document-prose td code')?.textContent === 'x   y',
			{ timeout: 5000 }
		);
		// Bypass 2: the save-as-copy form runs the same guard. A conflict makes the copy form appear.
		await page.goto(`${base}/documents/${copyId}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.markdown-editor .document-prose td code');
		await new Promise((r) => setTimeout(r, 400));
		const current = await getDocument({ id: copyId });
		await editDocument({ id: copyId, token: current.token, content: `${tableText}\nChanged.\n` });
		await page.click('.markdown-editor .document-prose td:last-child');
		await page.keyboard.type('q');
		await page.keyboard.down('Control');
		await page.keyboard.press('s');
		await page.keyboard.up('Control');
		await page.waitForSelector('form[action="?/saveCopy"]');
		await page.waitForFunction(() => document.body.innerText.includes('changed elsewhere'));
		await page.waitForSelector('.markdown-editor .document-prose td code');
		await typeCodeSpace();
		await page.click('form[action="?/saveCopy"] button[type="submit"]');
		await page.waitForFunction(() =>
			[...document.querySelectorAll('[role="alert"]')].some((e) =>
				e.textContent.includes('no copy was saved')
			)
		);
		assert.equal(
			(await listDocuments({})).documents.some((d) => d.filename === 'copy-copy.md'),
			false,
			'no copy was written'
		);
		// A refused copy is not a save in flight: the button is live and leaving still asks first.
		assert.equal(
			await page.$eval('.editor-bar button[type="submit"]', (e) => e.textContent.trim()),
			'Save',
			'the save button does not claim a save is running'
		);
		let leavePrompted = false;
		const noteLeave = (dialog) => {
			if (dialog.type() === 'beforeunload') leavePrompted = true;
		};
		page.on('dialog', noteLeave);
		await page.goto(`${base}/documents/${tableId}?edit=1`, { waitUntil: 'networkidle0' });
		page.off('dialog', noteLeave);
		assert.equal(leavePrompted, true, 'leaving after a refused copy still prompts');
		// Restore: a draft the visual editor cannot hold must not be loaded into it.
		await page.waitForSelector('.markdown-editor .document-prose');
		await new Promise((r) => setTimeout(r, 400));
		await page.evaluate(() => localStorage.clear());
		await page.locator('.segmented button::-p-text(Markdown)').click();
		await page.waitForSelector('#document_content');
		await page.click('#document_content');
		await page.keyboard.down('Control');
		await page.keyboard.press('a');
		await page.keyboard.up('Control');
		await page.keyboard.type('Draft title\n===');
		await new Promise((r) => setTimeout(r, 1000));
		await page.goto(`${base}/documents/${tableId}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForFunction(() =>
			document.body.innerText.includes('Restore your unsaved draft')
		);
		await page.waitForSelector('.markdown-editor .document-prose');
		await page.locator('button::-p-text(Restore draft)').click();
		await page.waitForSelector('#document_content');
		assert.equal(await page.$('.markdown-editor'), null, 'visual mode was not kept');
		assert.match(await page.$eval('#document_content', (e) => e.value), /Draft title\n===/);
		assert.match(await page.$eval('p[role="status"]', (e) => e.textContent), /headings underlined/);
		await page.evaluate(() => localStorage.clear());
		// Bypass 3: Visual pressed inside the 400 ms debounce must re-check the text as typed now.
		await page.goto(`${base}/documents/${tableId}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.markdown-editor .document-prose');
		await new Promise((r) => setTimeout(r, 400));
		await page.locator('.segmented button::-p-text(Markdown)').click();
		await page.waitForSelector('#document_content');
		await page.click('#document_content');
		await page.keyboard.down('Control');
		await page.keyboard.press('a');
		await page.keyboard.up('Control');
		await page.keyboard.type('Title\n===');
		await page.$eval('.segmented button:first-child', (e) => e.click());
		await new Promise((r) => setTimeout(r, 100));
		assert.notEqual(await page.$('#document_content'), null, 'stayed in the source view');
		assert.equal(await page.$('.markdown-editor'), null, 'visual mode was not entered');
		assert.match(await page.$eval('p[role="status"]', (e) => e.textContent), /headings underlined/);
		// Real browser: literal tags must not swallow the text after them (the unit suite has no DOMParser).
		const hazardProse = () => page.$eval('.markdown-editor .document-prose', (e) => e.innerText);
		const expectHazardText = (prose, label) => {
			for (const part of [
				'Before <style> inside text.',
				'item with <script> inside',
				'second item',
				'After paragraph.'
			])
				assert(
					prose.includes(part),
					`${label}: "${part}" is missing from ${JSON.stringify(prose)}`
				);
		};
		await page.setViewport({ width: 1280, height: 800 });
		await page.goto(`${base}/documents/${hazardId}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.markdown-editor .document-prose');
		assert.equal(
			await page.$('#document_content'),
			null,
			'opened in the visual editor, not source'
		);
		assert.equal(
			await page.$eval('.segmented button:first-child', (e) => e.getAttribute('aria-pressed')),
			'true',
			'Visual is the active mode'
		);
		expectHazardText(await hazardProse(), 'opened');
		await new Promise((r) => setTimeout(r, 400));
		await page.click('.markdown-editor .document-prose > p:last-child');
		await page.keyboard.press('End');
		await page.keyboard.type(' Edited.');
		await page.keyboard.down('Control');
		await page.keyboard.press('s');
		await page.keyboard.up('Control');
		await page.waitForFunction(
			() => !location.search.includes('edit') || document.body.innerText.includes('Edited.'),
			{ timeout: 10000 }
		);
		let saved;
		for (let i = 0; i < 50; i++) {
			saved = (await getDocument({ id: hazardId, include_content: true })).content;
			if (saved.includes('Edited.')) break;
			await new Promise((r) => setTimeout(r, 200));
		}
		assert.match(saved, /After paragraph\. Edited\./, 'the edit was saved');
		// Tags are saved as text (`&lt;style&gt;`), as the design guide states, and read back as the same text.
		for (const part of [
			'Before &lt;style&gt; inside text.',
			'- item with &lt;script&gt; inside\n- second item'
		])
			assert(saved.includes(part), `saved file keeps "${part}": ${JSON.stringify(saved)}`);
		await page.goto(`${base}/documents/${hazardId}?edit=1`, { waitUntil: 'networkidle0' });
		await page.waitForSelector('.markdown-editor .document-prose');
		expectHazardText(await hazardProse(), 'reopened');
	} finally {
		await browser?.close();
		child.kill();
		await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
		await rm(root, { recursive: true, force: true });
	}
});
