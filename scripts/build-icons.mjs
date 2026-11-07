// Regenerates the application icons in static/icons from src/lib/assets/favicon.svg:
//   saturday.ico   Windows shortcuts (16-256px, PNG entries)
//   saturday.icns  macOS application bundles (padded like Apple's template, with a soft shadow)
//   saturday.png   512px, Linux desktop entries and web manifests
//   saturday.svg   the source mark
// Run with `node scripts/build-icons.mjs` after changing the mark, then commit the output.
// It needs the development dependency puppeteer to rasterize the SVG; installs only read the files.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import puppeteer from 'puppeteer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'static', 'icons');
const full = await readFile(join(root, 'src/lib/assets/favicon.svg'), 'utf8');
// At 32px and below the third bar turns to mush and the horizon is too thin, so the small sizes
// drop the bar and thicken the horizon.
const small = full
	.replace(/<rect x="13" y="32"[^>]*\/>/, '')
	.replace(
		/<rect x="8" y="27.5" width="24" height="2.5" rx="1.25"/,
		'<rect x="7" y="27" width="26" height="3.5" rx="1.75"'
	);

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
// `inset` leaves room around the artwork: macOS icons sit inside a transparent margin (about 80%
// of the canvas) with a soft shadow, while Windows and Linux icons fill their square.
async function render(size, inset = false) {
	const svg = size <= 32 ? small : full;
	const art = inset ? Math.round(size * 0.8047) : size;
	const offset = Math.round((size - art) / 2);
	const shadow = inset
		? `filter:drop-shadow(0 ${(size * 0.01).toFixed(2)}px ${(size * 0.02).toFixed(2)}px rgba(0,0,0,.3));`
		: '';
	await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
	await page.setContent(
		`<style>html,body{margin:0;background:transparent}img{position:absolute;left:${offset}px;top:${offset}px;width:${art}px;height:${art}px;${shadow}}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`
	);
	await page.evaluate(() => document.images[0].decode());
	return Buffer.from(await page.screenshot({ type: 'png', omitBackground: true }));
}
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
// One page, so render the sizes one after another.
const png = {};
const mac = {};
for (const size of sizes) {
	png[size] = await render(size);
	mac[size] = await render(size, true);
}
await browser.close();

// ICO: a directory of PNG-compressed images (supported since Windows Vista).
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const header = Buffer.alloc(6 + 16 * icoSizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoSizes.length, 4);
let offset = header.length;
icoSizes.forEach((size, index) => {
	const entry = 6 + index * 16;
	header.writeUInt8(size === 256 ? 0 : size, entry);
	header.writeUInt8(size === 256 ? 0 : size, entry + 1);
	header.writeUInt16LE(1, entry + 4);
	header.writeUInt16LE(32, entry + 6);
	header.writeUInt32LE(png[size].length, entry + 8);
	header.writeUInt32LE(offset, entry + 12);
	offset += png[size].length;
});
await mkdir(out, { recursive: true });
await writeFile(join(out, 'saturday.ico'), Buffer.concat([header, ...icoSizes.map((s) => png[s])]));

// ICNS: typed PNG chunks (16, 32, 64, 128, 256, 512 and 1024 pixels).
const icnsTypes = { icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024 };
const chunks = Object.entries(icnsTypes).map(([type, size]) => {
	const head = Buffer.alloc(8);
	head.write(type, 0, 'ascii');
	head.writeUInt32BE(8 + mac[size].length, 4);
	return Buffer.concat([head, mac[size]]);
});
const total = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
const icnsHead = Buffer.alloc(8);
icnsHead.write('icns', 0, 'ascii');
icnsHead.writeUInt32BE(total, 4);
await writeFile(join(out, 'saturday.icns'), Buffer.concat([icnsHead, ...chunks]));
await writeFile(join(out, 'saturday.png'), png[512]);
await writeFile(join(out, 'saturday.svg'), full);
console.log('Wrote static/icons: saturday.ico, saturday.icns, saturday.png, saturday.svg');
