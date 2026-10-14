import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Shared by Vite and esbuild; production artifacts never need Git at runtime.
export function readBuildInfo(root = fileURLToPath(new URL('../', import.meta.url))) {
	if (process.env.SATURDAY_BUILD_COMMIT) {
		const commit = process.env.SATURDAY_BUILD_COMMIT;
		if (!/^[a-f0-9]{40}$/.test(commit))
			throw new Error('SATURDAY_BUILD_COMMIT must be a full commit SHA.');
		return { id: `dev.${commit.slice(0, 12)}`, commit, dirty: false };
	}
	try {
		const git = (args) =>
			execFileSync('git', args, {
				cwd: root,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore']
			}).trim();
		const commit = git(['rev-parse', '--verify', 'HEAD']);
		const dirty = git(['status', '--porcelain', '--untracked-files=normal']) !== '';
		return { id: `dev.${commit.slice(0, 12)}${dirty ? '.dirty' : ''}`, commit, dirty };
	} catch {
		// Source archives and machines without Git still build successfully.
		return { id: 'development', commit: null, dirty: null };
	}
}
