import { createReadStream } from 'node:fs';
import { installExtension, uninstallExtension } from './extension-install.mjs';
import {
	extensionCatalog,
	extensionStatus,
	setExtensionState,
	createExtensionBackup,
	listExtensionBackups,
	importExtensionBackup,
	prepareExtensionRestore,
	restoreExtension,
	recoverExtensions,
	extensionError
} from '../src/lib/server/extensions.js';
import { getProjectRoot } from '../src/lib/server/database.js';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
async function registry() {
	try {
		return (
			await import(pathToFileURL(join(getProjectRoot(), 'build', 'mcp', 'extensions.js')).href)
		).extensionRegistry;
	} catch (e) {
		if (e.code === 'ERR_MODULE_NOT_FOUND') return {};
		throw e;
	}
}
const [command, value, ...args] = process.argv.slice(2);
const option = (name) => {
	const i = args.indexOf(name);
	return i < 0 ? undefined : args[i + 1];
};
try {
	let result;
	switch (command) {
		case 'install':
		case 'update':
			if (!value) throw Error('Provide a local folder or Git URL.');
			const installed = (await extensionCatalog()).installed.find((e) => e.id === value);
			result = await installExtension(
				command === 'update' && installed ? installed.source.reference : value,
				{
					trust: args.includes('--trust'),
					ref: option('--ref'),
					update: command === 'update'
				}
			);
			break;
		case 'uninstall':
			result = await uninstallExtension(value);
			break;
		case 'list':
			result = await extensionStatus(await registry());
			break;
		case 'enable':
		case 'disable':
			result = await setExtensionState(value, command === 'enable');
			break;
		case 'backup':
			result = await createExtensionBackup(value);
			break;
		case 'backups':
			result = await listExtensionBackups();
			break;
		case 'import':
			result = await importExtensionBackup(createReadStream(value));
			break;
		case 'preview':
			result = await prepareExtensionRestore(value, args[0], await registry());
			break;
		case 'restore':
			result = await restoreExtension(
				{ restore_id: value, confirm: args.includes('--confirm') },
				await registry()
			);
			break;
		case 'recover':
			result = await recoverExtensions();
			break;
		default:
			throw Error(
				'Usage: npm run extension -- install|update <source> --trust [--ref <commit>] | list | enable|disable|uninstall|backup <id> | backups | import <zip> | preview <id> <backup-id> | restore <preview-id> --confirm | recover'
			);
	}
	console.log(JSON.stringify(result, null, 2));
} catch (e) {
	console.error(e.code ? extensionError(e).message : e.message);
	process.exitCode = 1;
}
