import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

const root = await mkdtemp(join(tmpdir(), 'saturday-doc-filters-'));
process.env.SATURDAY_FILES_PATH = join(root, 'files');
process.env.SATURDAY_DB_PATH = join(root, 'jobs.sqlite');
const d = await import('../src/lib/server/files/documents.js');
test.after(async () => rm(root, { recursive: true, force: true }));

const names = (result) => result.documents.map((doc) => doc.filename);

test('document list filters by type and sorts by name, update time and size', async () => {
	await d.createDocument({ filename: 'b-notes.md', content: 'x' });
	await d.createDocument({ filename: 'a-letter.md', content: 'x'.repeat(50) });
	await d.createDocument({ filename: 'c-page.html', content: 'x'.repeat(10) });
	await d.uploadDocument({ filename: 'scan.png', stream: Readable.from([Buffer.alloc(500)]) });
	await d.uploadDocument({ filename: 'data.bin', stream: Readable.from([Buffer.alloc(5)]) });

	assert.deepEqual(names(await d.listDocuments()), [
		'a-letter.md',
		'b-notes.md',
		'c-page.html',
		'data.bin',
		'scan.png'
	]);
	assert.deepEqual(names(await d.listDocuments({ type: 'markdown' })), [
		'a-letter.md',
		'b-notes.md'
	]);
	assert.deepEqual(names(await d.listDocuments({ type: 'image' })), ['scan.png']);
	assert.deepEqual(names(await d.listDocuments({ type: 'other' })), ['data.bin']);
	assert.equal((await d.listDocuments({ type: 'markdown', query: 'notes' })).total, 1);
	assert.equal((await d.listDocuments({ type: 'video' })).total, 0);

	assert.deepEqual(names(await d.listDocuments({ sort: 'size' })).slice(0, 2), [
		'scan.png',
		'a-letter.md'
	]);
	assert.equal(names(await d.listDocuments({ sort: 'updated' })).length, 5);
	const second = await d.listDocuments({ sort: 'size', limit: 2, page: 2 });
	assert.deepEqual(names(second), ['c-page.html', 'data.bin']);

	await assert.rejects(d.listDocuments({ type: 'nope' }), { code: 'VALIDATION' });
	await assert.rejects(d.listDocuments({ sort: 'nope' }), { code: 'VALIDATION' });
});
