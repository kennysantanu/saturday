import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDocumentation, headings } from '../scripts/documentation-build.mjs';
import { createDocumentationHelp } from '../src/lib/documentation/help.js';
import { connectMcp } from './helpers/mcp-client.mjs';
const documents = buildDocumentation(),
	build = { id: 'fixture.1', commit: 'a'.repeat(40) };
const help = createDocumentationHelp(documents, build);

test('bundled help indexes, ranks relevant sections and preserves complete bounded content', () => {
	assert.equal(help.search().guides.length, 12);
	for (const [query, id] of [
		['phone wifi', 'installation'],
		['forgot password', 'installation'],
		['updates', 'installation'],
		['feature development', 'contributing'],
		['stage workflow', 'usage']
	]) {
		assert(
			help.search({ query, limit: 5 }).results.some((r) => r.document_id === id),
			query
		);
	}
	assert.deepEqual(help.search({ query: 'zxqvvunknown' }).results, []);
	assert.equal(help.search({ query: 'INSTALLATION', limit: 1 }).results.length, 1);
	assert.equal(help.search({ query: '   ' }).guides.length, 12);
	for (const document of documents) {
		assert.equal(document.sections.map((s) => s.markdown).join(''), document.markdown);
		const all = help.read({ document_id: document.id });
		assert(all.markdown.length <= 12000);
		assert.deepEqual(all.build, build);
		if (!all.complete_document) assert(all.remaining_sections.length > 0);
		for (const section of document.sections) {
			const read = help.read({ document_id: document.id, section_id: section.id });
			assert(read.markdown.length <= 7000);
			assert.equal(read.markdown, section.markdown);
		}
	}
	for (const document_id of ['../README.md', '/etc/passwd', 'https://example.com', 'unknown'])
		assert.throws(() => help.read({ document_id }), /search_documentation/);
	assert.throws(
		() => help.read({ document_id: 'installation', section_id: '../../private' }),
		/Unknown section/
	);
	assert.throws(() => help.search({ limit: 11 }), /limit/);
	assert.throws(() => help.search({ query: 'x'.repeat(201) }), /200/);
	assert.deepEqual(
		headings('# A\n```sh\n# hidden\n```\n## A\n').map((h) => h.id),
		['a', 'a-1']
	);
});

test('documentation build rejects missing guides, broken anchors and missing required topics', async () => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-doc-build-'));
	try {
		for (const file of ['README.md', 'LICENSE', 'docs', 'src'])
			await cp(file, join(root, file), { recursive: true });
		assert.equal(buildDocumentation(root).length, 12);
		await writeFile(join(root, 'docs/README.md'), '# Help\n[bad](user-guide.md#missing-anchor)\n');
		assert.throws(() => buildDocumentation(root), /anchor/);
		await cp('docs/README.md', join(root, 'docs/README.md'));
		await writeFile(join(root, 'docs/installation-guide.md'), '# Installation\n');
		assert.throws(() => buildDocumentation(root), /Required help topic|anchor/);
		await cp('docs/installation-guide.md', join(root, 'docs/installation-guide.md'));
		await writeFile(
			join(root, 'docs/contributing.md'),
			(await readFile('docs/contributing.md', 'utf8')).replace(/development/gi, 'coding')
		);
		assert.throws(() => buildDocumentation(root), /Required help topic missing/);
		await cp('docs/contributing.md', join(root, 'docs/contributing.md'));
		await rm(join(root, 'docs/user-guide.md'));
		assert.throws(() => buildDocumentation(root), /target|ENOENT/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('built stdio serves offline help without source files or readable career storage', async () => {
	const root = await mkdtemp(join(tmpdir(), 'saturday-doc-protocol-'));
	let client;
	try {
		await cp('build/mcp/index.js', join(root, 'mcp.js'));
		await writeFile(join(root, 'package.json'), '{"type":"module"}');
		await symlink(resolve('node_modules'), join(root, 'node_modules'));
		const broken = join(root, 'unreadable-database');
		await writeFile(broken, 'not a database');
		const env = {
			...process.env,
			SATURDAY_INSTALLATION_PATH: '',
			SATURDAY_DB_PATH: broken,
			SATURDAY_FILES_PATH: join(root, 'missing-files'),
			SATURDAY_EXTENSION_STATE_PATH: join(root, 'extension-state'),
			SATURDAY_EXTENSIONS_PATH: join(root, 'extensions')
		};
		client = await connectMcp({ entry: join(root, 'mcp.js'), cwd: root, env });
		assert.match(client.initialized.instructions, /search_documentation/);
		const listing = await client.request('tools/list');
		for (const name of ['search_documentation', 'read_documentation']) {
			const tool = listing.tools.find((t) => t.name === name);
			assert.equal(tool.annotations.readOnlyHint, true);
			assert.equal(tool.annotations.destructiveHint, false);
		}
		for (const query of [
			'phone LAN',
			'forgot password',
			'update installation',
			'feature development'
		]) {
			const found = await client.call('search_documentation', { query });
			assert(found.results.length);
			assert.equal(found.build.id, client.initialized.serverInfo.version);
			const hit = found.results[0],
				read = await client.call('read_documentation', {
					document_id: hit.document_id,
					section_id: hit.section_id
				});
			assert(read.markdown.length);
			assert(!JSON.stringify(read).includes(root));
		}
		const recovery = await client.call('search_documentation', {
			query: 'forgot password',
			limit: 10
		});
		const passwordSection = documents
			.find((d) => d.id === 'installation')
			.sections.find((s) => /No browser endpoint can reset a forgotten password/.test(s.markdown));
		const password = await client.call('read_documentation', {
			document_id: 'installation',
			section_id: passwordSection.id
		});
		assert.match(password.markdown, /No browser endpoint can reset a forgotten password/);
		assert(recovery.results.some((r) => r.document_id === 'installation'));
		const invalid = await client.raw('read_documentation', { document_id: '../README.md' });
		assert.equal(invalid.isError, true);
		const missing = await client.raw('get_saturday_info');
		assert.equal(missing.isError, true);
		assert.equal(await readFile(broken, 'utf8'), 'not a database');
	} finally {
		await client?.close();
		await rm(root, { recursive: true, force: true });
	}
});
