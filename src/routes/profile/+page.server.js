import { fail } from '@sveltejs/kit';
import { documentDesignations, documentDesignationGroups } from '$lib/file-types.js';
import { listDocuments, getDocument, setMasterDocument } from '$lib/server/application.js';
import { publicFileError } from '$lib/server/files/store.js';
import { settled } from '$lib/server/settled.js';

const PICKER_PAGE_SIZE = 5;

export async function load({ url }) {
	try {
		const catalog = await listDocuments();
		// An unknown slot in the address is ignored rather than failing the page.
		const requested = url.searchParams.get('select');
		const select = requested && Object.hasOwn(documentDesignations, requested) ? requested : null;
		/** @type {Record<string, any>} */
		const selected = {};
		/** @type {Record<string, string>} */
		const slotErrors = {};
		// One unreadable slot must not hide the others.
		for (const key of Object.keys(documentDesignations)) {
			const id = catalog.designations[key];
			selected[key] = null;
			if (!id) continue;
			try {
				selected[key] = await getDocument({ id, metadata_only: true });
			} catch (e) {
				slotErrors[key] = publicFileError(e).message;
			}
		}
		const query = select ? (url.searchParams.get('query') ?? '').slice(0, 200) : '';
		const choices = select
			? await listDocuments({
					query,
					page: Math.max(1, Number(url.searchParams.get('page')) || 1),
					limit: PICKER_PAGE_SIZE,
					editable_format: documentDesignations[select].format
				})
			: null;
		return {
			selected,
			slotErrors,
			catalog_token: choices?.catalog_token ?? catalog.catalog_token,
			select,
			choices,
			query,
			fileError: null
		};
	} catch (e) {
		return {
			selected: {},
			slotErrors: {},
			catalog_token: '',
			select: null,
			choices: null,
			query: '',
			fileError: publicFileError(e).message
		};
	}
}
export const actions = {
	select: async (event) => {
		const v = Object.fromEntries(await event.request.formData());
		try {
			await setMasterDocument({
				designation: v.designation,
				id: v.id || null,
				token: v.token,
				catalog_token: v.catalog_token
			});
		} catch (e) {
			return fail(400, { fileError: publicFileError(e).message });
		}
		const saved = v.id ? 'profile' : 'profile-cleared';
		const designation = typeof v.designation === 'string' ? v.designation : '';
		const group = documentDesignationGroups.find((g) => g.keys.includes(designation));
		const hash = group ? `#profile-${group.id}` : '';
		return settled(event, { saved }, `/profile?saved=${saved}${hash}`);
	}
};
