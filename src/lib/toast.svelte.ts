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

let message = $state('');
let action = $state<ToastAction | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

export const toast = {
	get message() {
		return message;
	},
	get action() {
		return action;
	},
	/** `options` is a duration in ms, or `{ duration, action }` to add a button such as Undo. */
	show(text: string, options: number | { duration?: number; action?: ToastAction } = 5000) {
		const { duration = 5000, action: next = null } =
			typeof options === 'number' ? { duration: options } : options;
		clearTimeout(timer);
		message = text;
		action = next;
		timer = setTimeout(() => {
			message = '';
			action = null;
		}, duration);
	},
	dismiss() {
		clearTimeout(timer);
		message = '';
		action = null;
	}
};
