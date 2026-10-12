import { generateExtensions } from './extension-build.mjs';
// Offline installer: prepare and build before a journaled publication. No extension npm scripts.
import * as fs from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import {
	extensionPaths,
	extensionCatalog,
	inspectExtension,
	validateExtensionNamespaces,
	extensionId,
	withExtensionLock,
	assertExtensionProcessesStopped,
	assertExtensionRecoveryClear,
	initializeExtension,
	dataPath,
	recoverExtensions,
	rejectExtension,
	syncExtensionPath
} from '../src/lib/server/extensions.js';
import { atomicJson } from '../src/lib/server/files/store.js';
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function installExtension(
	source,
	{ trust = false, ref, update = false, build = productionBuild, applicationRoot = root } = {}
) {
	if (!trust)
		rejectExtension(
			'TRUST',
			'Extension code has full access to Saturday. Inspect it first, then pass --trust.'
		);
	return withExtensionLock(async () => {
		await assertExtensionProcessesStopped();
		await assertExtensionRecoveryClear();
		const paths = extensionPaths(),
			work = await fs.mkdtemp(join(paths.state, 'install-'));
		let journaled = false;
		try {
			const snapshot = join(work, 'package');
			let provenance;
			if (/^(https:\/\/|ssh:\/\/|file:\/\/|git@)/.test(source)) {
				if (source.startsWith('https:') && (new URL(source).username || new URL(source).password))
					rejectExtension('VALIDATION', 'Use a repository URL without embedded credentials.');
				if (source.startsWith('ssh:') && new URL(source).password)
					rejectExtension('VALIDATION', 'Repository URLs cannot contain passwords.');
				await exec('git', ['clone', '--no-checkout', '--', source, snapshot], { timeout: 120000 });
				const commit = (
					await exec('git', ['-C', snapshot, 'rev-parse', '--verify', `${ref ?? 'HEAD'}^{commit}`])
				).stdout.trim();
				await exec('git', [
					'-C',
					snapshot,
					'-c',
					'core.hooksPath=/dev/null',
					'checkout',
					'--detach',
					commit
				]);
				provenance = { type: 'git', reference: source, commit };
			} else {
				const info = await inspectExtension(resolve(source));
				await fs.mkdir(snapshot);
				for (const f of info.files) {
					const target = join(snapshot, f.path);
					await fs.mkdir(dirname(target), { recursive: true });
					await fs.writeFile(target, f.bytes);
				}
				provenance = { type: 'local', reference: resolve(source) };
			}
			const info = await inspectExtension(snapshot),
				id = info.manifest.id;
			await fs.rm(join(snapshot, '.git'), { recursive: true, force: true });
			const catalog = await extensionCatalog(),
				existing = catalog.installed.find((e) => e.id === id);
			if (Boolean(existing) !== update)
				rejectExtension(
					'CONFLICT',
					existing ? 'Already installed. Use update.' : 'Not installed. Use install.'
				);
			const entry = {
				id,
				manifest: info.manifest,
				fingerprint: info.fingerprint,
				source: provenance,
				enabled: existing?.enabled ?? true,
				installed_at: existing?.installed_at ?? new Date().toISOString(),
				updated_at: new Date().toISOString()
			};
			const candidateRoot = join(work, 'host');
			await fs.mkdir(candidateRoot);
			await fs.cp(applicationRoot, candidateRoot, {
				recursive: true,
				filter: (p) =>
					p !== paths.state &&
					!p.startsWith(paths.state + '/') &&
					p !== paths.code &&
					!p.startsWith(paths.code + '/') &&
					!['node_modules', '.git', 'data', 'build', '.svelte-kit', 'extensions'].includes(
						p.slice(applicationRoot.length + 1).split('/')[0]
					)
			});
			await fs.symlink(
				join(applicationRoot, 'node_modules'),
				join(candidateRoot, 'node_modules'),
				'dir'
			);
			const candidateState = join(work, 'state'),
				candidateCode = join(candidateRoot, 'extensions');
			await fs.mkdir(candidateState);
			await fs.mkdir(candidateCode);
			for (const e of catalog.installed.filter((e) => e.id !== id))
				await fs.cp(join(paths.code, e.id), join(candidateCode, e.id), { recursive: true });
			await fs.cp(snapshot, join(candidateCode, id), { recursive: true });
			const next = {
				...catalog,
				installed: [...catalog.installed.filter((e) => e.id !== id), entry]
			};
			validateExtensionNamespaces(next.installed);
			await atomicJson(join(candidateState, 'catalog.json'), next);
			// Migration uses a snapshot, never the live extension database.
			const candidateDatabase = join(work, 'database.sqlite');
			if (info.manifest.database) {
				if (existing && !existing.manifest.database)
					rejectExtension(
						'COMPATIBILITY',
						'Changing database ownership requires a new extension ID.'
					);
				let retained = false;
				try {
					await fs.access(dataPath(id));
					retained = true;
				} catch (e) {
					if (e.code !== 'ENOENT') throw e;
				}
				if (retained) {
					const db = new DatabaseSync(dataPath(id), { readOnly: true });
					try {
						db.prepare('VACUUM INTO ?').run(candidateDatabase);
					} finally {
						db.close();
					}
				}
				await initializeExtension(
					entry,
					{
						server: () => import(pathToFileURL(join(candidateCode, id, info.manifest.server)).href)
					},
					{ path: candidateDatabase }
				);
			} else if (existing?.manifest.database)
				rejectExtension('COMPATIBILITY', 'An update cannot discard an existing database.');
			await build(candidateRoot, {
				SATURDAY_PROJECT_ROOT: candidateRoot,
				SATURDAY_EXTENSION_STATE_PATH: candidateState,
				SATURDAY_EXTENSIONS_PATH: candidateCode
			});
			// Save previous objects before publishing any live object. Retained on interruption.
			const replacements = [];
			async function replace(target, candidate) {
				const previous = join(work, `previous-${replacements.length}`);
				let saved = null;
				try {
					await fs.cp(target, previous, { recursive: true });
					await syncExtensionPath(previous);
					await syncExtensionPath(work, { recursive: false });
					saved = previous;
				} catch (e) {
					if (e.code !== 'ENOENT') throw e;
				}
				replacements.push({ target, previous: saved, candidate });
			}
			await replace(join(paths.code, id), snapshot);
			await replace(join(applicationRoot, 'build'), join(candidateRoot, 'build'));
			if (info.manifest.database) await replace(dataPath(id), candidateDatabase);
			await replace(join(paths.state, id, 'identity.json'), join(work, 'identity.json'));
			await atomicJson(join(work, 'identity.json'), entry);
			await replace(paths.catalog, join(candidateState, 'catalog.json'));
			await replace(join(applicationRoot, 'src', 'lib', 'extensions.generated.js'), null);
			await replace(join(applicationRoot, 'src', 'lib', 'server', 'extensions.generated.js'), null);
			await atomicJson(join(paths.state, 'recovery.json'), {
				version: 1,
				kind: 'install',
				replacements
			});
			journaled = true;
			for (const r of replacements) {
				if (!r.candidate) continue;
				await fs.mkdir(dirname(r.target), { recursive: true });
				const temp = `${r.target}.install-${randomUUID()}`;
				await fs.cp(r.candidate, temp, { recursive: true });
				await syncExtensionPath(temp);
				await fs.rm(r.target, { recursive: true, force: true });
				await fs.rename(temp, r.target);
				await syncExtensionPath(dirname(r.target), { recursive: false });
			}
			await generateExtensions(applicationRoot);
			await syncExtensionPath(join(applicationRoot, 'src', 'lib', 'extensions.generated.js'));
			await syncExtensionPath(
				join(applicationRoot, 'src', 'lib', 'server', 'extensions.generated.js')
			);
			await syncExtensionPath(join(applicationRoot, 'src', 'lib'), { recursive: false });
			await syncExtensionPath(join(applicationRoot, 'src', 'lib', 'server'), { recursive: false });
			await fs.rm(join(paths.state, 'recovery.json'));
			await syncExtensionPath(paths.state, { recursive: false });
			journaled = false;
			return entry;
		} catch (e) {
			if (journaled) {
				await recoverExtensions();
				journaled = false;
			}
			if (e.stdout || e.stderr) {
				const log = join(paths.state, 'last-install-error.log');
				await fs.writeFile(log, [e.message, e.stdout, e.stderr].filter(Boolean).join('\n'), {
					mode: 0o600
				});
				rejectExtension(
					'BUILD_FAILED',
					`Candidate build failed. Previous installation retained. See ${log}.`
				);
			}
			throw e;
		} finally {
			if (!journaled) await fs.rm(work, { recursive: true, force: true });
		}
	});
}
async function productionBuild(candidateRoot, env) {
	await exec(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
		cwd: candidateRoot,
		env: { ...process.env, ...env },
		maxBuffer: 32 * 1024 * 1024,
		timeout: 300000
	});
}
export async function uninstallExtension(id) {
	return withExtensionLock(async () => {
		await assertExtensionProcessesStopped();
		await assertExtensionRecoveryClear();
		extensionId(id);
		const paths = extensionPaths(),
			catalog = await extensionCatalog(),
			entry = catalog.installed.find((e) => e.id === id);
		if (!entry) rejectExtension('NOT_FOUND', 'Extension is not installed.');
		// Disable first; a failed removal leaves data retained and runtime unavailable.
		entry.enabled = false;
		entry.pending_remove = true;
		await atomicJson(paths.catalog, catalog);
		await atomicJson(join(paths.state, id, 'identity.json'), entry);
		await fs.rm(join(paths.code, id), { recursive: true, force: true });
		await atomicJson(paths.catalog, {
			...catalog,
			installed: catalog.installed.filter((e) => e.id !== id)
		});
		return { removed: true, id, data_retained: true, rebuild_required: true };
	});
}
