import test from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdtempSync,
	mkdirSync,
	copyFileSync,
	cpSync,
	readFileSync,
	writeFileSync,
	rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
	checkReleasePolicy,
	releaseSourceFiles,
	freezeRelease
} from '../scripts/check-release.mjs';

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'saturday-release-policy-'));
	for (const file of [...releaseSourceFiles(), 'release-baselines.json']) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		copyFileSync(file, join(root, file));
	}
	cpSync(
		'tests/fixtures/release-0.1.0-current',
		join(root, 'tests/fixtures/release-0.1.0-current'),
		{ recursive: true }
	);
	const edit = (path, update) =>
		writeFileSync(join(root, path), update(readFileSync(join(root, path), 'utf8')));
	const bump = (version) => {
		for (const file of ['package.json', 'package-lock.json'])
			edit(file, (text) => {
				const value = JSON.parse(text);
				value.version = version;
				if (value.packages?.['']) value.packages[''].version = version;
				return JSON.stringify(value);
			});
	};
	return { root, edit, bump, close: () => rmSync(root, { recursive: true, force: true }) };
}

test('0.1.0 is frozen at schema/file version 1; changed code requires an app bump and cannot refreeze the release', () => {
	const f = fixture();
	try {
		const current = checkReleasePolicy(f.root, { requireFrozen: true });
		assert.equal(current.version, '0.1.0');
		assert.equal(current.storage.database.currentVersion, 1);
		assert.equal(current.storage.manifest.version, 1);
		f.edit('src/lib/server/local/jobs.js', (text) => text + '\n// Fictional future code change.\n');
		assert.throws(() => checkReleasePolicy(f.root), /Bump the app version/);
		assert.throws(() => freezeRelease(f.root), /Bump the app version/);
		f.bump('0.1.1');
		assert.equal(checkReleasePolicy(f.root).frozen, false);
		assert.throws(
			() => checkReleasePolicy(f.root, { requireFrozen: true }),
			/Freeze this app version/
		);
		assert.equal(freezeRelease(f.root).frozen, true);
		f.edit(
			'src/lib/server/local/jobs.js',
			(text) => text + '\n// Another change after freezing.\n'
		);
		assert.throws(() => checkReleasePolicy(f.root), /Bump the app version/);
	} finally {
		f.close();
	}
});

test('released SQL cannot be changed, renamed or removed even after an app version bump', () => {
	for (const mutate of [
		(text) => text.replace('CREATE TABLE jobs (', 'CREATE TABLE jobs_rewritten ('),
		(text) => text.replace("name: 'create_initial_schema'", "name: 'renamed_initial_schema'"),
		(text) => text.replace('version: 1,', 'version: 2,'),
		(text) => text.replace('applied_at TEXT NOT NULL', 'applied_at TEXT NOT NULL, rewritten TEXT')
	]) {
		const f = fixture();
		try {
			f.bump('0.1.1');
			f.edit('src/lib/server/migrations.js', mutate);
			assert.throws(
				() => checkReleasePolicy(f.root),
				/Released migration|Released database schema|consecutive versions/
			);
		} finally {
			f.close();
		}
	}
});

test('new migrations require the next schema version, matching package metadata and an app bump', () => {
	const f = fixture();
	try {
		f.edit('src/lib/server/migrations.js', (text) =>
			text.replace(
				'\n];\n\nexport const schemaVersion',
				",\n{version:2,name:'fictional_index',sql:'CREATE INDEX fictional_upgrade ON jobs(company_name);'}\n];\n\nexport const schemaVersion"
			)
		);
		assert.throws(() => checkReleasePolicy(f.root), /storage versions disagree/);
		f.edit('package.json', (text) => {
			const pkg = JSON.parse(text);
			pkg.saturday.storage.database.currentVersion = 2;
			return JSON.stringify(pkg);
		});
		assert.throws(() => checkReleasePolicy(f.root), /Bump the app version/);
		f.bump('0.1.1');
		assert.equal(checkReleasePolicy(f.root).storage.database.currentVersion, 2);
		assert.throws(() => freezeRelease(f.root), /populated fixture matching/);
	} finally {
		f.close();
	}
});

test('version checks catch package/lock mismatches, changed fixtures and unsupported version suffixes', () => {
	const f = fixture();
	try {
		f.edit('package.json', (text) => text.replace('"version": "0.1.0"', '"version": "0.1.1"'));
		assert.throws(() => checkReleasePolicy(f.root), /lockfile versions disagree/);
		f.bump('0.1.0-beta');
		assert.throws(() => checkReleasePolicy(f.root), /stable release version/);
		f.bump('0.1.1');
		f.edit('tests/fixtures/release-0.1.0-current/expected.json', (text) => text + '\n');
		assert.throws(() => checkReleasePolicy(f.root), /storage fixture was changed/);
	} finally {
		f.close();
	}
});

test('Git CRLF checkouts and generated registrations do not require an app version bump', () => {
	const f = fixture();
	try {
		f.edit('src/lib/server/local/jobs.js', (text) => text.replaceAll('\n', '\r\n'));
		f.edit('tests/fixtures/release-0.1.0-current/expected.json', (text) =>
			text.replaceAll('\n', '\r\n')
		);
		writeFileSync(
			join(f.root, 'src/lib/server/extensions.generated.js'),
			'// Local build output\n'
		);
		assert.equal(checkReleasePolicy(f.root).frozen, true);
	} finally {
		f.close();
	}
});

test('an actual core.autocrlf=true Git checkout preserves all frozen artifact bytes and passes release checks', () => {
	const f = fixture();
	const git = (...args) =>
		execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	try {
		git('-C', f.root, 'init', '--quiet');
		git('-C', f.root, '-c', 'core.autocrlf=false', 'add', '.');
		git(
			'-C',
			f.root,
			'-c',
			'user.name=Saturday fixture',
			'-c',
			'user.email=fixture@example.invalid',
			'-c',
			'commit.gpgsign=false',
			'commit',
			'--quiet',
			'-m',
			'Fictional line-ending checkout'
		);
		const checkout = join(f.root, 'crlf-checkout');
		git('-c', 'core.autocrlf=true', 'clone', '--quiet', '--no-local', f.root, checkout);
		assert.ok(
			readFileSync(join(checkout, 'src/lib/server/local/jobs.js'), 'utf8').includes('\r\n')
		);
		assert.ok(readFileSync(join(checkout, '.npmrc'), 'utf8').includes('\r\n'));
		const expectedPath = 'tests/fixtures/release-0.1.0-current/expected.json';
		assert.deepEqual(
			readFileSync(join(checkout, expectedPath)),
			readFileSync(join(f.root, expectedPath))
		);
		const expected = JSON.parse(readFileSync(join(f.root, expectedPath)));
		for (const path of Object.keys(expected.hashes)) {
			const artifact = join(dirname(expectedPath), path);
			assert.deepEqual(
				readFileSync(join(checkout, artifact)),
				readFileSync(join(f.root, artifact)),
				artifact
			);
		}
		assert.equal(checkReleasePolicy(checkout, { requireFrozen: true }).frozen, true);
		assert.match(
			execFileSync(process.execPath, ['scripts/check-release.mjs'], {
				cwd: checkout,
				encoding: 'utf8'
			}),
			/app 0\.1\.0 \(frozen\)/
		);
		const document = join(
			checkout,
			'tests/fixtures/release-0.1.0-current/files/documents/fictional-cv.md'
		);
		writeFileSync(document, readFileSync(document, 'utf8').replaceAll('\n', '\r\n'));
		assert.throws(() => checkReleasePolicy(checkout), /Released fixture artifact changed/);
	} finally {
		f.close();
	}
});
