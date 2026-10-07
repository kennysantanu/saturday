import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import {
	filePaths,
	fs,
	withFileLock,
	commitManifest,
	validateManifest,
	atomicJson
} from '../src/lib/server/files/store.js';
import {
	createFileBackup,
	listFileBackups,
	getFileBackup,
	importFileBackup,
	prepareFileRestore,
	restoreFiles,
	extractArchive,
	getFileBackupSettings,
	setFileBackupSettings
} from '../src/lib/server/files/backups.js';
import {
	createBackupPair,
	prepareBackupPairRestore,
	restoreBackupPair,
	recoverBackupPair
} from '../src/lib/server/files/pairs.js';
const [command, ...args] = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
try {
	let result;
	switch (command) {
		case 'backup':
			result = await createFileBackup();
			break;
		case 'list':
			result = await listFileBackups();
			break;
		case 'import':
			result = await importFileBackup(createReadStream(resolve(args[0])));
			break;
		case 'export': {
			const b = await getFileBackup(args[0]);
			await pipeline(
				createReadStream(b.path),
				createWriteStream(resolve(args[1]), { flags: 'wx', mode: 0o600 })
			);
			result = { exported: true };
			break;
		}
		case 'prepare':
			result = await prepareFileRestore({
				backup_id: args[0],
				mode: args.includes('--replace') ? 'replace' : 'add'
			});
			break;
		case 'restore':
			result = await restoreFiles({ restore_id: args[0], confirm: args.includes('--confirm') });
			break;
		case 'pair':
			result = await createBackupPair();
			break;
		case 'prepare-pair':
			result = await prepareBackupPairRestore({ file_backup_id: args[0] });
			break;
		case 'restore-pair':
			result = await restoreBackupPair({
				restore_id: args[0],
				confirm: args.includes('--confirm')
			});
			break;
		case 'recover-pair':
			if (!args.includes('--confirm'))
				throw new Error('Stop web/MCP/worker and pass --confirm to recover the interrupted pair.');
			result = await recoverBackupPair();
			break;
		case 'schedule':
			result =
				args[0] === 'set'
					? await setFileBackupSettings({
							...(args.includes('--enabled') ? { enabled: value('--enabled') === 'true' } : {}),
							...(args.includes('--interval-hours')
								? { interval_hours: Number(value('--interval-hours')) }
								: {}),
							...(args.includes('--keep') ? { keep_count: Number(value('--keep')) } : {})
						})
					: await getFileBackupSettings();
			break;
		case 'recover': {
			if (!args.includes('--confirm'))
				throw new Error('Stop all Saturday processes, then pass a ZIP path and --confirm.');
			const p = filePaths();
			await fs.mkdir(p.state, { recursive: true, mode: 0o700 });
			const { stage, manifest } = await extractArchive(resolve(args[0]));
			try {
				result = await withFileLock(
					async () => {
						try {
							const current = JSON.parse(await fs.readFile(join(p.root, 'manifest.json'), 'utf8'));
							if (current.format_version > 1)
								throw new Error('Update Saturday instead of replacing a newer file store.');
						} catch (e) {
							if (e.message?.startsWith('Update')) throw e;
						}
						const original = `${p.root}.recovery-${randomUUID()}`;
						// Full copy is verified by fs.cp completion; never remove the original until a replacement is ready.
						await fs.cp(p.root, original, { recursive: true, errorOnExist: true, force: false });
						const replacement = `${p.root}.replacement-${randomUUID()}`;
						await fs.cp(stage, replacement, { recursive: true, errorOnExist: true, force: false });
						manifest.token = randomUUID();
						for (const d of manifest.documents) d.token = randomUUID();
						validateManifest(manifest);
						await atomicJson(join(replacement, 'manifest.json'), manifest);
						const displaced = `${p.root}.damaged-${randomUUID()}`;
						await fs.rename(p.root, displaced);
						try {
							await fs.rename(replacement, p.root);
						} catch (e) {
							await fs.rename(displaced, p.root);
							throw e;
						}
						return { recovered: true, original, displaced };
					},
					{ initialize: false }
				);
			} finally {
				await fs.rm(stage, { recursive: true, force: true });
			}
			break;
		}
		default:
			throw new Error(
				'Usage: npm run files -- backup|list|import <zip>|export <id> <path>|prepare <id> [--replace]|restore <preview> --confirm|pair|prepare-pair <file-id>|restore-pair <preview> --confirm|schedule show|schedule set --enabled true --interval-hours 24 --keep 10|recover <zip> --confirm|recover-pair --confirm'
			);
	}
	console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (e) {
	console.error(
		JSON.stringify({ ok: false, error: { code: e.code ?? 'ERROR', message: e.message } })
	);
	process.exitCode = 1;
}
