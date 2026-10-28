import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { validateRelease } from '../src/lib/distribution.js';
import { storageCompatibility } from '../src/lib/server/compatibility.js';

function candidate({ root, commit, verifiedCommit, tag }) {
	root = resolve(root);
	const git = (...args) =>
		execFileSync('git', args, {
			cwd: root,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		}).trim();
	if (!/^[a-f0-9]{40}$/.test(commit ?? '') || commit !== git('rev-parse', '--verify', 'HEAD'))
		throw new Error('Choose the exact full committed HEAD revision.');
	if (git('status', '--porcelain', '--untracked-files=normal'))
		throw new Error('Release source must be clean, including untracked files.');
	if (verifiedCommit !== commit)
		throw new Error('Explicitly confirm verification of this exact commit with --verified-commit.');
	const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
	const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
	if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version)
		throw new Error('Package and lockfile versions disagree.');
	if (pkg.saturday?.access_api !== 1 || pkg.saturday?.lan_api !== 1)
		throw new Error('Invalid access/LAN compatibility declarations.');
	if (
		!isDeepStrictEqual(pkg.saturday?.storage, {
			database: storageCompatibility.database,
			manifest: storageCompatibility.manifest
		})
	)
		throw new Error('Package storage declarations disagree with the implementation.');
	if (pkg.engines?.node !== `>=${pkg.saturday.node_minimum}`)
		throw new Error('Package runtime requirement disagrees with release metadata.');
	const metadata = {
		...pkg.saturday,
		format: 'saturday.release',
		version: 1,
		release: pkg.version,
		commit,
		source: { type: 'github-source' }
	};
	validateRelease(metadata, { tag_name: tag });
	return metadata;
}
export function generateRelease(options) {
	const metadata = candidate(options);
	const output = resolve(realpathSync(dirname(resolve(options.output))), basename(options.output)),
		root = realpathSync(options.root),
		inside = relative(root, output);
	if (!inside || (!(inside === '..' || inside.startsWith('..' + sep)) && !isAbsolute(inside)))
		throw new Error('Generate the release asset outside the source tree.');
	const bytes = JSON.stringify(metadata, null, 2) + '\n';
	writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
	return {
		metadata,
		path: output,
		digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`
	};
}
export function checkRelease(options) {
	const expected = candidate(options),
		bytes = readFileSync(options.metadata);
	if (bytes.length > 1024 * 1024) throw new Error('Release asset is too large.');
	const metadata = validateRelease(JSON.parse(bytes), { tag_name: options.tag });
	if (!isDeepStrictEqual(metadata, expected))
		throw new Error('Release metadata does not match the candidate package/source.');
	return { metadata, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const [action, ...args] = process.argv.slice(2),
			options = { root: fileURLToPath(new URL('../', import.meta.url)) };
		const names = {
			'--root': 'root',
			'--commit': 'commit',
			'--verified-commit': 'verifiedCommit',
			'--tag': 'tag',
			'--output': 'output',
			'--metadata': 'metadata'
		};
		for (let i = 0; i < args.length; i += 2) {
			if (!names[args[i]] || !args[i + 1])
				throw new Error(
					'Use generate/check with --commit, --verified-commit, --tag and --output/--metadata.'
				);
			options[names[args[i]]] = args[i + 1];
		}
		if (!['generate', 'check'].includes(action)) throw new Error('Choose generate or check.');
		console.log(
			JSON.stringify(
				action === 'generate' ? generateRelease(options) : checkRelease(options),
				null,
				2
			)
		);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
