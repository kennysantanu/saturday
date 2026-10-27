// Test-only composition, never an app endpoint or a deployable storage/auth implementation.
import {
	createApplication,
	createAssistantCatalog,
	capabilityNames,
	capabilityStatus,
	ServiceError,
	ValidationError
} from '../../../src/lib/application/index.js';
import {
	parseJobInput,
	parseAssessment,
	parseRecordId
} from '../../../src/lib/domain/validation.js';
import { editableJobFields } from '../../../src/lib/job-fields.js';

const capabilities = Object.freeze({ records: true, documents: true });
const contexts = Object.freeze({
	manual: { actor: 'manual', permissions: [] },
	assistant: { actor: 'assistant', permissions: ['assessment.write'] },
	restricted: { actor: 'assistant', permissions: [] }
});
const fixtureCommands = new Set([
	'create_job',
	'edit_job',
	'get_job',
	'list_documents',
	'get_document'
]);

function fixtureOperations(env) {
	async function storage(operation, input) {
		const response = await env.FIXTURE_STORAGE.fetch('https://fixture.invalid/storage', {
			method: 'POST',
			body: JSON.stringify({ operation, input })
		});
		if (!response.ok) throw new ServiceError('Storage fixture failed.', 'fixture_error');
		return response.json();
	}
	return {
		getJob: (_context, id) => storage('getJob', { id: parseRecordId(id, 'job_id') }),
		createJob: (context, input) =>
			storage('createJob', {
				...parseJobInput(input),
				...parseAssessment({ score: null, score_comment: null, ...input }),
				actor: context.actor
			}),
		editJob: async (_context, id, input) => {
			id = parseRecordId(id, 'job_id');
			const previous = await storage('getJob', { id });
			if (!previous) throw new ServiceError('Job not found.', 'not_found');
			const saved = Object.fromEntries(
				editableJobFields.map((field) => [field.name, previous[field.key]])
			);
			return storage('editJob', { id, ...parseJobInput({ ...saved, ...input }) });
		},
		listDocuments: (_context, { scope = 'documents' } = {}) =>
			storage('listDocuments', {
				scope: scope === 'documents' ? scope : parseRecordId(scope, 'job_id')
			}),
		getDocument: (_context, { id, scope = 'documents' }) => storage('getDocument', { id, scope }),
		setJobScore: () => {
			throw new Error('Not implemented by the fixture.');
		},
		deleteJob: () => {
			throw new Error('Permission guard must run first.');
		},
		generateDocumentPdf: () => {
			throw new Error('Capability guard must run first.');
		}
	};
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const implementations = fixtureOperations(env);
		const context = contexts[url.searchParams.get('caller') ?? 'manual'];
		if (!context) return new Response('Unknown fixture caller', { status: 400 });
		const application = createApplication(implementations, context, capabilities);
		const catalog = createAssistantCatalog(application, capabilities).filter((command) =>
			fixtureCommands.has(command.name)
		);
		if (url.pathname === '/diagnostics')
			return Response.json({
				nodeGlobals: {
					process: typeof globalThis.process,
					Buffer: typeof globalThis.Buffer,
					require: typeof globalThis.require
				},
				webCrypto: typeof crypto.subtle.digest === 'function',
				capabilities: capabilityNames.map((name) => capabilityStatus(capabilities, name)),
				commands: catalog.map(({ name }) => name)
			});
		if (url.pathname === '/egress') return fetch('https://network-disabled.invalid');
		try {
			const { operation, args = [], name, input = {} } = await request.json();
			let value;
			if (url.pathname === '/command') {
				const command = catalog.find((command) => command.name === name);
				if (!command) throw new ServiceError('Unknown fixture command.', 'not_found');
				value = await command.execute(input);
			} else if (url.pathname === '/operation' && Object.hasOwn(application, operation)) {
				value = await application[operation](...args);
			} else throw new ServiceError('Unknown fixture operation.', 'not_found');
			return Response.json({ ok: true, value });
		} catch (error) {
			return Response.json(
				{
					ok: false,
					error: {
						code:
							error instanceof ValidationError
								? 'validation_error'
								: (error.code ?? 'operation_failed'),
						message: error.message,
						...(error instanceof ValidationError ? { fields: error.fieldErrors } : {})
					}
				},
				{ status: 400 }
			);
		}
	}
};
