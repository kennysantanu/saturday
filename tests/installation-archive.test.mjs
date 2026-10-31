import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { downloadSource, validateSourceArchiveListing } from '../scripts/install.mjs';

const prefix = `saturday-${'a'.repeat(40)}`;
const paths = [prefix + '/', `${prefix}/README.md`, `${prefix}/docs/guide with ü spaces.md`];
const allowed = new Set(paths.map((name) => name.replace(/\/$/, '')));
const details = ['drwxr-xr-x root/root 0 directory', '-rw-r--r-- root/root 6 README.md'];

test('source archive validation accepts LF and Windows CRLF listings with or without a final newline', () => {
	for (const ending of ['\n', '\r\n']) {
		for (const final of ['', ending]) {
			assert.doesNotThrow(() =>
				validateSourceArchiveListing(
					paths.join(ending) + final,
					details.join(ending) + final,
					allowed
				)
			);
		}
	}
});

test('source archive validation still rejects duplicate, unexpected and unsafe names', () => {
	for (const ending of ['\n', '\r\n']) {
		for (const invalid of [
			paths[1],
			prefix,
			`${prefix}/unexpected.js`,
			`${prefix}/../escape`,
			'/absolute',
			'C:/absolute',
			`${prefix}\\README.md`,
			`${prefix}/README.md\0`,
			`${prefix}/README.md `,
			''
		]) {
			assert.throws(
				() =>
					validateSourceArchiveListing(
						[...paths, invalid].join(ending) + ending,
						details.join(ending) + ending,
						allowed
					),
				/Unexpected or duplicate source archive path/
			);
		}
		assert.throws(
			() => validateSourceArchiveListing(' ' + paths.join(ending), details.join(ending), allowed),
			/Unexpected or duplicate source archive path/
		);
	}
});

test('source archive validation still rejects links, special files and empty listings', () => {
	for (const ending of ['\n', '\r\n']) {
		for (const type of ['l', 'h', 'b', 'c', 'p', 's', '']) {
			assert.throws(
				() =>
					validateSourceArchiveListing(
						paths.join(ending),
						[...details, type && `${type}rwxr-xr-x link or special file`].join(ending) + ending,
						allowed
					),
				/links or special files/
			);
		}
	}
	assert.throws(() => validateSourceArchiveListing('', '', allowed), /source archive path/);
});

test('source download validates and extracts a real archive against Git blob hashes', async (t) => {
	const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'saturday-source-download-')));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const source = join(root, 'input'),
		stage = join(root, 'stage'),
		archive = join(root, 'fixture.tar.gz'),
		commit = 'a'.repeat(40),
		treeSha = 'b'.repeat(40),
		content = Buffer.from('Fictional Saturday source.\n');
	await fs.mkdir(join(source, prefix), { recursive: true });
	await fs.mkdir(stage);
	await fs.writeFile(join(source, prefix, 'README.md'), content);
	await promisify(execFile)('tar', ['-czf', archive, '-C', source, prefix]);
	const tree = {
		truncated: false,
		tree: [
			{
				path: 'README.md',
				type: 'blob',
				mode: '100644',
				sha: createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
			}
		]
	};
	t.mock.method(globalThis, 'fetch', async (url) => {
		if (url === `https://api.github.com/repos/kennysantanu/saturday/commits/${commit}`)
			return Response.json({ sha: commit, commit: { tree: { sha: treeSha } } });
		if (
			url === `https://api.github.com/repos/kennysantanu/saturday/git/trees/${treeSha}?recursive=1`
		)
			return Response.json(tree);
		assert.equal(url, `https://codeload.github.com/kennysantanu/saturday/tar.gz/${commit}`);
		return new Response(await fs.readFile(archive));
	});
	const result = await downloadSource(stage, commit);
	assert.equal(result.commit, commit);
	assert.equal(result.source, join(stage, 'source', prefix));
	assert.deepEqual(await fs.readFile(join(result.source, 'README.md')), content);
	assert.equal(globalThis.fetch.mock.callCount(), 3);
});
