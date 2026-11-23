// Real end-to-end branch switch acceptance journey against real GitHub refs.
// Run deliberately with: node tests/run.mjs -- node --test tests/branch-switch.beta.mjs
// Excluded from `npm run test:web` (which selects `*.integration.mjs`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'devalue';
import { copySource } from '../scripts/install.mjs';
import { readBuildInfo } from '../scripts/build-info.mjs';
import {
	codeFingerprint,
	compareVersions,
	resolveNpmCli
} from '../src/lib/server/installation-operations.js';

const FIRST_BRANCH_SWITCH_VERSION = '0.1.4';
const ACTIVE_OPERATION_STATES = new Set([
	'queued',
	'staging',
	'waiting_for_disconnect',
	'backing_up',
	'publishing',
	'migrating',
	'restarting',
	'removing'
]);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function freeLoopbackPort() {
	for (let attempt = 0; attempt < 20; attempt++) {
		const socket = createServer();
		await new Promise((r) => socket.listen(0, '127.0.0.1', r));
		const port = socket.address().port;
		await new Promise((r) => socket.close(r));
		if (port !== 3000) return port;
	}
	throw new Error('Could not allocate a non-3000 loopback port.');
}

function execBounded(cmd, args, { cwd, env, timeoutMs = 60_000 } = {}) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(cmd, args, {
			cwd,
			env,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		let killTimer;
		child.stdout.on('data', (chunk) => (stdout += chunk));
		child.stderr.on('data', (chunk) => (stderr += chunk));
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
			killTimer = setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
			}, 5000);
			killTimer.unref();
		}, timeoutMs);
		timer.unref();
		child.once('error', (err) => {
			clearTimeout(timer);
			clearTimeout(killTimer);
			rejectRun(err);
		});
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			clearTimeout(killTimer);
			if (timedOut) {
				rejectRun(
					new Error(
						`Command timed out after ${timeoutMs}ms: ${cmd} ${args.join(' ')}\n${stderr || stdout}`
					)
				);
				return;
			}
			resolveRun({ status: code, signal, stdout, stderr });
		});
	});
}

function newestMtime(path) {
	if (!existsSync(path)) return 0;
	const st = statSync(path);
	if (st.isFile()) return st.mtimeMs;
	if (!st.isDirectory()) return 0;
	let newest = st.mtimeMs;
	for (const entry of readdirSync(path)) {
		if (entry === 'extensions.generated.js') continue;
		const m = newestMtime(join(path, entry));
		if (m > newest) newest = m;
	}
	return newest;
}

async function ensureFreshBuild() {
	const projectRoot = resolve('.');
	const buildArtifacts = [
		join(projectRoot, 'build', 'index.js'),
		join(projectRoot, 'build', 'mcp', 'index.js')
	];
	let stale = buildArtifacts.some((p) => !existsSync(p));
	if (!stale) {
		const oldestBuild = Math.min(...buildArtifacts.map((p) => statSync(p).mtimeMs));
		const newestSource = Math.max(
			newestMtime(join(projectRoot, 'src')),
			newestMtime(join(projectRoot, 'scripts')),
			newestMtime(join(projectRoot, 'static')),
			newestMtime(join(projectRoot, 'package.json')),
			newestMtime(join(projectRoot, 'vite.config.ts'))
		);
		stale = newestSource > oldestBuild;
	}
	if (!stale) return false;
	const npmCli = resolveNpmCli({
		node_path: process.execPath,
		runtime_root: resolve(process.execPath, '..', '..'),
		runtime_owned: false
	});
	const built = await execBounded(process.execPath, [npmCli, 'run', 'build'], {
		cwd: projectRoot,
		env: { ...process.env },
		timeoutMs: 180_000
	});
	assert.equal(built.status, 0, built.stderr || built.stdout);
	return true;
}

function extractCookies(response) {
	const setCookies = response.headers.getSetCookie?.() ?? [];
	return setCookies.map((c) => c.split(';')[0]).join('; ');
}

function readJsonSafe(path) {
	try {
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

function tailOperationLog(root, lines = 40) {
	if (!root) return '(no disposable root created)';
	const stateDir = join(root, 'installation.state');
	const op = readJsonSafe(join(stateDir, 'operation.json'));
	const candidates = [];
	if (op?.log && existsSync(op.log)) candidates.push(op.log);
	if (existsSync(stateDir)) {
		const logs = readdirSync(stateDir)
			.filter((name) => name.endsWith('.log'))
			.map((name) => join(stateDir, name))
			.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
		candidates.push(...logs);
	}
	const serverLog = join(root, 'logs', 'server.log');
	if (existsSync(serverLog)) candidates.push(serverLog);
	const seen = new Set();
	for (const logPath of candidates) {
		if (seen.has(logPath)) continue;
		seen.add(logPath);
		try {
			const text = readFileSync(logPath, 'utf8');
			const tail = text.split(/\r?\n/).slice(-lines).join('\n');
			return `[${logPath}]\n${tail}`;
		} catch {
			// Try next log file.
		}
	}
	return '(no operation log found)';
}

function isPidAlive(pid) {
	if (!Number.isSafeInteger(pid) || pid < 1) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === 'EPERM';
	}
}

async function terminatePidBounded(pid, timeoutMs = 5000) {
	if (!isPidAlive(pid)) return;
	try {
		process.kill(pid, 'SIGTERM');
	} catch {
		return;
	}
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isPidAlive(pid)) return;
		await delay(100);
	}
	try {
		process.kill(pid, 'SIGKILL');
	} catch {
		// Already exited.
	}
}

async function stopDisposableInstallation(root, app, descriptor) {
	if (existsSync(join(app, 'scripts', 'start.mjs')) && existsSync(descriptor)) {
		try {
			await execBounded(
				process.execPath,
				[join(app, 'scripts', 'start.mjs'), 'stop', '--installation', descriptor, '--json'],
				{ cwd: app, env: { ...process.env }, timeoutMs: 20_000 }
			);
		} catch {
			// Fall through to PID verification.
		}
	}
	const serverJson = join(root, 'data', 'server.state', 'server.json');
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const record = readJsonSafe(serverJson);
		if (!record || !isPidAlive(record.pid)) break;
		await delay(100);
	}
	const record = readJsonSafe(serverJson);
	if (record?.pid) await terminatePidBounded(record.pid, 5000);
	const op = readJsonSafe(join(root, 'installation.state', 'operation.json'));
	if (op?.pid && op.pid !== process.pid && ACTIVE_OPERATION_STATES.has(op.status)) {
		await terminatePidBounded(op.pid, 5000);
	}
}

async function waitForOperationComplete(root, { label, timeoutMs = 600_000 } = {}) {
	const opPath = join(root, 'installation.state', 'operation.json');
	const deadline = Date.now() + timeoutMs;
	let lastMarker = '';
	while (Date.now() < deadline) {
		const state = readJsonSafe(opPath);
		if (state) {
			const marker = `${state.status}: ${state.step || ''}`;
			if (marker !== lastMarker) {
				lastMarker = marker;
				console.log(`[branch-switch.beta]   ${label} -> ${marker}`);
			}
			const isActive = ACTIVE_OPERATION_STATES.has(state.status) && !state.error;
			if (!isActive) {
				if (state.status !== 'complete') {
					throw new Error(
						`Operation ended with status=${state.status} error_code=${state.error_code ?? 'none'} error=${state.error || state.step}`
					);
				}
				return state;
			}
			if (state.pid && !isPidAlive(state.pid)) {
				throw new Error(
					`Operation controller PID ${state.pid} exited unexpectedly while status=${state.status}`
				);
			}
		}
		await delay(1500);
	}
	throw new Error(`Timed out after ${timeoutMs}ms waiting for operation "${label}" to complete.`);
}

async function waitForHealth(url, expectedCommit, { timeoutMs = 30_000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	let lastDetail = 'no response';
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${url}/health`, {
				cache: 'no-store',
				signal: AbortSignal.timeout(2000)
			});
			const body = await res.json();
			if (res.status === 200 && body?.status === 'ready') {
				if (!expectedCommit || body.build?.commit === expectedCommit) {
					return { status: res.status, body };
				}
				lastDetail = `HTTP 200 build.commit=${body.build?.commit} (expected ${expectedCommit})`;
			} else {
				lastDetail = `HTTP ${res.status} body=${JSON.stringify(body)}`;
			}
		} catch (e) {
			lastDetail = e.message;
		}
		await delay(500);
	}
	throw new Error(`Timed out waiting for ${url}/health (${lastDetail}).`);
}

async function postSettingsAction(base, action, fields, cookie) {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields || {})) body.set(key, String(value));
	const response = await fetch(`${base}/settings?/${action}`, {
		method: 'POST',
		headers: {
			origin: base,
			cookie,
			accept: 'application/json',
			'x-sveltekit-action': 'true'
		},
		body,
		signal: AbortSignal.timeout(30_000)
	});
	const text = await response.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		return { httpStatus: response.status, rawText: text, type: null, data: null };
	}
	return {
		httpStatus: response.status,
		...json,
		data: json?.data ? parse(json.data) : null
	};
}

async function provisionManagedInstallation({ prefix, trackingRef, jobTitle, companyName }) {
	const root = await fsp.realpath(await fsp.mkdtemp(join(tmpdir(), prefix)));
	const app = join(root, 'app');
	const descriptor = join(root, 'installation.json');
	const port = await freeLoopbackPort();
	assert.notEqual(port, 3000, 'test must never bind port 3000');

	await copySource(resolve('.'), app);
	await fsp.symlink(resolve('node_modules'), join(app, 'node_modules'), 'dir');
	await fsp.cp(resolve('build'), join(app, 'build'), { recursive: true });

	const setupEnv = {
		...process.env,
		SATURDAY_PROJECT_ROOT: app,
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: '',
		SATURDAY_FILES_PATH: '',
		SATURDAY_EXTENSION_STATE_PATH: '',
		SATURDAY_EXTENSIONS_PATH: '',
		PORT: String(port)
	};
	const setup = await execBounded(
		process.execPath,
		[
			join(app, 'scripts', 'setup.mjs'),
			'--managed',
			'--root',
			root,
			'--skip-dependencies',
			'--skip-build',
			'--skip-pdf',
			'--json'
		],
		{ cwd: app, env: setupEnv, timeoutMs: 60_000 }
	);
	assert.equal(setup.status, 0, setup.stderr || setup.stdout);
	const setupResult = JSON.parse(setup.stdout);
	assert.equal(setupResult.ok, true);
	assert.equal(setupResult.descriptor_path, descriptor);

	const config = JSON.parse(await fsp.readFile(descriptor, 'utf8'));
	config.port = port;
	config.code_owned = true;
	config.code_fingerprint = await codeFingerprint(app);
	config.build = readBuildInfo(resolve('.'));
	config.tracking_ref = trackingRef;
	await fsp.writeFile(descriptor, JSON.stringify(config, null, 2));

	const startEnv = { ...process.env, PORT: String(port) };
	for (const key of [
		'SATURDAY_PROJECT_ROOT',
		'SATURDAY_INSTALLATION_PATH',
		'SATURDAY_DB_PATH',
		'SATURDAY_FILES_PATH',
		'SATURDAY_EXTENSION_STATE_PATH',
		'SATURDAY_EXTENSIONS_PATH'
	])
		delete startEnv[key];

	const started = await execBounded(
		process.execPath,
		[
			join(app, 'scripts', 'start.mjs'),
			'start',
			'--background',
			'--installation',
			descriptor,
			'--json'
		],
		{ cwd: app, env: startEnv, timeoutMs: 30_000 }
	);
	assert.equal(started.status, 0, started.stderr || started.stdout);
	const startInfo = JSON.parse(started.stdout);
	assert.equal(startInfo.ok, true);
	assert.ok(startInfo.url && startInfo.url.startsWith('http://127.0.0.1:'));
	assert.notEqual(new URL(startInfo.url).port, '3000');

	const settingsRes = await fetch(`${startInfo.url}/settings`, {
		signal: AbortSignal.timeout(15_000)
	});
	assert.equal(settingsRes.status, 200);
	const cookie = extractCookies(settingsRes);
	assert.ok(cookie.includes('saturday-control-'), 'control cookie obtained from GET /settings');

	const createJobRes = await fetch(`${startInfo.url}/jobs/new`, {
		method: 'POST',
		headers: {
			origin: startInfo.url,
			cookie,
			accept: 'application/json',
			'x-sveltekit-action': 'true'
		},
		body: new URLSearchParams({ job_title: jobTitle, company_name: companyName }),
		signal: AbortSignal.timeout(15_000)
	});
	const createdJob = await createJobRes.json();
	assert.equal(createdJob.type, 'redirect', `createJob failed: ${JSON.stringify(createdJob)}`);

	const jobsHtml = await (
		await fetch(`${startInfo.url}/jobs`, { signal: AbortSignal.timeout(15_000) })
	).text();
	assert.ok(jobsHtml.includes(jobTitle));
	assert.ok(jobsHtml.includes(companyName));

	return { root, app, descriptor, url: startInfo.url, cookie };
}

async function executeHttpBranchSwitch({ root, url, cookie, targetRef, label, branchesResult }) {
	const listed = branchesResult ?? (await postSettingsAction(url, 'branches', {}, cookie));
	assert.equal(listed.type, 'success', JSON.stringify(listed));
	const targetRow = listed.data.branches.branches.find((b) => b.ref === targetRef);
	assert.ok(targetRow && !targetRow.missing && /^[a-f0-9]{40}$/.test(targetRow.commit));
	const targetCommit = targetRow.commit;

	const reviewed = await postSettingsAction(url, 'branchCompatibility', { ref: targetRef }, cookie);
	assert.equal(reviewed.type, 'success', JSON.stringify(reviewed));
	const review = reviewed.data.branchReview;
	assert.equal(review.target.ref, targetRef);
	assert.equal(review.target.commit, targetCommit);
	assert.equal(review.compatibility.verdict, 'compatible');
	const expectedVersion = review.target.version;
	assert.match(
		expectedVersion ?? '',
		/^\d+\.\d+\.\d+$/,
		'target package version resolved from GitHub'
	);

	const backup = await postSettingsAction(url, 'backupForSwitch', { check_id: review.id }, cookie);
	assert.equal(backup.type, 'success', JSON.stringify(backup));
	const pending = backup.data.switchExport;
	const downloadUrl = backup.data.downloadUrl;
	assert.equal(pending.status, 'pending');
	assert.ok(downloadUrl.includes(`contents=all&switch_export=${pending.id}`));

	const zipRes = await fetch(`${url}${downloadUrl}`, {
		headers: { cookie, 'sec-fetch-site': 'same-origin' },
		signal: AbortSignal.timeout(30_000)
	});
	assert.equal(zipRes.status, 200);
	const zipBytes = Buffer.from(await zipRes.arrayBuffer());
	assert.equal(zipBytes.subarray(0, 2).toString(), 'PK');
	const downloadSha256 = createHash('sha256').update(zipBytes).digest('hex');
	const downloadBytes = zipBytes.byteLength;

	let receipt = null;
	const statusDeadline = Date.now() + 15_000;
	while (Date.now() < statusDeadline) {
		const polled = await postSettingsAction(
			url,
			'switchExportStatus',
			{ export_id: pending.id },
			cookie
		);
		if (polled.type === 'success' && polled.data?.switchExport?.status === 'complete') {
			receipt = polled.data.switchExport;
			break;
		}
		await delay(250);
	}
	assert.ok(receipt, 'switch export receipt did not reach complete within 15s');
	assert.equal(receipt.sha256, downloadSha256);
	assert.equal(receipt.bytes, downloadBytes);

	const switchPayload = {
		ref: targetRef,
		commit: targetCommit,
		check_id: review.id,
		export_id: pending.id,
		backup_id: pending.backup_id,
		download_sha256: downloadSha256,
		download_bytes: String(downloadBytes),
		confirm: 'true'
	};
	const queued = await postSettingsAction(url, 'switchBranch', switchPayload, cookie);
	assert.equal(queued.type, 'success', JSON.stringify(queued));
	assert.equal(queued.data.installationOperation.reset_data, true);
	// F2: export_proof must stay out of the public operationStatus / action projection.
	assert.equal('export_proof' in queued.data.installationOperation.branch_switch, false);

	// F5: receipt file must be consumed immediately on accepted queue.
	const receiptPath = join(root, 'installation.state', 'switch-export.json');
	assert.equal(
		existsSync(receiptPath),
		false,
		'switch-export.json must be removed on accepted queue'
	);

	const op = await waitForOperationComplete(root, { label, timeoutMs: 600_000 });
	// F2: verify export_proof from the durable raw operation.json file.
	const rawOp = JSON.parse(
		await fsp.readFile(join(root, 'installation.state', 'operation.json'), 'utf8')
	);
	assert.equal(rawOp.branch_switch.export_proof, 'received-bytes');
	assert.equal(
		existsSync(receiptPath),
		false,
		'switch-export.json remains absent after completion'
	);

	return {
		op,
		targetCommit,
		expectedVersion,
		switchPayload,
		nextUrl: op.url || url
	};
}

async function verifyRestartedInstallation({
	t,
	root,
	app,
	descriptor,
	url,
	expectedRef,
	expectedCommit,
	expectedVersion,
	seededJobTitle,
	seededCompanyName,
	replayPayload
}) {
	assert.notEqual(new URL(url).port, '3000');

	const health = await waitForHealth(url, expectedCommit, { timeoutMs: 30_000 });
	assert.equal(health.status, 200);
	assert.equal(health.body.build.id, `dev.${expectedCommit.slice(0, 12)}`);
	assert.equal(health.body.build.commit, expectedCommit);

	const installedPkg = JSON.parse(await fsp.readFile(join(app, 'package.json'), 'utf8'));
	assert.equal(installedPkg.version, expectedVersion);

	const desc = JSON.parse(await fsp.readFile(descriptor, 'utf8'));
	assert.equal(desc.tracking_ref, expectedRef);
	assert.equal(desc.build.commit, expectedCommit);
	assert.deepEqual(desc.initialized, {
		database: true,
		files: true,
		extensions: true,
		access: true
	});

	const jobsHtml = await (
		await fetch(`${url}/jobs`, { signal: AbortSignal.timeout(15_000) })
	).text();
	assert.equal(jobsHtml.includes(seededJobTitle), false);
	assert.equal(jobsHtml.includes(seededCompanyName), false);

	const db = new DatabaseSync(desc.database, { readOnly: true });
	try {
		const count = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
		assert.equal(count, 0, 'all jobs from pre-switch workspace must be cleared');
	} finally {
		db.close();
	}

	const settingsRes = await fetch(`${url}/settings`, { signal: AbortSignal.timeout(15_000) });
	assert.equal(settingsRes.status, 200);
	const freshCookie = extractCookies(settingsRes);
	assert.ok(freshCookie.includes('saturday-control-'));

	// F5: replay the consumed switchBranch payload after completion.
	const opPath = join(root, 'installation.state', 'operation.json');
	const receiptPath = join(root, 'installation.state', 'switch-export.json');
	const completedOp = readJsonSafe(opPath);
	assert.equal(completedOp?.status, 'complete');
	// The second replay checks that the first refusal did not change state.
	for (let attempt = 0; attempt < 2; attempt++) {
		const replay = await postSettingsAction(url, 'switchBranch', replayPayload, freshCookie);
		if (
			replay.httpStatus === 404 &&
			compareVersions(installedPkg.version, FIRST_BRANCH_SWITCH_VERSION) < 0
		) {
			if (attempt === 0) {
				t.diagnostic(
					`Replay check on ${expectedRef}@${expectedCommit.slice(0, 12)} (${installedPkg.version}): target predates ?/switchBranch (HTTP 404).`
				);
			}
		} else if (replay.httpStatus === 404) {
			assert.fail(`?/switchBranch returned HTTP 404 on version ${installedPkg.version}`);
		} else {
			assert.equal(replay.type, 'failure', JSON.stringify(replay));
			assert.equal(replay.status, 409, JSON.stringify(replay));
			// The upstream ref is resolved before the receipt, so a moved ref also refuses the replay.
			assert.ok(
				['SWITCH_CHECK', 'EXPORT_REQUIRED', 'BRANCH_CHANGED'].includes(
					replay.data?.installationCode
				),
				JSON.stringify(replay)
			);
		}
		assert.deepEqual(readJsonSafe(opPath), completedOp, 'replay must not start another operation');
		assert.equal(existsSync(receiptPath), false, 'replay must not restore the export receipt');
	}

	return { installedPkg, freshCookie };
}

test(
	'real branch switch journey: current -> main -> dev against real GitHub',
	{ timeout: 1_500_000 },
	async (t) => {
		const priorEnv = { ...process.env };
		const disposables = [];
		let activeLogRoot = null;
		let cleaned = false;

		const cleanupAll = async () => {
			if (cleaned) return;
			cleaned = true;
			console.log('[branch-switch.beta] phase: cleanup ...');
			try {
				for (const item of disposables) {
					await stopDisposableInstallation(item.root, item.app, item.descriptor);
				}
			} finally {
				for (const key of Object.keys(process.env)) {
					if (!(key in priorEnv)) delete process.env[key];
				}
				Object.assign(process.env, priorEnv);
				for (const item of disposables) {
					await fsp.rm(item.root, { recursive: true, force: true });
				}
			}
			console.log('[branch-switch.beta] phase: cleanup OK');
		};
		// F8: register t.after so cleanup still runs if node:test times out the test body.
		t.after(cleanupAll);

		const runPhase = async (name, fn) => {
			const started = Date.now();
			console.log(`[branch-switch.beta] phase: ${name} ...`);
			try {
				const result = await fn();
				const elapsed = ((Date.now() - started) / 1000).toFixed(1);
				console.log(`[branch-switch.beta] phase: ${name} OK (${elapsed}s)`);
				return result;
			} catch (error) {
				const tail = tailOperationLog(activeLogRoot, 40);
				throw new Error(
					`Phase "${name}" failed: ${error.message}\n--- Last 40 lines of operation log ---\n${tail}`,
					{ cause: error }
				);
			}
		};

		try {
			// F6: ensure build/ is fresh before Phase 1 so we never test stale build artifacts.
			await runPhase('0. ensure fresh build artifacts', async () => {
				const rebuilt = await ensureFreshBuild();
				console.log(`[branch-switch.beta]   build artifacts ${rebuilt ? 'rebuilt' : 'up to date'}`);
			});

			let primary;
			await runPhase('1. provision managed installation, start server, seed live job', async () => {
				primary = await provisionManagedInstallation({
					prefix: 'saturday-branch-journey-main-',
					trackingRef: 'dev',
					jobTitle: 'Real Journey Sentinel',
					companyName: 'BetaSwitchCorp'
				});
				disposables.push(primary);
				activeLogRoot = primary.root;
			});

			let mainLeg;
			await runPhase(
				'2. resolve main on real GitHub, export ZIP, submit switchBranch with received-bytes SHA-256, and wait for complete',
				async () => {
					const listed = await postSettingsAction(primary.url, 'branches', {}, primary.cookie);
					assert.equal(listed.type, 'success', JSON.stringify(listed));
					const mainRow = listed.data.branches.branches.find((b) => b.ref === 'main');
					const devRow = listed.data.branches.branches.find((b) => b.ref === 'dev');
					assert.ok(mainRow && !mainRow.missing && /^[a-f0-9]{40}$/.test(mainRow.commit));
					assert.ok(devRow && !devRow.missing && /^[a-f0-9]{40}$/.test(devRow.commit));
					console.log(
						`[branch-switch.beta]   real GitHub refs: main=${mainRow.commit.slice(0, 12)}, dev=${devRow.commit.slice(0, 12)}`
					);

					mainLeg = await executeHttpBranchSwitch({
						root: primary.root,
						url: primary.url,
						cookie: primary.cookie,
						targetRef: 'main',
						label: `switch -> main (${mainRow.commit.slice(0, 12)})`,
						branchesResult: listed
					});
				}
			);

			let mainVerified;
			await runPhase('3. verify main after restart', async () => {
				mainVerified = await verifyRestartedInstallation({
					t,
					root: primary.root,
					app: primary.app,
					descriptor: primary.descriptor,
					url: mainLeg.nextUrl,
					expectedRef: 'main',
					expectedCommit: mainLeg.targetCommit,
					expectedVersion: mainLeg.expectedVersion,
					seededJobTitle: 'Real Journey Sentinel',
					seededCompanyName: 'BetaSwitchCorp',
					replayPayload: mainLeg.switchPayload
				});
			});

			await runPhase('4. switch back to dev and verify serving again', async () => {
				const probeBranches = await postSettingsAction(
					mainLeg.nextUrl,
					'branches',
					{},
					mainVerified.freshCookie
				);
				if (probeBranches.type === 'success' && probeBranches.data?.branches) {
					// Full in-place HTTP return switch when main ships branch-switching routes.
					const devLeg = await executeHttpBranchSwitch({
						root: primary.root,
						url: mainLeg.nextUrl,
						cookie: mainVerified.freshCookie,
						targetRef: 'dev',
						label: 'switch -> dev (in-place HTTP)',
						branchesResult: probeBranches
					});
					await verifyRestartedInstallation({
						t,
						root: primary.root,
						app: primary.app,
						descriptor: primary.descriptor,
						url: devLeg.nextUrl,
						expectedRef: 'dev',
						expectedCommit: devLeg.targetCommit,
						expectedVersion: devLeg.expectedVersion,
						seededJobTitle: 'Real Journey Sentinel',
						seededCompanyName: 'BetaSwitchCorp',
						replayPayload: devLeg.switchPayload
					});
					return;
				}

				// F4: Fallback is permitted ONLY when ?/branches returns 404 AND installed main version
				// is below FIRST_BRANCH_SWITCH_VERSION; any other failure (500/403/regression) fails hard.
				const installedVersion = mainVerified.installedPkg.version;
				assert.equal(
					probeBranches.httpStatus,
					404,
					`Expected HTTP 200 or pre-feature 404 from ?/branches on main (${installedVersion}), got HTTP ${probeBranches.httpStatus}: ${JSON.stringify(probeBranches)}`
				);
				assert.ok(
					compareVersions(installedVersion, FIRST_BRANCH_SWITCH_VERSION) < 0,
					`Installed main version ${installedVersion} >= ${FIRST_BRANCH_SWITCH_VERSION} must support ?/branches without fallback`
				);

				// Never synthesize a switch receipt: exercise the real HTTP -> dev journey (including real
				// ?/backupForSwitch, ?switch_export= download, and ?/switchBranch) from a fresh managed
				// installation running the current branch-switching build with tracking_ref='main'.
				const fallbackNote = `Return leg fallback: installed main@${mainLeg.targetCommit.slice(0, 12)} (${installedVersion}) returned HTTP 404 for ?/branches (predates ${FIRST_BRANCH_SWITCH_VERSION}); running real HTTP -> dev switch from a fresh tracking_ref='main' managed installation with no synthesized receipt.`;
				t.diagnostic(fallbackNote);
				console.log(`[branch-switch.beta]   ${fallbackNote}`);

				const devSource = await provisionManagedInstallation({
					prefix: 'saturday-branch-journey-dev-',
					trackingRef: 'main',
					jobTitle: 'Return Leg Sentinel',
					companyName: 'ReturnCorp'
				});
				disposables.push(devSource);
				activeLogRoot = devSource.root;

				const devLeg = await executeHttpBranchSwitch({
					root: devSource.root,
					url: devSource.url,
					cookie: devSource.cookie,
					targetRef: 'dev',
					label: 'switch -> dev (HTTP via current build)'
				});
				await verifyRestartedInstallation({
					t,
					root: devSource.root,
					app: devSource.app,
					descriptor: devSource.descriptor,
					url: devLeg.nextUrl,
					expectedRef: 'dev',
					expectedCommit: devLeg.targetCommit,
					expectedVersion: devLeg.expectedVersion,
					seededJobTitle: 'Return Leg Sentinel',
					seededCompanyName: 'ReturnCorp',
					replayPayload: devLeg.switchPayload
				});
			});
		} finally {
			await cleanupAll();
		}
	}
);
