import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Shared by Vite and esbuild; production artifacts never need Git at runtime.
export function readBuildInfo(root = fileURLToPath(new URL('../', import.meta.url))) {
	if (process.env.SATURDAY_BUILD_ID) {
		if (!/^local\.[a-f0-9]{12}$/.test(process.env.SATURDAY_BUILD_ID))
			throw new Error('Invalid local build identity.');
		return { id: process.env.SATURDAY_BUILD_ID, commit: null, dirty: true };
	}
	if (process.env.SATURDAY_BUILD_COMMIT) {
		const commit = process.env.SATURDAY_BUILD_COMMIT;
		if (!/^[a-f0-9]{40}$/.test(commit))
			throw new Error('SATURDAY_BUILD_COMMIT must be a full commit SHA.');
		const dirty = process.env.SATURDAY_BUILD_DIRTY === '1';
		return { id: `dev.${commit.slice(0, 12)}${dirty ? '.dirty' : ''}`, commit, dirty };
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
