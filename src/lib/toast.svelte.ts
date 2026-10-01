/**
 * Transient confirmation, shown as a floating glass toast. A page can call `toast.show(...)`,
 * or redirect with `?saved=<key>` for any key in `SAVED_MESSAGES`; the root layout shows the
 * message and removes the parameter from the address.
 */
export const SAVED_MESSAGES: Record<string, string> = {
	job: 'Job details saved.',
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
