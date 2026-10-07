import { fail, redirect, error } from '@sveltejs/kit';
import * as documents from './documents.js';
import { generateDocumentPdf } from './pdf.js';
import { filename, publicFileError, reject } from './store.js';
const pageScope = (event) => event.params.id ?? 'documents';
const listUrl = (scope) => (scope === 'documents' ? '/documents' : `/jobs/${scope}/documents`);
function fileFailure(e, values = {}) {
	return fail(400, {
		fileError: publicFileError(e).message,
		values
	});
}
export async function listLoad(event) {
	const scope = pageScope(event);
	try {
		const result = await documents.listDocuments({
			scope,
			query: event.url.searchParams.get('query') ?? '',
			page: Number(event.url.searchParams.get('page') || 1)
		});
		let master = null;
		if (scope === 'documents' && result.designations.master_cv)
			master = await documents.getDocument({ id: result.designations.master_cv });
		return {
			...result,
			scope,
			base: listUrl(scope),
			master,
			query: event.url.searchParams.get('query') ?? '',
			fileError: null
		};
	} catch (e) {
		return {
			documents: [],
			total: 0,
			page: 1,
			totalPages: 0,
			limit: 50,
			scope,
			base: listUrl(scope),
			master: null,
			catalog_token: '',
			query: '',
			fileError: e.code ? e.message : 'File store is unavailable.'
		};
	}
}
export const listActions = {
	rename: async (e) => {
		const v = Object.fromEntries(await e.request.formData());
		try {
			await documents.editDocument({
				id: v.id,
				scope: pageScope(e),
				token: v.token,
				filename: v.filename
			});
		} catch (err) {
			return fileFailure(err, v);
		}
		redirect(303, `${listUrl(pageScope(e))}?saved=document`);
	},
	duplicate: async (e) => {
		const v = Object.fromEntries(await e.request.formData());
		try {
			await documents.copyDocument({ id: v.id, scope: pageScope(e), token: v.token });
		} catch (err) {
			return fileFailure(err, v);
		}
		redirect(303, `${listUrl(pageScope(e))}?saved=document-copy`);
	},
	copy: async (e) => {
		const v = Object.fromEntries(await e.request.formData());
		try {
			if (pageScope(e) === 'documents') error(400, 'Copy is a job action.');
			await documents.copyDocument({
				id: v.id,
				scope: 'documents',
				token: v.token,
				destination_scope: pageScope(e),
				filename: v.filename
			});
		} catch (err) {
			return fileFailure(err, v);
		}
		redirect(303, `${listUrl(pageScope(e))}?saved=document-copy`);
	},
	delete: async (e) => {
		const v = Object.fromEntries(await e.request.formData());
		try {
			await documents.deleteDocument({
				id: v.id,
				scope: pageScope(e),
				token: v.token,
				confirm: v.confirm === 'true',
				catalog_token: v.catalog_token,
				clear_master: v.clear_master === 'true'
			});
		} catch (err) {
			return fileFailure(err, v);
		}
		redirect(303, `${listUrl(pageScope(e))}?saved=document-deleted`);
	},
	master: async (e) => {
		const v = Object.fromEntries(await e.request.formData());
		try {
			if (pageScope(e) !== 'documents') error(400, 'Invalid scope');
			await documents.setMasterDocument({
				id: v.id || null,
				token: v.token,
				catalog_token: v.catalog_token
			});
		} catch (err) {
			return fileFailure(err, v);
		}
		redirect(303, '/documents?saved=master-cv');
	}
};
export async function editorLoad(e) {
	const scope = pageScope(e);
	if (!e.params.documentId)
		return {
			scope,
			base: listUrl(scope),
			document: null,
			content: '',
			edit: true,
			textError: null
		};
	let d;
	try {
		d = await documents.getDocument(
			{ id: e.params.documentId, scope },
			{ includeAvailableContent: true }
		);
	} catch (err) {
		error(err.code === 'NOT_FOUND' ? 404 : 400, err.code ? err.message : 'Document unavailable.');
	}
	return {
		scope,
		base: listUrl(scope),
		document: d,
		content: d.content ?? '',
		edit: e.url.searchParams.get('edit') === '1',
		textError: null
	};
}
function newMarkdownName(input) {
	const name = filename(String(input ?? ''));
	if (/\.(markdown|html?|txt|pdf|docx?|rtf|odt|csv|zip|png|jpe?g)$/i.test(name))
		reject('VALIDATION', 'New documents use .md. Enter a name without another file extension.');
	return `${name.replace(/\.md$/i, '')}.md`;
}
export const editorActions = {
	save: async (e) => {
		const v = Object.fromEntries(await e.request.formData());
		let d;
		try {
			d = e.params.documentId
				? await documents.editDocument({
						id: e.params.documentId,
						scope: pageScope(e),
						token: v.token,
						content: v.content
					})
				: await documents.createDocument({
						scope: pageScope(e),
						filename: newMarkdownName(v.filename),
						content: v.content
					});
		} catch (err) {
			return fileFailure(err, v);
		}
		redirect(303, `${listUrl(pageScope(e))}/${d.id}?saved=document`);
	},
	saveCopy: async (e) => {
		const v = Object.fromEntries(await e.request.formData());
		let d;
		try {
			d = await documents.createDocument({
				scope: pageScope(e),
				filename: v.filename,
				content: v.content
			});
		} catch (err) {
			return fileFailure(err, v);
		}
		redirect(303, `${listUrl(pageScope(e))}/${d.id}?saved=document-copy`);
	},
	pdf: async (e) => {
		const v = Object.fromEntries(await e.request.formData());
		let d;
		try {
			d = await generateDocumentPdf({
				id: e.params.documentId,
				scope: pageScope(e),
				token: v.token
			});
		} catch (err) {
			return fileFailure(err, v);
		}
		redirect(303, `${listUrl(pageScope(e))}/${d.id}?saved=document-pdf`);
	}
};
