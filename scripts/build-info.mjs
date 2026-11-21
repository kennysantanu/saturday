import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function parseDirtyEnv(raw) {
	if (raw === undefined || raw === '') return null;
	if (raw === '1') return true;
	if (raw === '0') return false;
	throw Object.assign(new Error('Invalid captured build dirty state.'), {
		code: 'BUILD_IDENTITY'
	});
}

function readGitIdentity(root) {
	try {
		const git = (args) =>
			execFileSync('git', args, {
				cwd: root,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore']
			}).trim();
		const top = git(['rev-parse', '--show-toplevel']);
		if (!top || realpathSync(top) !== realpathSync(root)) return { commit: null, dirty: null };
		const commit = git(['rev-parse', '--verify', 'HEAD']);
		if (!/^[a-f0-9]{40}$/.test(commit)) return { commit: null, dirty: null };
		const dirty = git(['status', '--porcelain', '--untracked-files=normal']) !== '';
		return { commit, dirty };
	} catch {
		return { commit: null, dirty: null };
	}
}

// Shared by Vite and esbuild; production artifacts never need Git at runtime.
export function readBuildInfo(root = fileURLToPath(new URL('../', import.meta.url))) {
	const rawCommit = process.env.SATURDAY_BUILD_COMMIT;
	const rawId = process.env.SATURDAY_BUILD_ID;
	const explicitDirty = parseDirtyEnv(process.env.SATURDAY_BUILD_DIRTY);
	let explicitCommit = null;
	if (rawCommit) {
		if (!/^[a-f0-9]{40}$/.test(rawCommit))
			throw new Error('SATURDAY_BUILD_COMMIT must be a full commit SHA.');
		explicitCommit = rawCommit;
	}
	if (rawId) {
		if (!/^local\.[a-f0-9]{12}$/.test(rawId)) throw new Error('Invalid local build identity.');
		if (explicitCommit && explicitDirty !== null) {
			return { id: rawId, commit: explicitCommit, dirty: explicitDirty };
		}
		if (!explicitCommit && explicitDirty === null) {
			const git = readGitIdentity(root);
			return { id: rawId, commit: git.commit, dirty: git.dirty };
		}
		return { id: rawId, commit: null, dirty: null };
	}
	if (explicitCommit) {
		const dirty = explicitDirty === true;
		return {
			id: `dev.${explicitCommit.slice(0, 12)}${dirty ? '.dirty' : ''}`,
			commit: explicitCommit,
			dirty
		};
	}
	const git = readGitIdentity(root);
	if (git.commit) {
		return {
			id: `dev.${git.commit.slice(0, 12)}${git.dirty ? '.dirty' : ''}`,
			commit: git.commit,
			dirty: git.dirty
		};
	}
	// Source archives and machines without Git still build successfully.
	return { id: 'development', commit: null, dirty: null };
}
