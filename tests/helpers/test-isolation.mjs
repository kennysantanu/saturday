import { realpathSync } from 'node:fs';
import {
	basename,
	dirname,
	join,
	resolve,
	relative,
	isAbsolute,
	sep,
	posix,
	win32
} from 'node:path';
import { userInfo } from 'node:os';

// Use the account home, not HOME: installer tests intentionally replace HOME.
export function personalMacRoot(home = userInfo().homedir) {
	return join(home, 'Library', 'Application Support', 'Saturday');
}

export function personalInstallationRoots(
	platform = process.platform,
	home = userInfo().homedir,
	env = process.env
) {
	if (platform === 'darwin')
		return [posix.join(home, 'Library', 'Application Support', 'Saturday')];
	if (platform === 'win32')
		return [
			...new Set([
				win32.join(home, 'Saturday'),
				win32.join(home, 'AppData', 'Local', 'Saturday'),
				...(env.LOCALAPPDATA && win32.isAbsolute(env.LOCALAPPDATA)
					? [win32.join(env.LOCALAPPDATA, 'Saturday')]
					: [])
			])
		];
	if (platform === 'linux')
		return [
			...new Set([
				posix.join(home, '.local', 'share', 'saturday'),
				...(env.XDG_DATA_HOME && posix.isAbsolute(env.XDG_DATA_HOME)
					? [posix.join(env.XDG_DATA_HOME, 'saturday')]
					: [])
			])
		];
	throw new Error(`No test filesystem protection is configured for ${platform}.`);
}

function resolvedPath(path) {
	try {
		return realpathSync.native(path);
	} catch (error) {
		if (error.code !== 'ENOENT') throw error;
		const parent = dirname(path);
		if (parent === path) throw error;
		return join(resolvedPath(parent), basename(path));
	}
}

function within(root, candidate) {
	const difference = relative(root, candidate);
	return (
		!difference ||
		(difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference))
	);
}

export function assertOutsideProtectedRoots(path, roots) {
	for (const candidate of canonicalProtectedRoots([path]))
		for (const root of canonicalProtectedRoots(roots))
			if (within(root, candidate))
				throw new Error('Test workspace must be outside the personal Saturday installation.');
}

export function assertDisjointFromProtectedRoots(path, roots) {
	for (const candidate of canonicalProtectedRoots([path]))
		for (const root of canonicalProtectedRoots(roots))
			if (within(root, candidate) || within(candidate, root))
				throw new Error(
					'Writable test paths must be outside personal installations and their ancestors.'
				);
}

export function canonicalProtectedRoots(roots) {
	return [...new Set(roots.flatMap((path) => [resolve(path), resolvedPath(resolve(path))]))];
}

export function macSandboxProfile(roots) {
	const protectedPaths = canonicalProtectedRoots(roots);
	const ancestors = new Set();
	for (const path of protectedPaths) {
		for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent))
			ancestors.add(parent);
	}
	return [
		'(version 1)',
		'(allow default)',
		...Array.from(
			protectedPaths,
			(path) => `(deny file-read* file-write* (subpath ${JSON.stringify(path)}))`
		),
		// Prevent renaming/removing an ancestor to move the protected installation.
		...Array.from(ancestors, (path) => `(deny file-write* (literal ${JSON.stringify(path)}))`)
	].join('\n');
}

export function isolatedEnvironment(inherited, root, project) {
	const env = Object.fromEntries(
		Object.entries(inherited).filter(
			([key]) => !key.startsWith('SATURDAY_') && !['NODE_OPTIONS', 'NODE_PATH'].includes(key)
		)
	);
	return {
		...env,
		SATURDAY_PROJECT_ROOT: project,
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(root, 'data', 'saturday.db'),
		SATURDAY_FILES_PATH: join(root, 'data', 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'data', 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(root, 'extensions'),
		SATURDAY_INSTALL_ROOT: join(root, 'installation')
	};
}
