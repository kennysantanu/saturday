import { fail, redirect } from '@sveltejs/kit';
import { documentDesignations } from '$lib/file-types.js';
import { listDocuments, getDocument, setMasterDocument } from '$lib/server/files/documents.js';
import { publicFileError } from '$lib/server/files/store.js';

export async function load({ url }) {
	try {
		const catalog = await listDocuments();
		const select = url.searchParams.get('select');
		if (select && !Object.hasOwn(documentDesignations, select))
			throw Object.assign(new Error('Invalid document designation.'), { code: 'VALIDATION' });
		/** @type {Record<string, any>} */
		const selected = {};
		for (const key of Object.keys(documentDesignations)) {
			const id = catalog.designations[key];
			selected[key] = id ? await getDocument({ id }) : null;
		}
		const choices = select
			? await listDocuments({
					query: url.searchParams.get('query') ?? '',
					page: Number(url.searchParams.get('page') || 1),
					editable_format: documentDesignations[select].format
				})
			: null;
		return {
			selected,
			catalog_token: choices?.catalog_token ?? catalog.catalog_token,
			select,
			choices,
			query: url.searchParams.get('query') ?? '',
			fileError: null
		};
	} catch (e) {
		return {
			selected: {},
			catalog_token: '',
			select: null,
			choices: null,
			query: '',
			fileError: publicFileError(e).message
		};
	}
}
export const actions = {
	select: async ({ request }) => {
		const v = Object.fromEntries(await request.formData());
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
		redirect(303, '/profile?saved=profile');
	}
};
