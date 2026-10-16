import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { request } from 'node:http';
import puppeteer from 'puppeteer';
import { phoneAddresses } from '../src/lib/server/access-network.js';
const exec = promisify(execFile);
async function waitFor(check) {
	const end = Date.now() + 25000;
	while (Date.now() < end) {
		try {
			if (await check()) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error('LAN transition timed out.');
}
function http(base, path, { method = 'GET', fields, headers = {} } = {}) {
	return new Promise((resolve, reject) => {
		const body = fields ? new URLSearchParams(fields).toString() : undefined;
		const req = request(
			new URL(path, base),
			{
				method,
				headers: {
					accept: 'text/html',
					...(fields !== undefined
						? {
								'content-type': 'application/x-www-form-urlencoded',
								'content-length': Buffer.byteLength(body)
							}
						: {}),
					...headers
				}
			},
			(res) => {
				let text = '';
				res.setEncoding('utf8');
				res.on('data', (c) => (text += c));
				res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
			}
		);
		req.setTimeout(2000, () => req.destroy(new Error('HTTP timeout')));
		req.on('error', reject);
		req.end(body);
	});
}
test('LAN opt-in, pending restart, all password modes, actual network origins, and remote host-control isolation', async (t) => {
	const candidates = phoneAddresses(3000).filter((a) => !a.virtual);
	if (!candidates.length)
		return t.skip('No external IPv4 interface is available; actual-address testing requires one.');
	if (!existsSync(await puppeteer.executablePath()))
		return t.skip('Chrome is required for LAN Settings workflow verification.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-lan-'));
	const socket = createServer();
	await new Promise((r) => socket.listen(0, '127.0.0.1', r));
	const port = socket.address().port;
	await new Promise((r) => socket.close(r));
	const env = {
		...process.env,
		SATURDAY_PROJECT_ROOT: resolve('.'),
		SATURDAY_DB_PATH: join(root, 'saturday.db'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'extension-code'),
		SATURDAY_INSTALLATION_PATH: '',
		PORT: String(port),
		ADDRESS_HEADER: 'x-forwarded-for',
		HOST_HEADER: 'x-forwarded-host',
		PROTOCOL_HEADER: 'x-forwarded-proto'
	};
	const run = async (file, ...args) =>
		JSON.parse(
			(await exec(process.execPath, [file, ...args], { env, maxBuffer: 1024 * 1024 })).stdout
		);
	const settings = async () => JSON.parse(await readFile(join(root, 'access.json')));
	const status = () => run('scripts/access.mjs', 'status', '--json');
	let browser,
		stage = 'setup';
	const local = `http://127.0.0.1:${port}`;
	let lan = `http://${candidates[0].address}:${port}`;
	try {
		const setup = await run(
			'scripts/setup.mjs',
			'--skip-dependencies',
			'--skip-build',
			'--skip-pdf',
			'--json'
		);
		env.SATURDAY_INSTALLATION_PATH = setup.descriptor_path;
		await run('scripts/start.mjs', '--background', '--json');
		assert.equal((await status()).effective_allow_lan, false);
		await assert.rejects(http(lan, '/jobs'));
		await assert.rejects(run('scripts/access.mjs', 'lan', '--enable'));
		assert.equal((await settings()).allow_lan, false);
		const cliEnabled = await run('scripts/access.mjs', 'lan', '--enable', '--confirm');
		assert.equal(cliEnabled.saved_allow_lan, true);
		assert.equal(cliEnabled.effective_allow_lan, false);
		assert.equal(cliEnabled.restart_required, true);
		assert.equal(cliEnabled.server_stopped, false);
		await run('scripts/access.mjs', 'lan', '--disable');
		assert.equal((await status()).restart_required, false);
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 10000 });
		const desktop = await browser.newPage();
		await desktop.setViewport({ width: 1280, height: 960 });
		await desktop.goto(local + '/settings#lan', { waitUntil: 'networkidle0' });
		await desktop.click('#lan button[type="button"]');
		await desktop.waitForSelector('[role="dialog"]');
		assert.ok(
			(await desktop.$eval('[role="dialog"]', (e) => e.innerText)).includes('HTTP does not encrypt')
		);
		await desktop.click('[role="dialog"] button[type="button"]');
		await desktop.waitForSelector('[role="dialog"]', { hidden: true });
		assert.equal(
			(await settings()).allow_lan,
			false,
			'cancelling must not change saved preference'
		);
		const unconfirmed = await http(local, '/settings?/lan', {
			method: 'POST',
			fields: { operation: 'enable' },
			headers: { origin: local }
		});
		assert.equal(unconfirmed.status, 400);
		await desktop.click('#lan button[type="button"]');
		await desktop.waitForSelector('button[form="allow-lan"]', { visible: true });
		await desktop.click('button[form="allow-lan"]');
		await desktop.waitForFunction(() =>
			document.body.innerText.includes('Restart Saturday to apply this change?')
		);
		const later = await desktop.evaluateHandle(() =>
			[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Later')
		);
		await later.asElement().click();
		await desktop.waitForNetworkIdle();
		assert.equal((await status()).saved_allow_lan, true);
		assert.equal((await status()).effective_allow_lan, false);
		assert.equal((await status()).restart_required, true);
		assert.equal((await run('scripts/start.mjs', '--background', '--json')).created, false);
		await assert.rejects(
			http(lan, '/jobs'),
			'opening a running instance must not apply pending LAN'
		);
		stage = 'apply LAN';
		await desktop.click('#lan-restart button');
		await waitFor(async () => (await status()).effective_allow_lan === true);
		await desktop.waitForSelector('#phone-address-0');
		await desktop.waitForNetworkIdle();
		lan = (await status()).phone_addresses.find((a) => a.address === candidates[0].address).url;
		assert.equal((await http(lan, '/jobs')).status, 200);
		assert.equal((await http(lan, '/health')).status, 404);
		assert.equal(
			(await http(lan, '/jobs', { headers: { host: 'evil.example:' + port } })).status,
			421
		);
		assert.equal(
			(
				await http(lan, '/jobs/new', {
					method: 'POST',
					fields: { job_title: 'No CSRF', company_name: 'No' },
					headers: { origin: 'http://evil.example' }
				})
			).status,
			403
		);
		const phoneSettings = await http(lan, '/settings');
		assert.equal(phoneSettings.status, 200);
		assert.ok(
			!(phoneSettings.headers['set-cookie'] ?? []).some((c) => c.startsWith('saturday-control-'))
		);
		await desktop.goto(local + '/settings#lan', { waitUntil: 'networkidle0' });
		await desktop.evaluate(() =>
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { writeText: () => Promise.reject(new Error('Clipboard unavailable')) }
			})
		);
		const copy = await desktop.evaluateHandle(() =>
			[...document.querySelectorAll('#lan button')].find(
				(b) => b.textContent?.trim() === 'Copy phone address'
			)
		);
		await copy.asElement().click();
		await desktop.waitForFunction(() =>
			document.body.innerText.includes('Select the address text')
		);
		await desktop.$eval('#lan', (e) => e.scrollIntoView());
		await desktop.screenshot({ path: '/tmp/saturday-lan-desktop.png' });
		const blockHostControls = async () => {
			const cookie = (await desktop.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
			const headers = {
				cookie,
				host: new URL(local).host,
				origin: local,
				'x-forwarded-for': '127.0.0.1',
				'x-forwarded-host': new URL(local).host,
				'x-forwarded-proto': 'http',
				'x-saturday-protocol': 'https'
			};
			for (const [path, fields] of [
				['/settings?/lan', { operation: 'disable' }],
				['/settings?/password', { operation: 'timeout', hours: '2' }],
				['/settings?/serverControl', { operation: 'stop', confirm: 'true' }],
				['/settings?/loginStartup', {}],
				['/settings?/openFolder', {}],
				['/settings?/checkUpdates', {}],
				['/settings?/installationOperation', { operation: 'uninstall', confirm: 'true' }]
			])
				assert.equal(
					(await http(lan, path, { method: 'POST', fields, headers })).status,
					403,
					path
				);
			assert.equal((await http(lan, '/settings/installation', { headers })).status, 403);
			assert.equal((await http(lan, '/health', { headers })).status, 404);
		};
		await blockHostControls();
		stage = 'protect LAN';
		await desktop.goto(local + '/settings#password', { waitUntil: 'networkidle0' });
		await desktop.type('#enable-password', '7');
		await desktop.type('#enable-confirm', '7');
		await desktop.click('form[action="?/password"] button[type="submit"]');
		await desktop.waitForSelector('#logout-all');
		await desktop.waitForNetworkIdle();
		await blockHostControls();
		assert.equal(
			(await http(lan, '/jobs', { headers: { accept: 'application/json' } })).status,
			401
		);
		const context = await browser.createBrowserContext(),
			phone = await context.newPage();
		await phone.setViewport({ width: 390, height: 844 });
		await phone.goto(lan + '/settings', { waitUntil: 'networkidle0' });
		assert.ok(phone.url().includes('/signin'));
		await phone.type('#signin-password', '7');
		await phone.click('button[type="submit"]');
		await phone.waitForFunction(() => location.pathname === '/settings');
		await phone.waitForNetworkIdle();
		assert.equal(await phone.$eval('#lan button', (b) => b.disabled), true);
		assert.equal(
			await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
			true
		);
		await phone.$eval('#lan', (e) => e.scrollIntoView());
		await phone.screenshot({ path: '/tmp/saturday-lan-mobile.png' });
		await phone.goto(lan + '/jobs/new', { waitUntil: 'networkidle0' });
		await phone.type('input[name="job_title"]', 'Phone LAN capture');
		await phone.type('input[name="company_name"]', 'Network test');
		await phone.click('button[type="submit"]');
		await phone.waitForFunction(() =>
			document.querySelector('h1')?.textContent?.includes('Phone LAN capture')
		);
		await phone.goto(lan + '/documents', { waitUntil: 'networkidle0' });
		const file = join(root, 'phone-upload.txt');
		await writeFile(file, 'LAN upload and download');
		await (await phone.$('input[type="file"]')).uploadFile(file);
		await phone.waitForFunction(() =>
			[...document.querySelectorAll('a')].some((a) => a.textContent?.includes('phone-upload.txt'))
		);
		const href = await phone.evaluate(() =>
			[...document.querySelectorAll('a')]
				.find((a) => a.textContent?.includes('phone-upload.txt'))
				.getAttribute('href')
		);
		const docId = href.split('/').pop().split('?')[0];
		const phoneCookie = (await phone.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
		const download = await http(lan, `/api/files/${docId}?scope=documents`, {
			headers: { cookie: phoneCookie }
		});
		assert.equal(download.status, 200);
		assert.equal(download.text, 'LAN upload and download');
		await phone.goto(lan + '/settings#password', { waitUntil: 'networkidle0' });
		await Promise.all([
			phone.waitForNavigation({ waitUntil: 'networkidle0' }),
			phone.click('form[action="?/logout"] button')
		]);
		assert.ok(phone.url().includes('/signin'));
		stage = 'disable LAN';
		await phone.type('#signin-password', '7');
		await phone.click('button[type="submit"]');
		await phone.waitForFunction(() => location.pathname !== '/signin');
		await phone.goto(lan + '/settings#password', { waitUntil: 'networkidle0' });
		const logoutAll = await phone.evaluateHandle(() =>
			[...document.querySelectorAll('button')].find(
				(b) => b.textContent?.trim() === 'Log out all devices'
			)
		);
		await logoutAll.asElement().click();
		await phone.waitForSelector('[role="dialog"]');
		await Promise.all([
			phone.waitForNavigation({ waitUntil: 'networkidle0' }),
			phone.click('button[form="logout-all"]')
		]);
		assert.ok(phone.url().includes('/signin'));
		await desktop.bringToFront();
		await desktop.goto(local + '/settings#lan', { waitUntil: 'networkidle0' });
		assert.ok(
			desktop.url().includes('/signin'),
			'phone logout-all must revoke the desktop login too'
		);
		await desktop.type('#signin-password', '7');
		await desktop.click('button[type="submit"]');
		await desktop.waitForFunction(() => location.pathname === '/settings');
		await desktop.waitForNetworkIdle();
		await desktop.click('#lan form[action="?/lan"] button');
		await desktop.waitForFunction(() =>
			document.body.innerText.includes('Restart Saturday to apply this change?')
		);
		const laterDisable = await desktop.evaluateHandle(() =>
			[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Later')
		);
		await laterDisable.asElement().click();
		await desktop.waitForNetworkIdle();
		assert.equal((await status()).effective_allow_lan, true);
		assert.equal((await status()).saved_allow_lan, false);
		assert.equal((await http(lan, '/signin')).status, 200);
		await desktop.click('#lan-restart button');
		await waitFor(async () => (await status()).effective_allow_lan === false);
		await desktop.waitForFunction(() => location.pathname === '/signin');
		await assert.rejects(http(lan, '/signin'));
		assert.equal(
			(await http(local, '/jobs', { headers: { accept: 'application/json' } })).status,
			401,
			'local-only mode still requires the password'
		);
		assert.equal((await settings()).password !== null, true);
	} catch (error) {
		console.error({ stage }, await readFile(join(root, 'logs/server.log'), 'utf8').catch(() => ''));
		throw error;
	} finally {
		await browser?.close();
		await run('scripts/start.mjs', 'stop', '--json').catch(() => {});
		await waitFor(async () => !(await status()).managed).catch(() => {});
		await rm(root, { recursive: true, force: true });
	}
});

test('LAN startup chooses a free port across all interfaces and keeps supervisor control on loopback', async (t) => {
	const candidate = phoneAddresses(3000).find((a) => !a.virtual);
	if (!candidate) return t.skip('No external IPv4 interface is available.');
	const root = await mkdtemp(join(tmpdir(), 'saturday-lan-port-'));
	const occupied = createServer();
	await new Promise((r) => occupied.listen(0, candidate.address, r));
	const port = occupied.address().port;
	const env = {
		...process.env,
		SATURDAY_PROJECT_ROOT: resolve('.'),
		SATURDAY_DB_PATH: join(root, 'saturday.db'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'extension-code'),
		SATURDAY_INSTALLATION_PATH: '',
		PORT: String(port)
	};
	const run = async (file, ...args) =>
		JSON.parse(
			(await exec(process.execPath, [file, ...args], { env, maxBuffer: 1024 * 1024 })).stdout
		);
	try {
		const setup = await run(
			'scripts/setup.mjs',
			'--skip-dependencies',
			'--skip-build',
			'--skip-pdf',
			'--json'
		);
		env.SATURDAY_INSTALLATION_PATH = setup.descriptor_path;
		await run('scripts/access.mjs', 'lan', '--enable', '--confirm');
		const started = await run('scripts/start.mjs', '--background', '--json');
		assert.notEqual(Number(new URL(started.url).port), port);
		assert.equal(started.allow_lan, true);
		assert.equal(
			(await run('scripts/status.mjs', '--json')).url,
			started.url,
			'status reports the actual port rather than the occupied preference'
		);
		const record = JSON.parse(await readFile(join(root, 'server.state', 'server.json')));
		await assert.rejects(http(`http://${candidate.address}:${record.control_port}`, '/control'));
		assert.equal((await http(`http://${candidate.address}:${record.port}`, '/jobs')).status, 200);
		assert.equal(occupied.listening, true, 'unrelated listener survives');
	} finally {
		await run('scripts/start.mjs', 'stop', '--json').catch(() => {});
		await waitFor(async () => !(await run('scripts/access.mjs', 'status')).managed).catch(() => {});
		occupied.closeAllConnections?.();
		await new Promise((r) => occupied.close(r));
		await rm(root, { recursive: true, force: true });
	}
});
