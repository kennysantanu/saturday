/**
 * Transient confirmation, shown as a floating glass toast. A page can call `toast.show(...)`,
 * or redirect with `?saved=<key>` for any key in `SAVED_MESSAGES`; the root layout shows the
 * message and removes the parameter from the address.
 */
export const SAVED_MESSAGES: Record<string, string> = {
	restored: 'Backup restored.',
	document: 'Document saved.',
	'document-copy': 'Document copied.',
	'document-deleted': 'Document deleted.',
	'document-pdf': 'PDF generated and saved.',
	'master-cv': 'Master CV selection saved.',
	'file-backup': 'File backup saved.',
	'file-settings': 'File backup settings saved.',
	'backup-settings': 'Automatic backup settings saved.',
	job: 'Job details saved.',
	'follow-up': 'Follow-up saved.',
	'follow-up-cleared': 'Follow-up cleared.',
	starred: 'Starred status updated.',
	update: 'Update saved.',
	correction: 'Update corrected.',
	removed: 'Update removed.',
	dismissed: 'Job dismissed.',
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
