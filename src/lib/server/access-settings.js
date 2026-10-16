// Installation-owned UI preferences. Career stores and stdio MCP are independent.
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getInstallation, atomicJson, acquireDirectoryLock } from './installation.js';

export class AccessError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.name = 'AccessError';
		this.status = status;
	}
}
export const defaultAccessSettings = () => ({
	format: 'saturday.access',
	version: 1,
	allow_lan: false,
	idle_timeout_seconds: 3600,
	password: null
});
export const accessPath = (installation = getInstallation()) =>
	join(installation.data_root, 'access.json');
export function accessCookieName(kind = 'login', installation = getInstallation()) {
	const id = createHash('sha256').update(installation.installation_id).digest('hex').slice(0, 20);
	return `saturday-${kind}-${id}`;
}
export function validateAccessSettings(value) {
	const password = value?.password;
	if (
		value?.format !== 'saturday.access' ||
		value.version !== 1 ||
		value.allow_lan !== false ||
		!(
			value.idle_timeout_seconds === null ||
			(Number.isInteger(value.idle_timeout_seconds) &&
				value.idle_timeout_seconds >= 900 &&
				value.idle_timeout_seconds <= 2592000)
		) ||
		!(
			password === null ||
			(password?.algorithm === 'scrypt' &&
				password.N === 131072 &&
				password.r === 8 &&
				password.p === 1 &&
				/^[a-f0-9]{32}$/.test(password.salt ?? '') &&
				/^[a-f0-9]{128}$/.test(password.hash ?? ''))
		)
	)
		throw new AccessError(
			'Sign-in settings are invalid or unsupported. Use local access recovery; your career records are preserved.',
			503
		);
	return value;
}
export function readAccessSettings(installation = getInstallation()) {
	const path = accessPath(installation);
	try {
		if (!existsSync(path)) {
			if (installation.initialized.access) throw new Error('Missing initialized settings');
			return defaultAccessSettings();
		}
		const stat = lstatSync(path);
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
			throw new Error('Unsafe settings');
		return validateAccessSettings(JSON.parse(readFileSync(path, 'utf8')));
	} catch {
		throw new AccessError(
			'Sign-in settings are unavailable. Use local access recovery; your career records are preserved.',
			503
		);
	}
}
// Setup can supply its already-locked descriptor object so later setup saves retain the marker.
export async function initializeAccessSettings({
	installation = getInstallation(),
	locked = false
} = {}) {
	if (!installation.descriptor_path) return readAccessSettings(installation);
	const release = locked
		? null
		: await acquireDirectoryLock(`${installation.descriptor_path}.lock`);
	try {
		const current = locked ? installation : getInstallation();
		const settings = readAccessSettings(current);
		if (!current.initialized.access) {
			current.initialized.access = true;
			const { descriptor_path, ...descriptor } = current;
			await atomicJson(descriptor_path, descriptor);
		}
		if (!existsSync(accessPath(current))) await atomicJson(accessPath(current), settings);
		return settings;
	} finally {
		await release?.();
	}
}
export async function updateAccessSettings(change, { recover = false } = {}) {
	const installation = getInstallation();
	if (!installation.descriptor_path)
		throw new AccessError('Run Saturday setup before changing sign-in settings.', 409);
	const release = await acquireDirectoryLock(`${installation.descriptor_path}.lock`);
	try {
		const current = getInstallation();
		let previous;
		if (recover) previous = defaultAccessSettings();
		else previous = await initializeAccessSettings({ installation: current, locked: true });
		const next = validateAccessSettings(await change(structuredClone(previous)));
		if (recover && !current.initialized.access) {
			current.initialized.access = true;
			const { descriptor_path, ...descriptor } = current;
			await atomicJson(descriptor_path, descriptor);
		}
		// Never replace a linked/non-regular file, even during explicit recovery.
		if (existsSync(accessPath(current))) {
			const stat = lstatSync(accessPath(current));
			if (!stat.isFile() || stat.isSymbolicLink())
				throw new AccessError('Unsafe access settings path. Preserve it for manual recovery.', 409);
		}
		await atomicJson(accessPath(current), next);
		return next;
	} finally {
		await release();
	}
}
export function parseIdleHours(value, noExpiration = false) {
	if (noExpiration) return null;
	if (typeof value !== 'string' || !value.trim())
		throw new AccessError('Enter inactivity hours between 0.25 and 720.');
	const hours = Number(value),
		seconds = Math.round(hours * 3600);
	if (!Number.isFinite(hours) || hours < 0.25 || hours > 720 || !Number.isSafeInteger(seconds))
		throw new AccessError('Enter inactivity hours between 0.25 and 720.');
	return seconds;
}
export function localBrowser(event) {
	return (
		['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(event.getClientAddress()) &&
		['127.0.0.1', 'localhost', '[::1]'].includes(event.url.hostname) &&
		(!process.env.ORIGIN || event.url.origin === process.env.ORIGIN)
	);
}
export function sameOrigin(event) {
	return event.request.headers.get('origin') === event.url.origin;
}
export async function accessForm(request) {
	const reader = request.body?.getReader();
	if (!reader) return new FormData();
	let size = 0;
	const chunks = [];
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 16384) {
				await reader.cancel();
				throw new AccessError('Sign-in form is too large.', 413);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	try {
		return await new Response(Buffer.concat(chunks), {
			headers: { 'content-type': request.headers.get('content-type') ?? '' }
		}).formData();
	} catch {
		throw new AccessError('Invalid sign-in form.');
	}
}
export function safeReturnPath(value) {
	if (
		typeof value !== 'string' ||
		!value.startsWith('/') ||
		value.startsWith('//') ||
		/[\\\r\n]/.test(value)
	)
		return '/';
	try {
		const url = new URL(value, 'http://saturday.invalid');
		return url.origin === 'http://saturday.invalid' &&
			!url.pathname.startsWith('/signin') &&
			!url.pathname.startsWith('/auth/')
			? url.pathname + url.search + url.hash
			: '/';
	} catch {
		return '/';
	}
}
