import { randomBytes, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { getInstallation } from './installation.js';
import { AccessError, accessCookieName, readAccessSettings } from './access-settings.js';
const scrypt = promisify(derive);
let hashing = 0;
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
export async function passwordHash(password) {
	if (typeof password !== 'string' || !password.length) throw new AccessError('Enter a password.');
	if (Buffer.byteLength(password) > 1024)
		throw new AccessError('Use a password of at most 1,024 bytes.');
	if (hashing >= 2) throw new AccessError('Sign-in is busy. Try again shortly.', 429);
	hashing++;
	try {
		const salt = randomBytes(16).toString('hex');
		const hash = await scrypt(password, salt, 64, {
			N: 131072,
			r: 8,
			p: 1,
			maxmem: 256 * 1024 * 1024
		});
		return { algorithm: 'scrypt', N: 131072, r: 8, p: 1, salt, hash: hash.toString('hex') };
	} finally {
		hashing--;
	}
}
export async function verifyPassword(password, verifier) {
	if (!verifier || typeof password !== 'string' || Buffer.byteLength(password) > 1024 || !password)
		return false;
	if (hashing >= 2) throw new AccessError('Sign-in is busy. Try again shortly.', 429);
	hashing++;
	try {
		const hash = await scrypt(password, verifier.salt, 64, {
			N: verifier.N,
			r: verifier.r,
			p: verifier.p,
			maxmem: 256 * 1024 * 1024
		});
		return timingSafeEqual(hash, Buffer.from(verifier.hash, 'hex'));
	} finally {
		hashing--;
	}
}
export class SessionStore {
	constructor(now = () => Date.now()) {
		this.now = now;
		this.sessions = new Map();
	}
	prune(timeout) {
		if (timeout === null) return;
		for (const [key, session] of this.sessions)
			if (this.now() - session.lastActivity >= timeout * 1000) this.sessions.delete(key);
	}
	create(timeout) {
		this.prune(timeout);
		while (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value);
		const token = randomBytes(32).toString('hex');
		this.sessions.set(tokenHash(token), { createdAt: this.now(), lastActivity: this.now() });
		return token;
	}
	valid(token, timeout, activity = false) {
		if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
		this.prune(timeout);
		const session = this.sessions.get(tokenHash(token));
		if (!session) return false;
		if (activity) session.lastActivity = this.now();
		return true;
	}
	revoke(token) {
		if (typeof token === 'string') this.sessions.delete(tokenHash(token));
	}
	clear() {
		this.sessions.clear();
	}
	changeTimeout(previous, next) {
		this.prune(previous);
		if (previous === null && next !== null)
			for (const session of this.sessions.values()) session.lastActivity = this.now();
		this.prune(next);
	}
}
const states = new Map();
export function authState(settings = readAccessSettings()) {
	const id = getInstallation().installation_id;
	let state = states.get(id);
	if (!state) {
		state = { store: new SessionStore(), settings, attempts: new Map() };
		states.set(id, state);
	}
	if (JSON.stringify(state.settings.password) !== JSON.stringify(settings.password))
		state.store.clear();
	else if (state.settings.idle_timeout_seconds !== settings.idle_timeout_seconds)
		state.store.changeTimeout(state.settings.idle_timeout_seconds, settings.idle_timeout_seconds);
	state.settings = settings;
	return state;
}
export function validLogin(event, settings = readAccessSettings(), activity = false) {
	return (
		!settings.password ||
		authState(settings).store.valid(
			event.cookies.get(accessCookieName()),
			settings.idle_timeout_seconds,
			activity
		)
	);
}
export function loginCookie(event, settings = readAccessSettings()) {
	const token = authState(settings).store.create(settings.idle_timeout_seconds);
	event.cookies.set(accessCookieName(), token, {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		secure: event.url.protocol === 'https:'
	});
}
export function logout(event, all = false) {
	const state = authState();
	if (all) state.store.clear();
	else state.store.revoke(event.cookies.get(accessCookieName()));
	event.cookies.delete(accessCookieName(), { path: '/', secure: event.url.protocol === 'https:' });
	event.cookies.delete(accessCookieName('control'), {
		path: '/',
		secure: event.url.protocol === 'https:'
	});
}
// Bound both the number of clients and expensive failures. No permanent account lockout.
export async function checkPassword(password, address, settings = readAccessSettings()) {
	const state = authState(settings),
		now = Date.now();
	for (const [key, attempt] of state.attempts)
		if (now - attempt.started >= 15 * 60 * 1000) state.attempts.delete(key);
	const key = createHash('sha256').update(address).digest('hex');
	const attempt = state.attempts.get(key);
	if (
		(attempt?.count ?? 0) >= 10 ||
		[...state.attempts.values()].reduce((sum, a) => sum + a.count, 0) >= 100
	)
		throw new AccessError('Too many attempts. Try again in 15 minutes.', 429);
	if (!attempt && state.attempts.size >= 256)
		throw new AccessError('Sign-in is busy. Try again later.', 429);
	const counter = attempt ?? { started: now, count: 0 };
	counter.count++;
	state.attempts.set(key, counter);
	const valid = await verifyPassword(password, settings.password);
	if (valid) state.attempts.delete(key);
	return valid;
}
