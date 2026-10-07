import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { fileType } from '../../file-types.js';
import {
	withFileLock,
	entryFor,
	info,
	readText,
	checkToken,
	filename,
	scopePrefix,
	createEntry,
	commitManifest,
	uniqueName,
	bytesMetadata,
	reject,
	fs,
	filePaths,
	UPLOAD_LIMIT,
	TEXT_LIMIT,
	verifiedPath,
	LocalFileStore
} from './store.js';

function textBytes(name, content) {
	if (typeof name !== 'string') reject('VALIDATION', 'Enter a filename.');
	if (!fileType(name).text)
		reject('UNSUPPORTED_FORMAT', 'Only Markdown, HTML and TXT can be created or edited as text.');
	if (typeof content !== 'string') reject('VALIDATION', 'Content must be text.');
	const bytes = Buffer.from(content);
	if (bytes.length > TEXT_LIMIT) reject('SIZE_LIMIT', 'Text editing is limited to 1 MiB.');
	return bytes;
}
export async function listDocuments({
	scope = 'documents',
	query = '',
	page = 1,
	limit = 50,
	catalog_token,
	editable_markdown = false
} = {}) {
	return withFileLock(async (m) => {
		const prefix = scopePrefix(scope);
		if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100)
			reject('VALIDATION', 'Invalid document pagination.');
		if (catalog_token) checkToken(m.token, catalog_token);
		const docs = m.documents
			.filter(
				(d) =>
					d.key.startsWith(`${prefix}/`) &&
					basename(d.key).toLowerCase().includes(query.toLowerCase()) &&
					(!editable_markdown || (fileType(d.key).type === 'markdown' && d.size <= TEXT_LIMIT))
			)
			.sort((a, b) => a.key.localeCompare(b.key, 'en') || a.id.localeCompare(b.id));
		return {
			documents: docs.slice((page - 1) * limit, page * limit).map((d) => info(d, m)),
			total: docs.length,
			page,
			limit,
			totalPages: Math.ceil(docs.length / limit),
			catalog_token: m.token,
			...(scope === 'documents'
				? { designations: { master_cv: m.designations.master_cv ?? null } }
				: {})
		};
	});
}
export async function getDocument(
	{ id, designation, scope = 'documents', include_content = false },
	{ includeAvailableContent = false } = {}
) {
	return withFileLock(async (m) => {
		if (!!id === !!designation)
			reject('VALIDATION', 'Specify a document ID or master_cv designation.');
		if (designation) {
			if (designation !== 'master_cv' || scope !== 'documents')
				reject('VALIDATION', 'Invalid designation scope.');
			id = m.designations.master_cv;
			if (!id) reject('NOT_CONFIGURED', 'Master CV has not been selected.');
		}
		const d = entryFor(m, id, scope);

		const result = { ...info(d, m), catalog_token: m.token, can_preview: false };
		if (include_content) {
			result.content = await readText(d);
			result.can_preview = true;
		} else if (result.can_read_text) {
			try {
				const content = await readText(d);
				if (includeAvailableContent) result.content = content;
				result.can_preview = true;
			} catch (e) {
				if (e.code !== 'ENCODING' && e.code !== 'SIZE_LIMIT') throw e;
				result.can_read_text = false;
				result.can_edit_text = false;
				result.can_generate_pdf = false;
				result.capability_reason = e.message;
			}
		} else if (result.format === 'pdf') {
			const handle = await fs.open(await verifiedPath(d), 'r');
			try {
				const bytes = Buffer.alloc(5);
				await handle.read(bytes, 0, 5, 0);
				result.can_preview = bytes.toString() === '%PDF-';
			} finally {
				await handle.close();
			}
		}
		return result;
	});
}
export async function createDocument(
	{ scope = 'documents', filename: name, content },
	origin = 'manual'
) {
	const bytes = textBytes(name, content);
	return withFileLock((m) => createEntry(m, { scope, name, origin, bytes }));
}
export async function editDocument({ id, scope = 'documents', token, filename: name, content }) {
	return withFileLock(async (m) => {
		const d = entryFor(m, id, scope);
		checkToken(d.token, token);
		if (name === undefined && content === undefined)
			reject('VALIDATION', 'Provide content or filename.');
		const old = d.key;
		await verifiedPath(d);
		if (name !== undefined) {
			name = filename(name);
			const next = `${scopePrefix(scope)}/${name}`;
			if (m.documents.some((x) => x.id !== id && x.key.toLowerCase() === next.toLowerCase()))
				reject('COLLISION', 'That filename already exists.');
			if (m.designations.master_cv === id && fileType(name).type !== 'markdown')
				reject('VALIDATION', 'Clear Master CV before changing its format.');
			d.key = next;
		}
		let bytes;
		if (content !== undefined) bytes = textBytes(d.key, content);
		else if (d.key !== old && fileType(d.key).text) {
			const previous = { ...d, key: old };
			if (previous.size > TEXT_LIMIT) reject('SIZE_LIMIT', 'Text editing is limited to 1 MiB.');
			const raw = await fs.readFile(await verifiedPath(previous));
			try {
				new TextDecoder('utf-8', { fatal: true }).decode(raw);
			} catch {
				reject('ENCODING', 'Text must be valid UTF-8.');
			}
		}
		const changes = [];
		if (bytes) {
			Object.assign(d, bytesMetadata(bytes));
			changes.push({ key: d.key, bytes });
		} else if (d.key !== old)
			changes.push({ key: d.key, path: await verifiedPath({ ...d, key: old }) });
		// Delete first so case-only renames also work on case-insensitive disks.
		if (old !== d.key) changes.unshift({ key: old, remove: true });
		d.updated_at = new Date().toISOString();
		d.token = randomUUID();
		await commitManifest(m, changes);
		return info(d, m);
	});
}
export async function copyDocument(
	{ id, scope = 'documents', token, destination_scope, filename: name },
	origin = 'manual'
) {
	return withFileLock(async (m) => {
		const d = entryFor(m, id, scope);
		checkToken(d.token, token);
		const path = await verifiedPath(d);
		const dest = destination_scope ?? scope;
		const prefix = scopePrefix(dest);
		if (destination_scope !== undefined && !name)
			reject('VALIDATION', 'Supply a destination filename.');
		name = name ?? uniqueName(m, prefix, basename(d.key), true);
		return createEntry(m, { scope: dest, name, origin, path });
	});
}
export async function deleteDocument({
	id,
	scope = 'documents',
	token,
	confirm,
	catalog_token,
	clear_master = false
}) {
	return withFileLock(async (m) => {
		if (confirm !== true) reject('CONFIRMATION', 'Confirm permanent deletion first.');
		const d = entryFor(m, id, scope);
		checkToken(d.token, token);
		if (m.designations.master_cv === id) {
			checkToken(m.token, catalog_token);
			if (!clear_master)
				reject('CONFIRMATION', 'Deleting this file also clears Master CV. Acknowledge this first.');
			delete m.designations.master_cv;
		}
		m.documents = m.documents.filter((d) => d.id !== id);
		await commitManifest(m, [{ key: d.key, remove: true }]);
		return { id, deleted: true, catalog_token: m.token };
	});
}
export async function setMasterDocument({ id, token, catalog_token }) {
	return withFileLock(async (m) => {
		checkToken(m.token, catalog_token);
		if (id !== null) {
			const d = entryFor(m, id);
			checkToken(d.token, token);
			if (fileType(d.key).type !== 'markdown')
				reject('UNSUPPORTED_FORMAT', 'Select an existing Markdown document.');
			await readText(d);
		}
		if ((m.designations.master_cv ?? null) === id) return { master_cv: id, catalog_token: m.token };
		if (id === null) delete m.designations.master_cv;
		else m.designations.master_cv = id;
		await commitManifest(m);
		return { master_cv: id, catalog_token: m.token };
	});
}
export async function uploadDocument(
	{ scope = 'documents', filename: name, stream },
	origin = 'manual'
) {
	name = filename(name);
	const p = filePaths();
	await fs.mkdir(p.state, { recursive: true, mode: 0o700 });
	const temp = `${p.state}/upload-${randomUUID()}`;
	let size = 0;
	try {
		await pipeline(
			stream,
			new Transform({
				transform(c, _, cb) {
					size += c.length;
					cb(
						size > UPLOAD_LIMIT
							? Object.assign(new Error('File uploads are limited to 25 MiB.'), {
									code: 'SIZE_LIMIT'
								})
							: null,
						c
					);
				}
			}),
			createWriteStream(temp, { flags: 'wx', mode: 0o600 })
		);
		return await withFileLock((m) => createEntry(m, { scope, name, path: temp, origin }));
	} finally {
		await fs.rm(temp, { force: true });
	}
}
export async function openDocument({ id, scope = 'documents', range, token }) {
	return withFileLock(async (m) => {
		const d = entryFor(m, id, scope);
		if (token) checkToken(d.token, token);
		await verifiedPath(d);
		return { ...(await new LocalFileStore().open(d.key, { range })), document: info(d, m) };
	});
}
export async function storageSummary() {
	return withFileLock(async (m) => ({
		count: m.documents.length,
		bytes: m.documents.reduce((n, d) => n + d.size, 0),
		root: filePaths().root,
		unmatched: [
			...new Set(
				m.documents.filter((d) => d.key.startsWith('jobs/')).map((d) => d.key.split('/')[1])
			)
		].filter((id) => {
			try {
				scopePrefix(id);
				return false;
			} catch {
				return true;
			}
		})
	}));
}
export async function recoveryDocuments(jobId) {
	return withFileLock(async (m) => {
		scopePrefix(jobId, false);
		return m.documents.filter((d) => d.key.startsWith(`jobs/${jobId}/`)).map((d) => info(d, m));
	});
}
export async function recoverCopy({ id, job_id, destination_scope, filename: name, token }) {
	return withFileLock(async (m) => {
		const d = m.documents.find(
			(d) => d.id === id && d.key.startsWith(`${scopePrefix(job_id, false)}/`)
		);
		if (!d) reject('NOT_FOUND', 'Recovery file not found.');
		checkToken(d.token, token);
		return createEntry(m, {
			scope: destination_scope,
			name,
			path: await verifiedPath(d)
		});
	});
}
