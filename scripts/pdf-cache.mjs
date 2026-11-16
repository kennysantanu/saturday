// Recovery for an interrupted managed Chrome download, confined to the installation's PDF cache.
import * as fs from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

// Cache layout: <cache>/chrome/<platform>-<version>/<subdir>/…/<executable>
// The per-platform subdirectory and executable names are the only layout assumptions; no Puppeteer
// internal API is used, so this stays stable across Puppeteer versions.
const VERSION_DIRECTORY = /^[a-z0-9_]+-\d+(\.\d+)*$/i;
const EXECUTABLES = new Set(['chrome', 'chrome.exe', 'Google Chrome for Testing']);
const MAX_DEPTH = 8;

/** Result of inspecting one version directory. Throws only when the filesystem itself cannot be read. */
async function executablePresent(directory, depth = 0) {
	if (depth > MAX_DEPTH) return false;
	const entries = await fs.readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = join(directory, entry.name);
		if (entry.isFile() || entry.isSymbolicLink()) {
			if (!EXECUTABLES.has(entry.name)) continue;
			// A symlinked executable counts only when it resolves to something present.
			try {
				await fs.stat(entryPath);
				return true;
			} catch {
				continue;
			}
		}
		if (entry.isDirectory() && (await executablePresent(entryPath, depth + 1))) return true;
	}
	return false;
}

/**
 * Lists Chrome version directories under the cache that exist without their executable.
 * Returns the resolved chrome root alongside the entries, so callers compare against the value
 * resolved here rather than resolving again (which could be redirected).
 */
export async function scanIncompleteChrome(cache) {
	if (!cache) return { root: null, entries: [] };
	// Resolve the cache once. Confinement is then measured against the cache's real location, so a
	// symlinked cache still works while removal can never escape where it actually points.
	let base;
	try {
		base = await fs.realpath(resolve(cache));
	} catch (e) {
		if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { root: null, entries: [] };
		throw new Error(
			`The Chrome cache at ${cache} could not be inspected (${e.code || e.message}). Check permissions and retry.`
		);
	}
	const root = join(base, 'chrome');
	let entries;
	try {
		const stat = await fs.lstat(root);
		// A symlinked chrome directory is not inspected, so removal stays inside the cache.
		if (!stat.isDirectory()) return { root: null, entries: [] };
		entries = await fs.readdir(root, { withFileTypes: true });
	} catch (e) {
		if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { root: null, entries: [] };
		// An unreadable cache must not be mistaken for a damaged one.
		throw new Error(
			`The Chrome cache at ${root} could not be inspected (${e.code || e.message}). Check permissions and retry.`
		);
	}
	const found = [];
	for (const entry of entries) {
		// Symlinks and stray files are never followed or removed.
		if (!entry.isDirectory() || !VERSION_DIRECTORY.test(entry.name)) continue;
		const path = join(root, entry.name);
		// Confinement is checked against the resolved path, not the lexical one, so a replaced
		// parent symlink cannot redirect removal outside the cache.
		let resolved;
		try {
			resolved = await fs.realpath(path);
		} catch {
			continue;
		}
		if (resolved !== join(root, entry.name)) continue;
		if (!resolved.startsWith(root + sep)) continue;
		let present;
		try {
			present = await executablePresent(path);
		} catch (e) {
			// Inspection failure is not permission to delete.
			throw new Error(
				`The Chrome cache entry at ${path} could not be inspected (${e.code || e.message}). Check permissions and retry.`
			);
		}
		if (!present) found.push(path);
	}
	return { root, entries: found };
}

/** Convenience wrapper returning only the entries. */
export async function incompleteChromeDirectories(cache) {
	return (await scanIncompleteChrome(cache)).entries;
}

/** Removes incomplete Chrome version directories; complete versions are left untouched. */
/**
 * Moves an incomplete version directory aside with a single atomic rename.
 *
 * Nothing is deleted. A recursive delete cannot be made race-free in portable Node: `opendir`
 * exposes no handle-relative unlink, so every step re-resolves a pathname and a directory swapped
 * for a symlink after the check can redirect it. Renaming once, into a quarantine name under the
 * same parent, cannot remove anything outside the cache and frees the path Puppeteer needs.
 */
async function quarantine(directory, chromeRoot) {
	// Compare the parent against the root resolved during discovery. Re-resolving the root here would
	// let a replaced ancestor move both sides together and pass the check.
	const parent = await fs.realpath(join(directory, '..'));
	if (parent !== chromeRoot)
		throw new Error(`The cache location changed during recovery (${parent}).`);
	const name = directory.slice(directory.lastIndexOf(sep) + 1);
	const target = join(parent, `${name}.incomplete-${process.pid}-${Date.now()}`);
	await fs.rename(join(parent, name), target);
	return target;
}

/**
 * Moves aside the given entries, re-checking each one immediately before the rename.
 *
 * Exported so a test can exercise the window between discovery and action: a version that finishes
 * downloading in that window must be kept, not quarantined.
 */
export async function quarantineIncomplete(cache, entries, chromeRoot = null) {
	const quarantined = [];
	if (!chromeRoot) {
		chromeRoot = (await scanIncompleteChrome(cache)).root;
		if (!chromeRoot) return quarantined;
	}
	for (const path of entries) {
		try {
			// Re-verify immediately before the rename, and require the entry to still be incomplete.
			const stat = await fs.lstat(path);
			if (!stat.isDirectory()) continue;
			if (await executablePresent(path)) continue;
			quarantined.push(await quarantine(path, chromeRoot));
		} catch (e) {
			if (e.code === 'ENOENT') continue;
			throw new Error(
				`The incomplete Chrome download at ${path} could not be moved aside (${e.code || e.message}). Check permissions on the PDF cache and retry.`
			);
		}
	}
	return quarantined;
}

export async function removeIncompleteChrome(cache) {
	const { root, entries } = await scanIncompleteChrome(cache);
	return quarantineIncomplete(cache, entries, root);
}
