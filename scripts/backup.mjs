import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import {
	createBackup,
	exportBackup,
	getBackupFile,
	getBackupSettings,
	setBackupSettings,
	publicBackupError
} from '../src/lib/server/backups.js';
let jsonOutput = process.argv.includes('--json');
try {
	const { values, positionals } = parseArgs({
		options: {
			output: { type: 'string' },
			json: { type: 'boolean' },
			enabled: { type: 'string' },
			contents: { type: 'string' },
			'interval-hours': { type: 'string' },
			keep: { type: 'string' }
		},
		allowPositionals: true
	});
	let result;
	if (positionals[0] === 'schedule') {
		if (values.output || positionals.length !== 2)
			throw new TypeError('Use backup schedule show or backup schedule set.');
		if (positionals[1] === 'show') {
			if (
				values.enabled !== undefined ||
				values.contents !== undefined ||
				values['interval-hours'] !== undefined ||
				values.keep !== undefined
			)
				throw new TypeError('show does not accept settings.');
			result = getBackupSettings();
		} else if (positionals[1] === 'set') {
			const input = {};
			if (values.contents !== undefined) input.contents = values.contents;
			if (values.enabled !== undefined) {
				if (!['true', 'false'].includes(values.enabled))
					throw new TypeError('--enabled must be true or false.');
				input.enabled = values.enabled === 'true';
			}
			if (values['interval-hours'] !== undefined)
				input.interval_hours = Number(values['interval-hours']);
			if (values.keep !== undefined) input.keep_count = Number(values.keep);
			result = setBackupSettings(input);
		} else throw new TypeError('Use backup schedule show or backup schedule set.');
	} else {
		if (
			positionals.length ||
			values.enabled !== undefined ||
			values.contents !== undefined ||
			values.keep !== undefined ||
			values['interval-hours'] !== undefined
		)
			throw new TypeError('Use backup [--output <new-file>] [--json].');
		result = createBackup();
		result = {
			...result,
			path: values.output
				? exportBackup(result.backup_id, resolve(values.output))
				: getBackupFile(result.backup_id).path
		};
	}
	console.log(
		jsonOutput ? JSON.stringify({ ok: true, ...result }) : JSON.stringify(result, null, 2)
	);
} catch (error) {
	const usage =
		error instanceof TypeError ||
		String(error.code).startsWith('ERR_PARSE_ARGS') ||
		error.code === 'invalid_request';
	const result = usage
		? { code: 'invalid_arguments', message: error.message }
		: publicBackupError(error);
	if (jsonOutput) console.log(JSON.stringify({ ok: false, error: result }));
	else console.error(result.message);
	process.exitCode = usage ? 2 : 1;
}
