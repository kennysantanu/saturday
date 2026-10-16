import { extensionCatalog } from '$lib/server/extensions.js';
export async function load({ locals, url }) {
	const access = locals.access;
	if (url.pathname === '/signin' || !access?.authenticated)
		return { extensionsEnabled: false, access };
	try {
		return { extensionsEnabled: (await extensionCatalog()).extensions_enabled, access };
	} catch {
		return { extensionsEnabled: false, access };
	}
}
