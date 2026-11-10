import { existsSync } from 'node:fs';
import { canonicalProtectedRoots, assertDisjointFromProtectedRoots } from './test-isolation.mjs';

// A read-only host view prevents ancestor renames and creation of missing personal
// roots. Existing roots are hidden by an empty, unreadable read-only mount.
export function linuxSandboxCommand({
	project,
	scratch,
	hidden,
	roots,
	fixtures = [],
	command,
	exists = existsSync
}) {
	assertDisjointFromProtectedRoots(project, roots);
	assertDisjointFromProtectedRoots(scratch, roots);
	const args = [
		'--die-with-parent',
		'--new-session',
		'--unshare-user',
		'--unshare-pid',
		'--unshare-ipc',
		'--unshare-uts',
		'--cap-drop',
		'ALL',
		'--ro-bind',
		'/',
		'/',
		'--proc',
		'/proc',
		'--dev',
		'/dev',
		'--bind',
		project,
		project,
		'--bind',
		scratch,
		scratch
	];
	for (const root of canonicalProtectedRoots([...roots, ...fixtures])) {
		if (exists(root)) args.push('--ro-bind', hidden, root);
	}
	args.push('--chdir', project, '--', ...command);
	return ['bwrap', ...args];
}
