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
import { waitForCondition, waitForSelectorReady } from './helpers/wait-for.mjs';

async function startTestApp() {
	const root = await mkdtemp(join(tmpdir(), 'saturday-editor-selection-'));
	const env = {
		...process.env,
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'code')
	};
	Object.assign(process.env, env);
	await createDocument({ filename: 'resume.md', content: '# Resume\n\n- one\n- two\n' });
	await createDocument({ filename: 'plain.md', content: '# Plain\n\nJust a paragraph.\n' });
	await createDocument({
		filename: 'notes.md',
		content: '# Notes\n\n- same item\n- middle item\n- same item\n'
	});
	await createDocument({ filename: 'other.md', content: '# Other\n\n- alpha\n- beta\n' });
	const docs = (await listDocuments({})).documents;
	const resume = docs.find((d) => d.filename === 'resume.md');
	const plain = docs.find((d) => d.filename === 'plain.md');
	const notes = docs.find((d) => d.filename === 'notes.md');
	const other = docs.find((d) => d.filename === 'other.md');

	const socket = createServer();
	await new Promise((r) => socket.listen(0, '127.0.0.1', r));
	const port = socket.address().port;
	await new Promise((r) => socket.close(r));
	const base = `http://127.0.0.1:${port}`;
	const child = spawn(process.execPath, ['scripts/start.mjs'], {
		cwd: resolve('.'),
		env: { ...env, PORT: String(port) },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let logs = '';
	child.stdout.on('data', (c) => (logs += c));
	child.stderr.on('data', (c) => (logs += c));
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
	return {
		root,
		base,
		resume,
		plain,
		notes,
		other,
		async close() {
			child.kill();
			await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
			await rm(root, { recursive: true, force: true });
		}
	};
}

async function doubleClickListItem(page, cdp, index = 0) {
	const target = await page.evaluate((idx) => {
		const items = [...document.querySelectorAll('.document-prose li')];
		const el = items[idx]?.querySelector('p') ?? items[idx];
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.x + 12, y: r.y + Math.min(10, r.height / 2) };
	}, index);
	assert(target, `list item ${index} should exist`);
	await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
	for (const n of [1, 2]) {
		const point = { x: target.x, y: target.y, button: 'left', clickCount: n };
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point });
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point });
	}
	return page.evaluate(() => getSelection()?.toString() ?? '');
}

test('visual editor keeps word selection beyond 500ms after typing and double-clicking', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const app = await startTestApp();
	let browser;
	try {
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('dialog', (dialog) => dialog.accept());
		await page.setViewport({ width: 1100, height: 900 });
		const cdp = await page.createCDPSession();

		await page.goto(`${app.base}/documents/${app.resume.id}?edit=1`, { waitUntil: 'networkidle0' });
		await waitForSelectorReady(page, '.markdown-editor .document-prose[contenteditable="true"]', {
			label: 'editable visual editor on direct load',
			visible: true
		});

		for (let round = 1; round <= 5; round++) {
			await page.evaluate(() => {
				const el = document.querySelector('.markdown-editor .document-prose');
				if (el instanceof HTMLElement) el.blur();
			});
			await page.click('.markdown-editor .document-prose');
			await page.keyboard.press('End');
			await page.keyboard.type(` r${round}`);
			const immediate = await doubleClickListItem(page, cdp, 0);
			assert.match(immediate, /\S/, `round ${round}: double-click selected a word`);

			await new Promise((r) => setTimeout(r, 600));

			const after = await page.evaluate(() => ({
				selection: getSelection()?.toString() ?? '',
				focused: Boolean(document.activeElement?.classList.contains('document-prose')),
				status:
					document.querySelector('.editor-bar-actions [role="status"]')?.textContent?.trim() ?? ''
			}));
			assert.match(
				after.selection,
				/\S/,
				`round ${round}: word selection survived beyond 500ms (was "${immediate}", became "${after.selection}")`
			);
			assert.equal(after.focused, true, `round ${round}: editor kept focus`);
			assert.equal(after.status, 'Unsaved changes', `round ${round}: dirty state preserved`);
		}
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await app.close();
	}
});

test('mount-time Edit navigation does not trigger a spurious setContent pass', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const app = await startTestApp();
	let browser;
	try {
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.setViewport({ width: 1100, height: 900 });

		const openEditAndCheck = async (filename, clickProse = false) => {
			await page.goto(`${app.base}/documents`, { waitUntil: 'networkidle0' });
			await page.evaluate(
				(name) =>
					[...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === name)?.click(),
				filename
			);
			await page.waitForSelector('.document-prose');
			await page.evaluate(() =>
				[...document.querySelectorAll('a')]
					.find((a) => a.textContent?.trim() === 'Edit' && a.href.includes('edit=1'))
					?.click()
			);
			await waitForSelectorReady(page, '.markdown-editor .document-prose[contenteditable="true"]', {
				label: `editable visual editor for ${filename} after clicking Edit`,
				visible: true
			});
			await new Promise((r) => setTimeout(r, 400));
			if (clickProse) {
				await page.click('.markdown-editor .document-prose');
				await new Promise((r) => setTimeout(r, 200));
			}
			const state = await page.evaluate(() => {
				const undoBtn = document.querySelector('.editor-toolbar button[aria-label="Undo"]');
				const prose = document.querySelector('.markdown-editor .document-prose');
				return {
					undoDisabled: undoBtn instanceof HTMLButtonElement ? undoBtn.disabled : null,
					canUndo: Boolean(prose?.editor?.can().undo()),
					status:
						document.querySelector('.editor-bar-actions [role="status"]')?.textContent?.trim() ?? ''
				};
			});
			assert.equal(
				state.canUndo,
				false,
				`${filename}: mount-time Edit navigation should not run setContent and push undo history`
			);
			assert.equal(state.undoDisabled, true, `${filename}: Undo button stays disabled`);
			assert.equal(state.status, 'No changes yet', `${filename}: status stays "No changes yet"`);
		};

		// Paragraph-ending document (no TrailingNode involvement).
		await openEditAndCheck('plain.md');
		// List-ending document: focusing also absorbs TrailingNode without marking dirty.
		await openEditAndCheck('resume.md', true);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await app.close();
	}
});

test('out-of-band updates preserve selection in the same block across identical blocks and handle in-place navigation', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const app = await startTestApp();
	let browser;
	try {
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('dialog', (dialog) => dialog.accept());
		await page.setViewport({ width: 1100, height: 900 });
		const cdp = await page.createCDPSession();

		const draftKey = `saturday-draft:documents:${app.notes.id}`;

		const setDraftAndOpen = async (content) => {
			// Navigate away from the editor first so onpagehide does not overwrite the synthetic draft.
			await page.goto(`${app.base}/documents`, { waitUntil: 'networkidle0' });
			await page.evaluate(
				({ key, content, updatedAt }) => {
					localStorage.setItem(
						key,
						JSON.stringify({ content, name: 'notes.md', updatedAt, savedAt: Date.now() })
					);
				},
				{ key: draftKey, content, updatedAt: app.notes.updated_at }
			);
			await page.goto(`${app.base}/documents/${app.notes.id}?edit=1`, {
				waitUntil: 'networkidle0'
			});
			await page.waitForFunction(() =>
				document.body.innerText.includes('Restore your unsaved draft')
			);
			await waitForSelectorReady(page, '.markdown-editor .document-prose[contenteditable="true"]', {
				label: 'editable visual editor',
				visible: true
			});
		};

		const selectedListItemIndex = () =>
			page.evaluate(() => {
				const sel = getSelection();
				const anchor = sel?.anchorNode;
				const el = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
				const li = el?.closest('li');
				const items = [...document.querySelectorAll('.document-prose li')];
				return {
					text: sel?.toString() ?? '',
					itemIndex: li ? items.indexOf(li) : -1
				};
			});

		// 1. Focus the 2nd identical list item ("same item" at index 2), then trigger Restore draft
		//    the way a user does (real click, blurring the editor). The diff transaction must keep
		//    the selection mapped onto the 2nd identical block (index 2), not index 0 or start of doc.
		await setDraftAndOpen(
			'# Notes\n\nInserted intro.\n\n- same item\n- middle item\n- same item\n'
		);
		const picked = await doubleClickListItem(page, cdp, 2);
		assert.equal(picked, 'same');
		assert.deepEqual(await selectedListItemIndex(), { text: 'same', itemIndex: 2 });

		await page.locator('button::-p-text(Restore draft)').click();
		await waitForCondition(
			'restored out-of-band content to reach visual editor',
			() =>
				page.evaluate(() =>
					Boolean(
						document.querySelector('.document-prose')?.textContent?.includes('Inserted intro.')
					)
				),
			{ timeoutMs: 5000 }
		);
		const afterSafeRestore = await page.evaluate(() => {
			const prose = document.querySelector('.markdown-editor .document-prose');
			const editor = prose?.editor;
			const wasFocused = document.activeElement === prose;
			const sel = editor?.state.selection;
			const selectedText =
				editor && sel ? editor.state.doc.textBetween(sel.from, sel.to, '\n', '\0') : '';
			const domPos = editor && sel ? editor.view.domAtPos(sel.from) : null;
			const anchorEl =
				domPos?.node.nodeType === Node.ELEMENT_NODE ? domPos.node : domPos?.node.parentElement;
			const li = anchorEl?.closest('li');
			const items = [...document.querySelectorAll('.document-prose li')];
			return {
				wasFocused,
				selectedText,
				itemIndex: li ? items.indexOf(li) : -1,
				hiddenValue:
					document.querySelector('#document-form input[name="content"]')?.getAttribute('value') ??
					'',
				status:
					document.querySelector('.editor-bar-actions [role="status"]')?.textContent?.trim() ?? ''
			};
		});
		assert.equal(afterSafeRestore.wasFocused, false, 'clicking Restore draft blurred the editor');
		assert.equal(afterSafeRestore.status, 'Unsaved changes');
		assert.match(afterSafeRestore.hiddenValue, /Inserted intro\./, 'page and editor agree');
		assert.equal(
			afterSafeRestore.selectedText,
			'same',
			'ProseMirror selection text survived range replacement'
		);
		assert.equal(
			afterSafeRestore.itemIndex,
			2,
			'selection stayed in the second identical list item, not the first'
		);
		// Refocusing and typing replaces the preserved word inside the 2nd identical list item.
		await page.evaluate(() => {
			document.querySelector('.markdown-editor .document-prose')?.editor?.view.focus();
		});
		await new Promise((r) => setTimeout(r, 50));
		await page.keyboard.type('updated');
		const listItems = await page.$$eval('.document-prose li', (els) =>
			els.map((e) => e.textContent?.trim() ?? '')
		);
		assert.deepEqual(
			listItems,
			['same item', 'middle item', 'updated item'],
			'typing after restore edited the second identical list item, leaving the first untouched'
		);

		// 2. Full replacement via real Restore draft click replaces content immediately and keeps
		//    page input and editor in agreement.
		await setDraftAndOpen('# Completely replaced\n\nNothing matches here.');
		const picked2 = await doubleClickListItem(page, cdp, 2);
		assert.equal(picked2, 'same');
		await page.locator('button::-p-text(Restore draft)').click();
		await waitForCondition(
			'replaced draft content to reach visual editor',
			() =>
				page.evaluate(() =>
					Boolean(
						document.querySelector('.document-prose')?.textContent?.includes('Completely replaced')
					)
				),
			{ timeoutMs: 5000 }
		);
		assert.match(
			await page.$eval('#document-form input[name="content"]', (e) => e.value),
			/Completely replaced/,
			'hidden form input matches replaced editor content'
		);
		assert.equal(
			await page.$eval('.editor-bar-actions [role="status"]', (e) => e.textContent?.trim()),
			'Unsaved changes'
		);

		// 3. In-place client-side navigation to another document reuses the mounted editor,
		//    replaces its content, and resets baseline/dirty state.
		await page.evaluate((otherId) => {
			localStorage.clear();
			window.__samePageInstance = true;
			const prose = document.querySelector('.markdown-editor .document-prose');
			if (prose) prose.__sameEditorElement = true;
			const link = document.createElement('a');
			link.id = 'client-nav-other';
			link.href = `/documents/${otherId}?edit=1`;
			link.textContent = 'Open other in place';
			document.getElementById('main')?.appendChild(link);
		}, app.other.id);
		await page.click('#client-nav-other');
		await page.locator('button::-p-text(Discard changes)').click();
		await waitForCondition(
			'in-place client navigation to load other.md into the existing editor',
			() =>
				page.evaluate(
					(otherId) =>
						location.pathname === `/documents/${otherId}` &&
						Boolean(document.querySelector('.document-prose')?.textContent?.includes('alpha')),
					app.other.id
				),
			{ timeoutMs: 5000 }
		);
		await new Promise((r) => setTimeout(r, 300));
		const afterNav = await page.evaluate(() => {
			const prose = document.querySelector('.markdown-editor .document-prose');
			return {
				samePage: Boolean(window.__samePageInstance),
				sameEditor: Boolean(prose?.__sameEditorElement),
				text: prose?.textContent ?? '',
				hiddenValue: document.querySelector('#document-form input[name="content"]')?.value ?? '',
				status:
					document.querySelector('.editor-bar-actions [role="status"]')?.textContent?.trim() ?? ''
			};
		});
		assert.equal(afterNav.samePage, true, 'navigation stayed in place without a full reload');
		assert.equal(afterNav.sameEditor, true, 'the existing MarkdownEditor instance was reused');
		assert.match(afterNav.text, /alpha/, 'in-place document navigation reached editor');
		assert.match(afterNav.hiddenValue, /alpha/, 'hidden form input updated on navigation');
		assert.equal(afterNav.status, 'No changes yet', 'baseline updated on in-place navigation');

		// Focusing the newly loaded list-ending document still absorbs TrailingNode cleanly.
		await page.click('.markdown-editor .document-prose');
		await new Promise((r) => setTimeout(r, 200));
		assert.equal(
			await page.$eval('.editor-bar-actions [role="status"]', (e) => e.textContent?.trim()),
			'No changes yet',
			'focusing after in-place navigation does not mark clean document dirty'
		);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await app.close();
	}
});

test('failed save does not overwrite text typed while the save was in flight', async (t) => {
	if (!existsSync(await puppeteer.executablePath())) return t.skip('Managed Chrome is required.');
	const app = await startTestApp();
	let browser;
	try {
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('dialog', (dialog) => dialog.accept());
		await page.setViewport({ width: 1100, height: 900 });

		await page.goto(`${app.base}/documents/${app.resume.id}?edit=1`, { waitUntil: 'networkidle0' });
		await waitForSelectorReady(page, '.markdown-editor .document-prose[contenteditable="true"]', {
			label: 'editable visual editor for failed save test',
			visible: true
		});

		// Advance the document on the server so the next save fails with a real conflict response
		// whose returned `values.content` holds only what was submitted before in-flight typing.
		const latest = await getDocument({ id: app.resume.id });
		await editDocument({
			id: app.resume.id,
			token: latest.token,
			content: '# Resume\n\n- one\n- two\n\nUpdated elsewhere.\n'
		});

		await page.click('.markdown-editor .document-prose');
		await page.keyboard.press('End');
		await page.keyboard.type(' before-save');

		let releaseSave;
		let saveInFlightResolve;
		const saveInFlight = new Promise((r) => (saveInFlightResolve = r));
		await page.setRequestInterception(true);
		page.on('request', (req) => {
			if (req.method() === 'POST' && req.url().includes('?/save')) {
				saveInFlightResolve();
				releaseSave = () => req.continue();
				return;
			}
			req.continue();
		});

		await page.keyboard.down('Control');
		await page.keyboard.press('s');
		await page.keyboard.up('Control');
		await saveInFlight;

		// Keep typing while the save request is still in flight.
		await page.keyboard.type(' during-save');
		await waitForCondition(
			'in-flight typing to appear in the editor before save fails',
			() =>
				page.evaluate(() =>
					Boolean(document.querySelector('.document-prose')?.textContent?.includes('during-save'))
				),
			{ timeoutMs: 5000 }
		);

		// Let the save request reach the server and return a 400 conflict failure with old values.
		releaseSave();
		await page.waitForSelector('[role="alert"]');
		await waitForCondition(
			'focusFirstError to move focus to the alert notice',
			() => page.evaluate(() => document.activeElement?.getAttribute('role') === 'alert'),
			{ timeoutMs: 5000 }
		);
		await new Promise((r) => setTimeout(r, 300));

		const afterFailure = await page.evaluate(() => ({
			editorText: document.querySelector('.document-prose')?.textContent ?? '',
			saveInput: document.querySelector('#document-form input[name="content"]')?.value ?? '',
			copyInput:
				document.querySelector('form[action="?/saveCopy"] input[name="content"]')?.value ?? '',
			status:
				document.querySelector('.editor-bar-actions [role="status"]')?.textContent?.trim() ?? ''
		}));
		assert.match(afterFailure.editorText, /before-save/, 'pre-save text survived failed save');
		assert.match(
			afterFailure.editorText,
			/during-save/,
			'in-flight typing was not overwritten by returned failed-save values'
		);
		assert.match(
			afterFailure.saveInput,
			/during-save/,
			'save form hidden input kept in-flight typing'
		);
		assert.match(
			afterFailure.copyInput,
			/during-save/,
			'save-as-copy form hidden input kept in-flight typing'
		);
		assert.equal(afterFailure.status, 'Unsaved changes');
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await app.close();
	}
});
