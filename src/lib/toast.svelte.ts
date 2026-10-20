/**
 * Transient confirmation, shown as a floating glass toast. A page can call `toast.show(...)`,
 * or redirect with `?saved=<key>` for any key in `SAVED_MESSAGES`; the root layout shows the
 * message and removes the parameter from the address.
 */
export const SAVED_MESSAGES: Record<string, string> = {
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
	'document-copy': 'Document copied.',
	'document-deleted': 'Document deleted.',
	'document-pdf': 'PDF generated and saved.',
	'master-cv': 'Master CV selection saved.',
	'file-backup': 'File backup saved.',
	'backup-deleted': 'Backup deleted.',
	job: 'Job details saved.',
	'follow-up': 'Follow-up saved.',
	'follow-up-cleared': 'Follow-up cleared.',
	starred: 'Starred status updated.',
	update: 'History added.',
	correction: 'History corrected.',
	removed: 'History deleted.',
	'stage-changed': 'Stage changed and milestone recorded.',
	'stage-unchanged': 'Already in this stage; no changes saved.',
	'job-closed': 'Job closed and milestone recorded.',
	reopened: 'Job reopened.'
};

let message = $state('');
let timer: ReturnType<typeof setTimeout> | undefined;

export const toast = {
	get message() {
		return message;
	},
	show(text: string, duration = 5000) {
		clearTimeout(timer);
		message = text;
		timer = setTimeout(() => (message = ''), duration);
	},
	dismiss() {
		clearTimeout(timer);
		message = '';
	}
};
