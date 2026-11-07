import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { resolve, join, relative, dirname, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { compareVersions } from '../src/lib/distribution.js';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Metadata may already have been checked out with CRLF before fixture attributes
// were added. Normalize only its line endings; payload hashes stay byte-exact.
const fixtureMetadataDigest = (path) => digest(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'));
const lockName = 'release-baselines.json';
const rootFiles = [
	'package.json',
	'package-lock.json',
	'README.md',
	'.npmrc',
	'.gitattributes',
	'install.sh',
	'install.bat',
	'vite.config.ts',
	'tsconfig.json'
];

// Installed archives have no Git metadata. Keep the same deterministic scope there.
// Generated registrations and user-installed extensions are build outputs, not release source.
export function releaseSourceFiles(root = defaultRoot) {
	const files = [];
	function walk(path) {
		if (!existsSync(path)) throw new Error(`Missing release source: ${path}`);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) throw new Error('Release source cannot contain symbolic links.');
		if (stat.isDirectory()) {
			for (const name of readdirSync(path).sort()) {
				if (
					name === '.DS_Store' ||
					name === 'Thumbs.db' ||
					name.endsWith('extensions.generated.js')
				)
					continue;
				walk(join(path, name));
			}
		} else if (stat.isFile()) files.push(relative(root, path).split(sep).join('/'));
	}
	const configFiles = readdirSync(root).filter(
		(name) => name !== lockName && /\.(?:[cm]?js|ts|json|sh|bat)$/.test(name)
	);
	for (const path of [
		...new Set([...rootFiles, ...configFiles]),
		'src',
		'scripts',
		'static',
		'docs',
		'examples'
	])
		walk(join(root, path));
	return files.sort();
}
export function releaseSourceHash(root = defaultRoot) {
	const hash = createHash('sha256');
	for (const path of releaseSourceFiles(root)) {
		let bytes = readFileSync(join(root, path));
		if (path === 'package.json' || path === 'package-lock.json')
			bytes = Buffer.from(JSON.stringify(JSON.parse(bytes.toString('utf8'))));
		else if (
			path === '.npmrc' ||
			path === '.gitattributes' ||
			/\.(?:[cm]?js|ts|svelte|json|css|html|md|svg|sh|bat|txt|yml|yaml|sql)$/.test(path)
		)
			bytes = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
		hash.update(path + '\0' + bytes.length + '\0');
		hash.update(bytes);
	}
	return hash.digest('hex');
}
function implementation(root) {
	const migrations = pathToFileURL(join(root, 'src/lib/server/migrations.js')).href;
	const compatibility = pathToFileURL(join(root, 'src/lib/server/compatibility.js')).href;
	// A fresh process avoids module caching when checking a changed source workspace.
	const code = `import {migrationChecksums,databaseSchemaChecksum} from ${JSON.stringify(migrations)}; import {storageCompatibility} from ${JSON.stringify(compatibility)}; console.log(JSON.stringify({migrations:migrationChecksums(),database_schema_sha256:databaseSchemaChecksum(),storage:{database:storageCompatibility.database,manifest:storageCompatibility.manifest}}));`;
	try {
		return JSON.parse(
			execFileSync(process.execPath, ['--input-type=module', '-e', code], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe']
			})
		);
	} catch (error) {
		throw new Error(`Release storage check failed: ${error.stderr?.toString() || error.message}`);
	}
}
export function checkReleasePolicy(root = defaultRoot, { requireFrozen = false } = {}) {
	root = resolve(root);
	const pkg = json(join(root, 'package.json'));
	const lock = json(join(root, 'package-lock.json'));
	if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version)
		throw new Error(
			'Package and lockfile versions disagree. Use npm version --no-git-tag-version.'
		);
	compareVersions(pkg.version, '0.1.0');
	const baselines = json(join(root, lockName));
	if (
		baselines.format !== 'saturday.release-baselines' ||
		baselines.version !== 1 ||
		!Array.isArray(baselines.releases)
	)
		throw new Error('Invalid release baseline lock.');
	let previous;
	for (const release of baselines.releases) {
		if (previous && compareVersions(release.version, previous.version) <= 0)
			throw new Error('Release baselines must be appended in increasing version order.');
		if (!/^[a-f0-9]{64}$/.test(release.source_sha256))
			throw new Error('Invalid frozen source hash.');
		if (fixtureMetadataDigest(join(root, release.fixture.path)) !== release.fixture.sha256)
			throw new Error('A released storage fixture was changed. Restore its original bytes.');
		const fixture = json(join(root, release.fixture.path));
		for (const [path, expected] of Object.entries(fixture.hashes))
			if (digest(readFileSync(join(root, dirname(release.fixture.path), path))) !== expected)
				throw new Error(`Released fixture artifact changed: ${path}`);
		previous = release;
	}
	const current = implementation(root);
	if (!isDeepStrictEqual(pkg.saturday.storage, current.storage))
		throw new Error(
			'Package storage versions disagree with migrations/file format. Update both declarations.'
		);
	if (previous && compareVersions(pkg.version, previous.version) < 0)
		throw new Error('The app version cannot be older than its released baseline.');
	const frozen = previous?.version === pkg.version;
	if (frozen && releaseSourceHash(root) !== previous.source_sha256)
		throw new Error(
			`Released app ${pkg.version} has changed. Bump the app version (for example: npm version patch --no-git-tag-version). Never rewrite a released baseline.`
		);
	if (requireFrozen && !frozen)
		throw new Error('Freeze this app version before preparing release metadata.');
	return { version: pkg.version, frozen, ...current };
}
export function freezeRelease(root = defaultRoot, fixturePath) {
	root = resolve(root);
	const current = checkReleasePolicy(root);
	const baselines = json(join(root, lockName));
	if (current.frozen)
		throw new Error('This release is already frozen. Bump the app version for any shipped change.');
	fixturePath ??= baselines.releases.at(-1)?.fixture.path;
	if (!fixturePath || isAbsolute(fixturePath) || fixturePath.split(/[/\\]/).includes('..'))
		throw new Error('Choose a repository-relative frozen fixture expected.json.');
	const fixture = json(join(root, fixturePath));
	if (!isDeepStrictEqual(fixture.storage, current.storage))
		throw new Error('Freeze a populated fixture matching the new storage versions first.');
	baselines.releases.push({
		version: current.version,
		source_sha256: releaseSourceHash(root),
		storage: current.storage,
		migrations: current.migrations,
		database_schema_sha256: current.database_schema_sha256,
		fixture: {
			path: fixturePath.split(sep).join('/'),
			sha256: fixtureMetadataDigest(join(root, fixturePath))
		}
	});
	writeFileSync(join(root, lockName), JSON.stringify(baselines, null, '\t') + '\n');
	return checkReleasePolicy(root, { requireFrozen: true });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { values } = parseArgs({
			options: { freeze: { type: 'boolean' }, fixture: { type: 'string' } }
		});
		const result = values.freeze
			? freezeRelease(defaultRoot, values.fixture)
			: checkReleasePolicy();
		console.log(
			`Release policy passed: app ${result.version}${result.frozen ? ' (frozen)' : ' (development)'}, database ${result.storage.database.currentVersion}, files ${result.storage.manifest.version}.`
		);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
