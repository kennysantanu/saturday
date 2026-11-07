import { possibleDuplicateJobs } from '../../../src/lib/domain/job-duplicates.js';
import { jobFromStorage } from '../../../src/lib/job-fields.js';

// External storage stand-in for runtime checks. No SQL, real network, files, credentials or durability.
export function createStorageFixture() {
	const jobs = new Map();
	let nextId = 1;
	const dataset = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
	const document = {
		id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
		key: 'documents/fixture.pdf',
		scope: 'documents',
		filename: 'fixture.pdf',
		size: 5,
		sha256: '0'.repeat(64),
		token: 'fixture-document-token',
		created_via: 'manual',
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		designations: [],
		designation: null,
		format: 'pdf',
		can_read_text: false,
		can_edit_text: false,
		can_generate_pdf: false
	};
	function present(row) {
		return {
			...jobFromStorage(row),
			dataset_id: dataset,
			tags: [],
			updates: [],
			nextReminder: null,
			isActive: true,
			currentStage: { id: 1, name: 'New', is_closed: false, is_archived: false },
			status: { key: '1', label: 'New', tone: 'progress' }
		};
	}
	return {
		document,
		async fetch(request) {
			const { operation, input } = await request.json();
			let value;
			if (operation === 'getJob') value = jobs.has(input.id) ? present(jobs.get(input.id)) : null;
			else if (operation === 'createJob') {
				const { actor, allow_duplicate, ...fields } = input;
				if (!allow_duplicate) {
					const duplicates = possibleDuplicateJobs(
						fields,
						Array.from(jobs.values(), (row) => ({ ...row, stage: 'New' }))
					);
					if (duplicates.total)
						return Response.json({ code: 'possible_duplicate', ...duplicates }, { status: 409 });
				}
				const row = {
					...fields,
					id: nextId++,
					current_stage_id: 1,
					created_via: actor,
					created_at: '2026-01-01T00:00:00.000Z',
					updated_at: '2026-01-01T00:00:00.000Z'
				};
				jobs.set(row.id, row);
				value = present(row);
			} else if (operation === 'editJob') {
				const row = { ...jobs.get(input.id), ...input };
				jobs.set(row.id, row);
				value = present(row);
			} else if (operation === 'listDocuments')
				value = {
					documents: input.scope === 'documents' ? [document] : [],
					page: 1,
					limit: 50,
					total: input.scope === 'documents' ? 1 : 0,
					totalPages: 1,
					catalog_token: 'fixture-catalog-token'
				};
			else if (operation === 'getDocument')
				value =
					input.id === document.id && input.scope === 'documents'
						? { ...document, can_preview: false, catalog_token: 'fixture-catalog-token' }
						: null;
			else return new Response('Unknown storage fixture operation', { status: 400 });
			return Response.json(value);
		}
	};
}
