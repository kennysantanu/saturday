import { untrack } from 'svelte';

/**
 * Transient confirmation, shown as a floating glass toast. A page can call `toast.show(...)`,
 * or redirect with `?saved=<key>` for any key in `SAVED_MESSAGES`; the root layout shows the
 * message and removes the parameter from the address.
 */
export const SAVED_MESSAGES: Record<string, string> = {
	'job-deleted': 'Job deleted.',
	'person-deleted': 'Person deleted.',
	'job-missing': 'Job no longer exists.',
	'person-missing': 'Person no longer exists.',
	access: 'Sign-in setting saved.',
	restored: 'Backup restored.',
	backup: 'Backup saved.',
	person: 'Person saved.',
	'network-linked': 'Relationship linked.',
	'network-unlinked': 'Relationship unlinked.',
	'network-note': 'Relationship note saved.',
	interaction: 'Interaction recorded.',
	'interaction-corrected': 'Interaction corrected.',
	'interaction-deleted': 'Interaction deleted.',
	document: 'Document saved.',
	extension: 'Extension changes saved.',
	profile: 'Profile selection saved.',
	'profile-cleared': 'Profile selection cleared. The document is kept.',
	'document-copy': 'Document copied.',
	'document-deleted': 'Document deleted.',
	'document-pdf': 'PDF generated and saved.',
	'master-cv': 'Master CV selection saved.',
	'file-backup': 'File backup saved.',
	'backup-deleted': 'Backup deleted.',
	job: 'Job details saved.',
	reminder: 'Reminder saved.',
	'reminder-dismissed': 'Reminder dismissed.',
	'reminder-deleted': 'Reminder deleted.',
	starred: 'Starred status updated.',
	update: 'History added.',
	correction: 'History corrected.',
	removed: 'History deleted.',
	'stage-changed': 'Stage changed and milestone recorded.',
	'stage-unchanged': 'Already in this stage; no changes saved.',
	'job-closed': 'Job closed and milestone recorded.',
	reopened: 'Job reopened.'
};

export type ToastAction = { label: string; run: () => void | Promise<void> };
export type ToastTone = 'success' | 'error' | 'info';
export type ToastItem = {
	id: number;
	text: string;
	tone: ToastTone;
	action: ToastAction | null;
	/** Milliseconds before it leaves; 0 keeps it until dismissed. */
	duration: number;
};
type ToastOptions = { duration?: number; action?: ToastAction; tone?: ToastTone };

/** Most toasts on screen at once; the oldest leaves first. */
const MAX_VISIBLE = 3;
const DEFAULT_MS = 5000;
/** A toast with Undo stays longer so a keyboard or screen-reader user can reach it. */
const ACTION_MS = 10000;

let items = $state<ToastItem[]>([]);
/** The latest message for each live region; assistive technology reads only the message. */
let announcement = $state({ polite: '', assertive: '' });
let nextId = 1;
let paused = false;
const timers = new Map<
	number,
	{ handle?: ReturnType<typeof setTimeout>; left: number; at: number }
>();

function arm(id: number, ms: number) {
	const timer = timers.get(id) ?? { left: ms, at: 0 };
	clearTimeout(timer.handle);
	timer.left = ms;
	timer.at = Date.now();
	if (!paused && ms > 0) timer.handle = setTimeout(() => remove(id), ms);
	timers.set(id, timer);
}
function remove(id: number) {
	clearTimeout(timers.get(id)?.handle);
	timers.delete(id);
	items = items.filter((item) => item.id !== id);
}

export const toast = {
	get items() {
		return items;
	},
	get announcement() {
		return announcement;
	},
	/**
	 * `options` is a duration in ms, or `{ duration, action, tone }`. Errors stay until dismissed;
	 * a toast with an action lasts longer. Showing the same message again restarts its timer.
	 */
	show(text: string, options: number | ToastOptions = {}) {
		// Callers may be effects: reading the list here must not make them depend on it.
		untrack(() => this.add(text, options));
	},
	add(text: string, options: number | ToastOptions) {
		const given = typeof options === 'number' ? { duration: options } : options;
		const tone = given.tone ?? 'success';
		const action = given.action ?? null;
		const duration = given.duration ?? (tone === 'error' ? 0 : action ? ACTION_MS : DEFAULT_MS);
		const same = items.find((item) => item.text === text && item.tone === tone);
		const id = same?.id ?? nextId++;
		if (same) items = items.map((item) => (item.id === id ? { ...item, action, duration } : item));
		else {
			// A plain confirmation replaces an earlier one, so quick saves do not pile up over the page;
			// errors and toasts with an action (Undo) are kept and stack.
			const plain = (item: ToastItem) => item.tone !== 'error' && !item.action;
			if (tone !== 'error' && !action)
				for (const old of items.filter(plain)) {
					clearTimeout(timers.get(old.id)?.handle);
					timers.delete(old.id);
				}
			items = [
				...(tone !== 'error' && !action ? items.filter((item) => !plain(item)) : items),
				{ id, text, tone, action, duration }
			];
			while (items.length > MAX_VISIBLE) remove(items[0].id);
		}
		arm(id, duration);
		// Clear first so repeating a message is announced again.
		const channel = tone === 'error' ? 'assertive' : 'polite';
		announcement = { ...announcement, [channel]: '' };
		queueMicrotask(() => (announcement = { ...announcement, [channel]: text }));
	},
	/** A failure: an error look, announced at once and kept until dismissed. */
	error(text: string, options: Omit<ToastOptions, 'tone'> = {}) {
		this.show(text, { ...options, tone: 'error' });
	},
	dismiss(id?: number) {
		if (id === undefined) for (const item of [...items]) remove(item.id);
		else remove(id);
	},
	/** Hold every timer while the pointer or keyboard focus is on a toast. */
	pause() {
		paused = true;
		for (const [id, timer] of timers) {
			clearTimeout(timer.handle);
			timer.left = Math.max(1000, timer.left - (Date.now() - timer.at));
			timers.set(id, timer);
		}
	},
	resume() {
		paused = false;
		for (const [id, timer] of timers) {
			const item = items.find((entry) => entry.id === id);
			if (item && item.duration > 0) arm(id, timer.left);
		}
	}
};
