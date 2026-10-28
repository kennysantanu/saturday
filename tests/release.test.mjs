import test from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdtempSync,
	copyFileSync,
	writeFileSync,
	readFileSync,
	rmSync,
	mkdirSync,
	symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateRelease, checkRelease } from '../scripts/release.mjs';
import { selectTarget } from '../src/lib/server/installation-operations.js';
function fixture() {
	const base = mkdtempSync(join(tmpdir(), 'saturday-release-')),
		root = join(base, 'source');
	mkdirSync(root);
	for (const file of ['package.json', 'package-lock.json']) copyFileSync(file, join(root, file));
	writeFileSync(join(root, 'README.md'), '# Fictional release fixture\n');
	const git = (...args) =>
		execFileSync('git', ['-C', root, ...args], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		}).trim();
	git('init', '--quiet');
	const commit = () => {
		git('add', '.');
		git(
			'-c',
			'user.name=Saturday fixture',
			'-c',
			'user.email=fixture@example.invalid',
			'commit',
			'--quiet',
			'-m',
			'Fictional release'
		);
		return git('rev-parse', 'HEAD');
	};
	const sha = commit();
	return {
		base,
		root,
		git,
		commit,
		options: {
			root,
			commit: sha,
			verifiedCommit: sha,
			tag: 'v0.1.0',
			output: join(base, 'saturday-release.json')
		},
		close: () => rmSync(base, { recursive: true, force: true })
	};
}
test('verified clean candidate generates matching metadata accepted by existing release discovery', async () => {
	const f = fixture();
	try {
		const generated = generateRelease(f.options);
		assert.equal(generated.metadata.release, '0.1.0');
		assert.equal(generated.metadata.commit, f.options.commit);
		assert.equal(checkRelease({ ...f.options, metadata: generated.path }).digest, generated.digest);
		const release = {
			tag_name: 'v0.1.0',
			id: 1,
			assets: [
				{ name: 'saturday-release.json', state: 'uploaded', id: 2, digest: generated.digest }
			]
		};
		const selected = await selectTarget(
			{},
			async (path) => (path.startsWith('/releases') ? [release] : { sha: f.options.commit }),
			async () => new Response(readFileSync(generated.path))
		);
		assert.equal(selected.release, '0.1.0');
		assert.equal(selected.commit, f.options.commit);
		await assert.rejects(
			selectTarget(
				{},
				async (path) => (path.startsWith('/releases') ? [release] : { sha: 'b'.repeat(40) }),
				async () => new Response(readFileSync(generated.path))
			),
			/tag does not match/
		);
		await assert.rejects(
			selectTarget(
				{},
				async () => [release],
				async () => new Response('tampered')
			),
			/integrity/
		);
		assert.throws(() => generateRelease(f.options), /EEXIST/);
	} finally {
		f.close();
	}
});
test('release generation refuses dirty/unverified revisions, wrong tags and source-tree output', () => {
	const f = fixture();
	try {
		assert.throws(() => generateRelease({ ...f.options, commit: 'b'.repeat(40) }), /HEAD/);
		assert.throws(
			() => generateRelease({ ...f.options, verifiedCommit: undefined }),
			/verification/
		);
		assert.throws(() => generateRelease({ ...f.options, tag: 'v0.2.0' }), /metadata/);
		assert.throws(() => generateRelease({ ...f.options, tag: 'v0.1.0-beta' }), /stable/);
		assert.throws(
			() => generateRelease({ ...f.options, output: join(f.root, 'asset.json') }),
			/outside/
		);
		assert.throws(
			() => generateRelease({ ...f.options, output: join(f.root, '..asset.json') }),
			/outside/
		);
		symlinkSync(f.root, join(f.base, 'linked-source'));
		assert.throws(
			() => generateRelease({ ...f.options, output: join(f.base, 'linked-source', 'asset.json') }),
			/outside/
		);
		writeFileSync(join(f.root, 'README.md'), 'dirty');
		assert.throws(() => generateRelease(f.options), /clean/);
		writeFileSync(join(f.root, 'README.md'), '# Fictional release fixture\n');
		writeFileSync(join(f.root, 'untracked'), 'dirty');
		assert.throws(() => generateRelease(f.options), /clean/);
	} finally {
		f.close();
	}
});
test('package/lock/storage/API mismatches and altered metadata reject before publication', () => {
	const f = fixture();
	try {
		const result = generateRelease(f.options);
		const edited = { ...result.metadata, access_api: 2 };
		writeFileSync(result.path, JSON.stringify(edited));
		assert.throws(() => checkRelease({ ...f.options, metadata: result.path }), /does not match/);
		const original = readFileSync(join(f.root, 'package.json'), 'utf8');
		for (const [mutate, pattern] of [
			[
				(pkg) => {
					pkg.version = '0.2.0';
				},
				/lockfile/
			],
			[
				(pkg) => {
					pkg.saturday.storage.database.currentVersion = 2;
				},
				/storage declarations/
			],
			[
				(pkg) => {
					pkg.saturday.storage.manifest.minimumVersion = 0;
				},
				/storage declarations/
			],
			[
				(pkg) => {
					pkg.saturday.lan_api = 2;
				},
				/access\/LAN/
			],
			[
				(pkg) => {
					pkg.saturday.installation_api = 2;
				},
				/compatible/
			]
		]) {
			const pkg = JSON.parse(original);
			mutate(pkg);
			writeFileSync(join(f.root, 'package.json'), JSON.stringify(pkg));
			const sha = f.commit();
			assert.throws(
				() => generateRelease({ ...f.options, commit: sha, verifiedCommit: sha }),
				pattern
			);
		}
	} finally {
		f.close();
	}
});
