import { documentDesignations } from '../../file-types.js';
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

		return {
			...result,
			scope,
			base: listUrl(scope),
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
				clear_master: v.clear_master === 'true',
				clear_designations: v.clear_designations === 'true'
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
				catalog_token: v.catalog_token,
				designation: v.designation || undefined
			});
		} catch (err) {
			return fileFailure(err, v);
		}
		redirect(303, '/profile?saved=profile');
	}
};
export async function editorLoad(e) {
	const scope = pageScope(e);
	const designation = e.url.searchParams.get('designation');
	if (designation && (scope !== 'documents' || !Object.hasOwn(documentDesignations, designation)))
		error(400, 'Invalid document designation.');
	const profile =
		scope === 'documents' && (designation || e.url.searchParams.get('return') === 'profile');
	if (!e.params.documentId) {
		const catalog = designation ? await documents.listDocuments() : null;
		return {
			scope,
			base: listUrl(scope),
			document: null,
			content: '',
			edit: true,
			textError: null,
			designation,
			format: designation ? documentDesignations[designation].format : 'markdown',
			suggestedName: designation?.replaceAll('_', '-') ?? '',
			catalog_token: catalog?.catalog_token,
			returnTo: profile ? '/profile' : null
		};
	}

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
		returnTo: profile ? '/profile' : null,
		textError: null
	};
}
function newMarkdownName(input) {
	const name = filename(String(input ?? ''));
	if (/\.(markdown|html?|txt|pdf|docx?|rtf|odt|csv|zip|png|jpe?g)$/i.test(name))
		reject('VALIDATION', 'New documents use .md. Enter a name without another file extension.');
	return `${name.replace(/\.md$/i, '')}.md`;
}
function profileFilename(input, designation) {
	if (!designation) return newMarkdownName(input);
	if (!Object.hasOwn(documentDesignations, designation))
		reject('VALIDATION', 'Invalid document designation.');
	const extension = documentDesignations[designation].extension;
	const name = filename(String(input ?? ''));
	if (/\.(md|markdown|html?|txt|pdf|docx?|rtf|odt|csv|zip|png|jpe?g)$/i.test(name)) {
		if (!name.toLowerCase().endsWith(extension))
			reject('VALIDATION', `This document uses ${extension}.`);
		return name;
	}
	return `${name}${extension}`;
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
						filename: profileFilename(v.filename, v.designation || null),
						content: v.content,
						designation: v.designation || undefined,
						catalog_token: v.catalog_token
					});
		} catch (err) {
			return fileFailure(err, v);
		}
		if (pageScope(e) === 'documents' && (v.designation || v.returnTo === '/profile'))
			redirect(303, '/profile?saved=profile');
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
