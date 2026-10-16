// Local-owner maintenance interface. Secrets are accepted only as JSON on stdin.
import { parseArgs } from 'node:util';
import { getInstallation } from '../src/lib/server/installation.js';
import {
	readAccessSettings,
	updateAccessSettings,
	parseIdleHours,
	initializeAccessSettings,
	AccessError
} from '../src/lib/server/access-settings.js';
import { passwordHash } from '../src/lib/server/access-auth.js';
import { withAccessChange } from '../src/lib/server/access-admin.js';
import { assertWebRuntimeStopped } from '../src/lib/server/extensions.js';
import {
	serverSummary,
	controlServer,
	claimInstallationMaintenance
} from '../src/lib/server/server-lifecycle.js';
try {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			installation: { type: 'string' },
			json: { type: 'boolean' },
			stdin: { type: 'boolean' },
			confirm: { type: 'boolean' },
			hours: { type: 'string' },
			'no-expiration': { type: 'boolean' }
		}
	});
	if (values.installation) {
		for (const key of [
			'SATURDAY_PROJECT_ROOT',
			'SATURDAY_DB_PATH',
			'SATURDAY_FILES_PATH',
			'SATURDAY_EXTENSION_STATE_PATH',
			'SATURDAY_EXTENSIONS_PATH'
		])
			delete process.env[key];
		process.env.SATURDAY_INSTALLATION_PATH = values.installation;
	}
	const action = positionals[0] ?? 'status';
	if (
		positionals.length > 1 ||
		!['status', 'set-password', 'timeout', 'disable', 'recover'].includes(action)
	)
		throw new AccessError(
			'Use status, set-password --stdin, timeout --hours <number>/--no-expiration, or disable/recover --confirm.'
		);
	if (action === 'set-password' && !values.stdin)
		throw new AccessError('Use --stdin with JSON containing password and confirm_password.');
	if (['disable', 'recover'].includes(action) && !values.confirm)
		throw new AccessError(
			'Use --confirm to remove password protection. Recovery also disables network access.'
		);
	if (action === 'timeout' && (values.hours === undefined) === !values['no-expiration'])
		throw new AccessError('Use either --hours or --no-expiration.');
	const timeout =
		action === 'timeout' ? parseIdleHours(values.hours, values['no-expiration']) : undefined;
	let verifier;
	if (action === 'set-password') {
		let input = '';
		for await (const chunk of process.stdin) {
			input += chunk;
			if (Buffer.byteLength(input) > 16384) throw new AccessError('Password input is too large.');
		}
		let secret;
		try {
			secret = JSON.parse(input);
		} catch {
			throw new AccessError('Expected password and confirm_password as JSON on stdin.');
		}
		if (secret.password !== secret.confirm_password)
			throw new AccessError('Passwords do not match.');
		verifier = await passwordHash(secret.password);
	}
	let stopped = false;
	if (action !== 'status')
		await withAccessChange(async () => {
			if (serverSummary().managed) {
				await controlServer('stop');
				const deadline = Date.now() + 15000;
				while (serverSummary().managed && Date.now() < deadline)
					await new Promise((resolve) => setTimeout(resolve, 100));
				if (serverSummary().managed)
					throw new AccessError(
						'Server shutdown was not confirmed. Settings were not changed.',
						409
					);
				stopped = true;
			}
			const release = await claimInstallationMaintenance();
			try {
				try {
					await assertWebRuntimeStopped();
				} catch (e) {
					if (e.code === 'RUNNING') throw new AccessError(e.message, 409);
					throw e;
				}
				if (serverSummary().managed)
					throw new AccessError(
						'A server started during maintenance. Settings were not changed.',
						409
					);
				if (action !== 'recover') await initializeAccessSettings();
				await updateAccessSettings(
					(current) => ({
						...current,
						allow_lan: false,
						password:
							action === 'set-password' ? verifier : action === 'timeout' ? current.password : null,
						idle_timeout_seconds: action === 'timeout' ? timeout : current.idle_timeout_seconds
					}),
					{ recover: action === 'recover' }
				);
			} finally {
				await release();
			}
		});
	const settings = readAccessSettings(),
		installation = getInstallation();
	console.log(
		JSON.stringify({
			ok: true,
			installation_id: installation.installation_id,
			password_enabled: Boolean(settings.password),
			idle_timeout_hours:
				settings.idle_timeout_seconds === null ? null : settings.idle_timeout_seconds / 3600,
			allow_lan: false,
			server_stopped: stopped,
			reopen: action !== 'status' ? 'Use Open Saturday to start the server.' : undefined
		})
	);
} catch (e) {
	console.log(
		JSON.stringify({
			ok: false,
			error: {
				code: 'ACCESS_FAILED',
				message: e.status
					? e.message
					: 'Access maintenance failed. Preserve settings and inspect the installation.'
			}
		})
	);
	process.exitCode = 1;
}
