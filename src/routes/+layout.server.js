import { extensionCatalog } from '$lib/server/extensions.js';
import { getNavigationSettings } from '$lib/server/application.js';
export async function load({ locals, url }) {
	const access = locals.access;
	if (url.pathname === '/signin' || !access?.authenticated)
		return { extensionsEnabled: false, access };
	let navigationSettings = { enabled: false, limit: 10 };
	try {
		navigationSettings = await getNavigationSettings();
	} catch {
		// Optional navigation must not block storage diagnostics or recovery.
	}
	try {
		return {
			navigationSettings,
			extensionsEnabled: (await extensionCatalog()).extensions_enabled,
			access
		};
	} catch {
		return { navigationSettings, extensionsEnabled: false, access };
	}
}
