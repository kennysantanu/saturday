import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import puppeteer from 'puppeteer';
import { createDocument, listDocuments } from '../src/lib/server/files/documents.js';
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
	await createDocument({ filename: 'other.md', content: '# Other\n\n- alpha\n- beta\n' });
	const docs = (await listDocuments({})).documents;
	const resume = docs.find((d) => d.filename === 'resume.md');
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
		other,
		async close() {
			child.kill();
			await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
			await rm(root, { recursive: true, force: true });
		}
	};
}

async function doubleClickFirstListItem(page, cdp) {
	const target = await page.$eval('.document-prose li p, .document-prose li', (e) => {
		const r = e.getBoundingClientRect();
		return { x: r.x + 12, y: r.y + Math.min(10, r.height / 2) };
	});
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
			const immediate = await doubleClickFirstListItem(page, cdp);
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

		await page.goto(`${app.base}/documents`, { waitUntil: 'networkidle0' });
		await page.evaluate(() =>
			[...document.querySelectorAll('a')]
				.find((a) => a.textContent?.trim() === 'resume.md')
				?.click()
		);
		await page.waitForSelector('.document-prose');
		await page.evaluate(() =>
			[...document.querySelectorAll('a')]
				.find((a) => a.textContent?.trim() === 'Edit' && a.href.includes('edit=1'))
				?.click()
		);
		await waitForSelectorReady(page, '.markdown-editor .document-prose[contenteditable="true"]', {
			label: 'editable visual editor after clicking Edit',
			visible: true
		});
		await new Promise((r) => setTimeout(r, 300));
		const childCount = await page.$eval('.document-prose', (el) => el.children.length);
		assert.equal(childCount, 2, 'mount-time Edit navigation should not re-run setContent');
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await app.close();
	}
});

test('out-of-band content changes still reach the editor, preserving safe selection and deferring unsafe changes to blur', async (t) => {
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

		const draftKey = `saturday-draft:documents:${app.resume.id}`;

		const setDraftAndOpen = async (content) => {
			// Navigate away from the editor first so onpagehide does not overwrite the synthetic draft.
			await page.goto(`${app.base}/documents`, { waitUntil: 'networkidle0' });
			await page.evaluate(
				({ key, content, updatedAt }) => {
					localStorage.setItem(
						key,
						JSON.stringify({ content, name: 'resume.md', updatedAt, savedAt: Date.now() })
					);
				},
				{ key: draftKey, content, updatedAt: app.resume.updated_at }
			);
			await page.goto(`${app.base}/documents/${app.resume.id}?edit=1`, {
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

		// 1. Out-of-band change while unfocused (normal Restore draft click) replaces editor content immediately.
		await setDraftAndOpen('# Resume\n\n- one\n- two\n\nOut-of-band restored line');
		await page.locator('button::-p-text(Restore draft)').click();
		await waitForCondition(
			'restored out-of-band content to reach visual editor',
			() =>
				page.evaluate(() =>
					Boolean(
						document
							.querySelector('.document-prose')
							?.textContent?.includes('Out-of-band restored line')
					)
				),
			{ timeoutMs: 5000 }
		);
		assert.equal(
			await page.$eval('.editor-bar-actions [role="status"]', (e) => e.textContent?.trim()),
			'Unsaved changes'
		);

		// 2. Out-of-band change while focused with unchanged surrounding text applies immediately and keeps selection.
		await setDraftAndOpen('# Resume\n\n- one\n- two\n\nAppended safely');
		const selectedSafe = await doubleClickFirstListItem(page, cdp);
		assert.match(selectedSafe, /one/);
		// Wait briefly for focus settle, then trigger Restore draft without blurring the editor.
		await new Promise((r) => setTimeout(r, 100));
		await page.evaluate(() => {
			const btn = [...document.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === 'Restore draft'
			);
			btn?.click();
		});
		await waitForCondition(
			'safe focused out-of-band content to apply while keeping selection',
			() =>
				page.evaluate(() =>
					Boolean(
						document.querySelector('.document-prose')?.textContent?.includes('Appended safely')
					)
				),
			{ timeoutMs: 5000 }
		);
		assert.match(
			await page.evaluate(() => getSelection()?.toString() ?? ''),
			/one/,
			'word selection survived safe focused out-of-band update'
		);

		// 3. Out-of-band change while focused that replaces surrounding text is parked until blur.
		await setDraftAndOpen('# Completely replaced\n\nNothing matches here.');
		const selectedDeferred = await doubleClickFirstListItem(page, cdp);
		assert.match(selectedDeferred, /one/);
		await new Promise((r) => setTimeout(r, 100));
		await page.evaluate(() => {
			const btn = [...document.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === 'Restore draft'
			);
			btn?.click();
		});
		await new Promise((r) => setTimeout(r, 200));
		const whileFocused = await page.evaluate(() => ({
			text: document.querySelector('.document-prose')?.textContent ?? '',
			selection: getSelection()?.toString() ?? ''
		}));
		assert.match(
			whileFocused.text,
			/one/,
			'focused editor was not clobbered by incompatible update'
		);
		assert.match(whileFocused.selection, /one/, 'selection remained intact while focused');

		await page.evaluate(() => {
			const el = document.querySelector('.markdown-editor .document-prose');
			if (el instanceof HTMLElement) el.blur();
		});
		await waitForCondition(
			'parked incompatible update to apply on blur',
			() =>
				page.evaluate(() =>
					Boolean(
						document.querySelector('.document-prose')?.textContent?.includes('Completely replaced')
					)
				),
			{ timeoutMs: 5000 }
		);

		// 4. Navigating to another document replaces content and resets baseline/dirty state.
		await page.evaluate(() => localStorage.clear());
		await page.goto(`${app.base}/documents/${app.other.id}?edit=1`, { waitUntil: 'networkidle0' });
		await waitForSelectorReady(page, '.markdown-editor .document-prose[contenteditable="true"]', {
			label: 'editable visual editor for other document',
			visible: true
		});
		await new Promise((r) => setTimeout(r, 300));
		assert.match(
			await page.$eval('.document-prose', (e) => e.textContent ?? ''),
			/alpha/,
			'external document navigation reached editor'
		);
		assert.equal(
			await page.$eval('.editor-bar-actions [role="status"]', (e) => e.textContent?.trim()),
			'No changes yet',
			'baseline updated on document load'
		);
		assert.deepEqual(errors, []);
	} finally {
		await browser?.close();
		await app.close();
	}
});
