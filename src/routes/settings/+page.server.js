import { fail, redirect } from '@sveltejs/kit';
import {
	createBackup,
	listBackups,
	getBackupSettings,
	setBackupSettings,
	importBackupBytes,
	prepareRestore,
	restoreBackup,
	publicBackupError,
	MAX_BACKUP_BYTES,
	BackupError
} from '$lib/server/backups.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDatabasePath, getProjectRoot } from '$lib/server/database.js';

export function load() {
	const databasePath = getDatabasePath();
	const nodePath = process.execPath;
	const mcpPath = join(getProjectRoot(), 'build', 'mcp', 'index.js');
	const config = {
		mcpServers: {
			saturday: {
				command: nodePath,
				args: [mcpPath],
				env: { SATURDAY_DB_PATH: databasePath }
			}
		}
	};
	return {
		databasePath,
		mcpPath,
		mcpReady: existsSync(mcpPath),
		configuration: JSON.stringify(config, null, 2),
		backupSettings: getBackupSettings(),
		backups: listBackups({ limit: 50 }).backups
	};
}

function actionFailure(error) {
	const detail = publicBackupError(error);
	return fail(detail.code === 'backup_too_large' ? 413 : 400, { backupError: detail.message });
}
// Bound multipart buffering in development too; production also has BODY_SIZE_LIMIT.
async function boundedForm(request) {
	const max = MAX_BACKUP_BYTES + 1024 * 1024;
	const reader = request.body?.getReader();
	if (!reader) throw new Error('Missing body');
	const chunks = [];
	let bytes = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > max) {
				await reader.cancel();
				throw new BackupError('backup_too_large', 'Backups must be no larger than 100 MiB.');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return new Response(Buffer.concat(chunks), {
		headers: { 'content-type': request.headers.get('content-type') ?? '' }
	}).formData();
}
export const actions = {
	download: () => {
		let backup;
		try {
			backup = createBackup();
		} catch (error) {
			return actionFailure(error);
		}
		redirect(303, `/settings/backups/${backup.backup_id}`);
	},
	schedule: async ({ request }) => {
		try {
			const values = await request.formData();
			setBackupSettings({
				enabled: values.get('enabled') === 'on',
				interval_hours: Number(values.get('interval_hours')),
				keep_count: Number(values.get('keep_count'))
			});
		} catch (error) {
			return actionFailure(error);
		}
		redirect(303, '/settings?saved=backup-settings');
	},
	prepare: async ({ request }) => {
		try {
			const values = await boundedForm(request);
			let backupId = values.get('backup_id');
			const file = values.get('backup_file');
			if (file && typeof file !== 'string' && file.size) {
				if (file.size > MAX_BACKUP_BYTES)
					return fail(413, { backupError: 'Backups must be no larger than 100 MiB.' });
				backupId = importBackupBytes(new Uint8Array(await file.arrayBuffer())).backup_id;
			}
			if (typeof backupId !== 'string' || !backupId)
				return fail(400, { backupError: 'Choose a backup file or a saved backup.' });
			return { preview: prepareRestore(backupId) };
		} catch (error) {
			return actionFailure(error);
		}
	},
	restore: async ({ request }) => {
		let result;
		try {
			const values = await request.formData();
			result = restoreBackup(
				String(values.get('restore_id') ?? ''),
				values.get('confirm') === 'true'
			);
		} catch (error) {
			return actionFailure(error);
		}
		redirect(303, `/settings?recovery=${result.recovery_backup_id}&saved=restored`);
	}
};
