import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import {
	importBackup,
	prepareRestore,
	restoreBackup,
	getBackupFile,
	publicBackupError
} from '../src/lib/server/backups.js';
const jsonOutput = process.argv.includes('--json');
try {
	const { values, positionals } = parseArgs({
		options: {
			inspect: { type: 'boolean' },
			json: { type: 'boolean' },
			confirm: { type: 'boolean' },
			'restore-id': { type: 'string' }
		},
		allowPositionals: true
	});
	let result;
	if (values.inspect && !values.confirm && !values['restore-id'] && positionals.length === 1) {
		result = prepareRestore(importBackup(resolve(positionals[0])).backup_id);
	} else if (values['restore-id'] && values.confirm && !values.inspect && !positionals.length) {
		result = restoreBackup(values['restore-id'], true);
		result = { ...result, recovery_path: getBackupFile(result.recovery_backup_id).path };
	} else
		throw new TypeError(
			'Preview: restore <file> --inspect. Commit: restore --restore-id <id> --confirm. Add --json for agents.'
		);
	console.log(
		jsonOutput ? JSON.stringify({ ok: true, ...result }) : JSON.stringify(result, null, 2)
	);
} catch (error) {
	const usage = error instanceof TypeError || String(error.code).startsWith('ERR_PARSE_ARGS');
	const result = usage
		? { code: 'invalid_arguments', message: error.message }
		: publicBackupError(error);
	if (jsonOutput) console.log(JSON.stringify({ ok: false, error: result }));
	else console.error(result.message);
	process.exitCode = usage ? 2 : 1;
}
