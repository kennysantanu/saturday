import { extensionCatalog } from '$lib/server/extensions.js';
export async function load() {
	try {
		return { extensionsEnabled: (await extensionCatalog()).extensions_enabled };
	} catch {
		return { extensionsEnabled: false };
	}
}
