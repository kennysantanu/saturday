import { fail, redirect } from '@sveltejs/kit';
import {
	extensionStatus,
	extensionError,
	setExtensionState,
	createExtensionBackup,
	listExtensionBackups,
	prepareExtensionRestore,
	restoreExtension
} from '$lib/server/extensions.js';
import { extensionRegistry } from '$lib/server/extensions.generated.js';
export async function load() {
	try {
		return {
			...(await extensionStatus(extensionRegistry)),
			backups: await listExtensionBackups(),
			extensionError: null
		};
	} catch (e) {
		return {
			enabled: false,
			installed: [],
			backups: [],
			extensionError: extensionError(e).message
		};
	}
}
export const actions = {
	run: async ({ request }) => {
		const v = Object.fromEntries(await request.formData());
		try {
			switch (v.operation) {
				case 'enable':
					await setExtensionState(v.id, true);
					break;
				case 'disable':
					await setExtensionState(v.id, false);
					break;
				case 'remove':
					if (v.confirm !== 'true') return fail(400, { extensionError: 'Confirm removal first.' });
					await setExtensionState(v.id, false, { remove: true });
					break;
				case 'backup':
					await createExtensionBackup(v.id);
					break;
				case 'preview':
					return { preview: await prepareExtensionRestore(v.id, v.backup_id, extensionRegistry) };
				case 'restore':
					await restoreExtension(
						{ restore_id: v.restore_id, confirm: v.confirm === 'true' },
						extensionRegistry
					);
					break;
				default:
					return fail(400, { extensionError: 'Unknown extension action.' });
			}
		} catch (e) {
			return fail(400, { extensionError: extensionError(e).message });
		}
		redirect(303, '/extensions?saved=extension');
	}
};
