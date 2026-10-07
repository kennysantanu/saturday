import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';
import { fileType } from '../../file-types.js';
import {
	withFileLock,
	entryFor,
	checkToken,
	readText,
	createEntry,
	reject,
	UPLOAD_LIMIT
} from './store.js';
let rendering = false;
export async function pdfReadiness() {
	const ready = existsSync(await puppeteer.executablePath());
	return {
		ready,
		message: ready
			? 'PDF renderer is installed.'
			: 'Install Chrome with npx puppeteer browsers install chrome, then restart Saturday.'
	};
}
export async function generateDocumentPdf({ id, scope = 'documents', token }, origin = 'manual') {
	if (rendering) reject('BUSY', 'Another PDF is generating. Try again shortly.');
	const readiness = await pdfReadiness();
	if (!readiness.ready) reject('RENDERER_UNAVAILABLE', readiness.message);
	const source = await withFileLock(async (m) => {
		const d = entryFor(m, id, scope);
		checkToken(d.token, token);
		if (fileType(d.key).type !== 'html')
			reject('UNSUPPORTED_FORMAT', 'PDF generation requires saved HTML.');
		return { html: await readText(d), filename: d.key.split('/').at(-1) };
	});
	rendering = true;
	let browser;
	let timer;
	try {
		browser = await puppeteer.launch({ headless: true, timeout: 30000 });
		timer = setTimeout(() => browser?.close().catch(() => {}), 45000);
		const page = await browser.newPage();
		await page.setJavaScriptEnabled(false);
		await page.setRequestInterception(true);
		page.on('request', (r) => r.abort());
		await page.setContent(source.html, { waitUntil: 'domcontentloaded', timeout: 10000 });
		const validPageSize = await page.evaluate(() => {
			const sizes = [];
			const visit = (rules) => {
				for (const rule of rules) {
					if (rule.type === CSSRule.PAGE_RULE) {
						const size = rule.style.getPropertyValue('size').trim().toLowerCase();
						if (size) sizes.push(size);
					}
					if (rule.cssRules) visit(rule.cssRules);
				}
			};
			for (const sheet of document.styleSheets) {
				try {
					visit(sheet.cssRules);
				} catch {
					return false;
				}
			}
			return sizes.every((size) => {
				if (
					/^(auto|a[3-6]|letter|legal|ledger|tabloid)( (portrait|landscape))?$/.test(size) ||
					/^(portrait|landscape)$/.test(size)
				)
					return true;
				const parts = size.split(/\s+/);
				return (
					parts.length <= 2 &&
					parts.every((part) => {
						const m = /^(\d+(?:\.\d+)?)(mm|cm|in|px|pt|pc)$/.exec(part);
						if (!m) return false;
						const inches =
							Number(m[1]) *
							{ mm: 1 / 25.4, cm: 1 / 2.54, in: 1, px: 1 / 96, pt: 1 / 72, pc: 1 / 6 }[m[2]];
						return inches > 0 && inches <= 24;
					})
				);
			});
		});
		if (!validPageSize)
			reject(
				'VALIDATION',
				'Use a supported paper size or positive CSS page dimensions no larger than 24 inches.'
			);
		const bytes = Buffer.from(
			await page.pdf({
				format: 'A4',
				printBackground: true,
				preferCSSPageSize: true,
				displayHeaderFooter: false,
				timeout: 20000
			})
		);
		if (bytes.length > UPLOAD_LIMIT)
			reject('SIZE_LIMIT', 'Generated PDF exceeds the 25 MiB file limit.');
		if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
			reject('RENDERER', 'Renderer did not produce a PDF.');
		return await withFileLock(async (m) => {
			checkToken(entryFor(m, id, scope).token, token);
			return {
				...(await createEntry(m, {
					scope,
					name: source.filename.replace(/\.html?$/i, '.pdf'),
					origin,
					bytes,
					auto: true
				})),
				source_id: id,
				source_token: token
			};
		});
	} catch (e) {
		if (e.code) throw e;
		reject(
			'RENDERER',
			'PDF generation failed. Check the HTML, Chrome installation, fonts and available memory.'
		);
	} finally {
		clearTimeout(timer);
		await browser?.close();
		rendering = false;
	}
}
