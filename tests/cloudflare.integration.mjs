import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { buildCloudflareHarness } from '../scripts/cloudflare-build.mjs';
import { createStorageFixture } from './fixtures/cloudflare/storage.js';
import { verifyJobCrud } from './contracts/job-crud.mjs';

const compatibilityDate = '2026-07-30';

test('portable graph rejects Node, server, framework and extension imports even when unused', async () => {
	const scratch = await mkdtemp(join(tmpdir(), 'saturday-cloudflare-graph-'));
	try {
		const result = await buildCloudflareHarness();
		for (const path of [
			'src/lib/application/operations.js',
			'src/lib/application/assistant-catalog.js',
			'src/lib/domain/validation.js'
		])
			assert(Object.hasOwn(result.metafile.inputs, path), path);
		const entry = join(scratch, 'invalid.mjs');
		for (const module of [
			'node:fs',
			'fs',
			'node:sqlite',
			'@sveltejs/kit',
			'@modelcontextprotocol/server',
			resolve('src/lib/server/services.js'),
			resolve('src/lib/server/extensions.generated.js')
		]) {
			await writeFile(
				entry,
				`import * as unused from ${JSON.stringify(module)}; export default {};`
			);
			await assert.rejects(
				buildCloudflareHarness(entry),
				(error) => error.errors.some((item) => /Unavailable|cannot enter/.test(item.text)),
				module
			);
		}
		for (const expression of [
			'process.env.HOME',
			'Buffer.from("x")',
			'require("fs")',
			'globalThis.process.env.HOME'
		]) {
			await writeFile(
				entry,
				`export function unused() { return ${expression}; } export default {};`
			);
			await assert.rejects(
				buildCloudflareHarness(entry),
				(error) => error.errors.some((item) => /Node global/.test(item.text)),
				expression
			);
		}
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
});

test(
	'shared application and assistant commands execute in local Cloudflare workerd without Node compatibility',
	{ timeout: 60000 },
	async (t) => {
		const scratch = await mkdtemp(join(tmpdir(), 'saturday-cloudflare-runtime-'));
		let runtime;
		try {
			const build = await buildCloudflareHarness();
			const scriptPath = join(scratch, 'worker.mjs');
			await writeFile(scriptPath, build.outputFiles[0].contents);
			const fixture = createStorageFixture();
			let outboundRequests = 0;
			runtime = new Miniflare({
				modules: true,
				scriptPath,
				modulesRoot: scratch,
				compatibilityDate,
				compatibilityFlags: [],
				host: '127.0.0.1',
				port: 0,
				cf: false,
				defaultPersistRoot: join(scratch, 'state'),
				serviceBindings: { FIXTURE_STORAGE: (request) => fixture.fetch(request) },
				outboundService: () => {
					outboundRequests++;
					return new Response('Network disabled', { status: 403 });
				}
			});
			async function request(path, body, caller = 'manual') {
				const response = await runtime.dispatchFetch(
					`http://saturday.test${path}?caller=${caller}`,
					{
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(body)
					}
				);
				const result = await response.json();
				if (!result.ok)
					throw Object.assign(new Error(result.error.message), {
						code: result.error.code,
						fieldErrors: result.error.fields
					});
				return result.value;
			}
			const invoke = (operation, args, caller) =>
				request('/operation', { operation, args }, caller);
			const diagnostics = await (
				await runtime.dispatchFetch('http://saturday.test/diagnostics')
			).json();
			assert.deepEqual(diagnostics.nodeGlobals, {
				process: 'undefined',
				Buffer: 'undefined',
				require: 'undefined'
			});
			assert.equal(diagnostics.webCrypto, true);
			for (const name of [
				'pdf',
				'host.controls',
				'host.installation',
				'extensions',
				'recovery.paired',
				'assistant.stdio'
			])
				assert.equal(
					diagnostics.capabilities.find((entry) => entry.capability === name).available,
					false
				);
			assert(diagnostics.commands.includes('create_job'));
			assert(diagnostics.commands.includes('list_documents'));
			assert(!diagnostics.commands.includes('generate_document_pdf'));
			assert(!diagnostics.commands.includes('restore_backup'));
			await t.test('validated creation, reads and partial-update contract', async () => {
				await verifyJobCrud({
					createJob: (input) => invoke('createJob', [input]),
					editJob: (id, input) => invoke('editJob', [id, input]),
					getJob: (id) => invoke('getJob', [id])
				});
			});
			await t.test(
				'assistant catalog uses the same stored records and preserves validation and permission guards',
				async () => {
					const created = await request(
						'/command',
						{ name: 'create_job', input: { job_title: 'Assistant job', company_name: 'Example' } },
						'assistant'
					);
					assert.equal((await invoke('getJob', [created.id])).title, created.title);
					assert.equal((await invoke('getJob', [created.id])).createdVia, 'assistant');
					await request(
						'/command',
						{ name: 'edit_job', input: { job_id: created.id, notes: 'From assistant' } },
						'assistant'
					);
					assert.equal((await invoke('getJob', [created.id])).notes, 'From assistant');
					await assert.rejects(
						request(
							'/command',
							{ name: 'create_job', input: { job_title: '', company_name: 'Example' } },
							'assistant'
						),
						{ code: 'validation_error' }
					);
					await assert.rejects(
						invoke(
							'createJob',
							[
								{
									job_title: 'No permission',
									company_name: 'Example',
									score: 5,
									permissions: ['assessment.write']
								}
							],
							'restricted'
						),
						{ code: 'forbidden' }
					);
					await assert.rejects(invoke('setJobScore', [created.id, { score: 5 }]), {
						code: 'forbidden'
					});
					await assert.rejects(
						invoke(
							'deleteJob',
							[
								{
									job_id: created.id,
									confirm: true,
									actor: 'assistant',
									permissions: ['records.delete']
								}
							],
							'restricted'
						),
						{ code: 'forbidden' }
					);
					await assert.rejects(
						invoke('generateDocumentPdf', [{ capability: 'pdf', available: true }]),
						{ code: 'unsupported_capability' }
					);
				}
			);
			await t.test(
				'document metadata crosses the async storage binding with logical scope and no local paths',
				async () => {
					const listed = await request(
						'/command',
						{ name: 'list_documents', input: {} },
						'assistant'
					);
					assert.equal(listed.documents[0].key, 'documents/fixture.pdf');
					assert.equal(listed.documents[0].id, fixture.document.id);
					assert(!('path' in listed.documents[0]));
					assert.equal((await invoke('listDocuments', [{ scope: 12 }])).total, 0);
					const document = await request(
						'/command',
						{ name: 'get_document', input: { id: fixture.document.id } },
						'assistant'
					);
					assert.equal(document.size, fixture.document.size);
					assert.equal(document.sha256, fixture.document.sha256);
					await assert.rejects(invoke('listDocuments', [{ scope: '../files' }]), {
						code: 'validation_error'
					});
				}
			);
			assert.equal(outboundRequests, 0, 'Storage uses only the local binding.');
			assert.equal((await runtime.dispatchFetch('http://saturday.test/egress')).status, 403);
			assert.equal(outboundRequests, 1, 'Any attempted public fetch is intercepted locally.');
			const miniflare = JSON.parse(
				await readFile(new URL('../node_modules/miniflare/package.json', import.meta.url))
			);
			t.diagnostic(
				`Miniflare ${miniflare.version}; workerd ${miniflare.dependencies.workerd}; compatibility ${compatibilityDate}; no Node flags; no outbound network`
			);
		} finally {
			await runtime?.dispose();
			await rm(scratch, { recursive: true, force: true });
		}
	}
);
