import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import {
	createManualBackup,
	listBackupHistory,
	deleteManualBackup,
	exportManualBackup,
	importBackupBundle
} from '../src/lib/server/files/pairs.js';
import { publicBackupError, getBackupFile } from '../src/lib/server/backups.js';
import { getFileBackup } from '../src/lib/server/files/backups.js';
const jsonOutput = process.argv.includes('--json');
try {
	const { values, positionals } = parseArgs({
		options: {
			output: { type: 'string' },
			json: { type: 'boolean' },
			contents: { type: 'string' },
			confirm: { type: 'boolean' },
			limit: { type: 'string' },
			offset: { type: 'string' }
		},
		allowPositionals: true
	});
	const [command = 'create', backup_id] = positionals;
	const contents = values.contents ?? 'database';
	const allowed = {
		create: ['output', 'contents'],
		list: ['limit', 'offset'],
		delete: ['contents', 'confirm'],
		export: ['contents', 'output'],
		import: []
	};
	if (
		!allowed[command] ||
		Object.keys(values).some((key) => key !== 'json' && !allowed[command].includes(key)) ||
		positionals.length > (['delete', 'export', 'import'].includes(command) ? 2 : 1) ||
		(['delete', 'export', 'import'].includes(command) && !backup_id)
	)
		throw new TypeError(
			'Invalid backup command or arguments. Use create/list/delete/export/import with the documented options.'
		);

	let result;
	switch (command) {
		case 'create': {
			if (positionals.length > 1) throw new TypeError('Unexpected backup arguments.');
			result = await createManualBackup({ contents });
			const id = result.database_backup_id ?? result.backup_id;
			if (values.output)
				result = {
					...result,
					...(await exportManualBackup({ backup_id: id, contents }, resolve(values.output)))
				};
			else
				result = {
					...result,
					path: contents === 'files' ? (await getFileBackup(id)).path : getBackupFile(id).path
				};
			break;
		}
		case 'list':
			result = await listBackupHistory({
				limit: values.limit === undefined ? 50 : Number(values.limit),
				offset: values.offset === undefined ? 0 : Number(values.offset)
			});
			break;
		case 'delete':
			result = await deleteManualBackup({ backup_id, contents, confirm: values.confirm === true });
			break;
		case 'export':
			if (!values.output) throw new TypeError('Specify --output <new-file>.');
			result = await exportManualBackup({ backup_id, contents }, resolve(values.output));
			break;
		case 'import':
			if (!backup_id) throw new TypeError('Specify the combined backup ZIP.');
			result = await importBackupBundle(createReadStream(resolve(backup_id)));
			break;
		default:
			throw new TypeError(
				'Use backup [create|list|delete <id> --confirm|export <id> --output <new-file>|import <combined.zip>] [--contents all|database|files] [--json].'
			);
	}
	console.log(JSON.stringify({ ok: true, ...result }, null, jsonOutput ? undefined : 2));
} catch (error) {
	const usage = error instanceof TypeError || String(error.code).startsWith('ERR_PARSE_ARGS');
	const detail = usage
		? { code: 'invalid_arguments', message: error.message }
		: error.code
			? { code: error.code, message: error.message }
			: publicBackupError(error);
	if (jsonOutput) console.log(JSON.stringify({ ok: false, error: detail }));
	else console.error(detail.message);
	process.exitCode = usage ? 2 : 1;
}
