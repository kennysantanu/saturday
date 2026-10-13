import {
	extensionCatalog,
	extensionPaths,
	setExtensionsEnabled,
	extensionError
} from '$lib/server/extensions.js';
import {
	getFileBackup,
	listFileBackups,
	prepareFileRestore,
	restoreFiles
} from '$lib/server/files/backups.js';
import { storageSummary } from '$lib/server/files/documents.js';
import { filePaths } from '$lib/server/files/store.js';
import { pdfReadiness } from '$lib/server/files/pdf.js';
import {
	createManualBackup,
	listBackupHistory,
	deleteManualBackup,
	prepareBackupPairRestore,
	restoreBackupPair
} from '$lib/server/files/pairs.js';
import { fail, redirect } from '@sveltejs/kit';
import {
	createBackup,
	getBackupPaths,
	getBackupFile,
	importBackupBytes,
	prepareRestore,
	restoreBackup,
	publicBackupError,
	MAX_BACKUP_BYTES,
	BackupError
} from '$lib/server/backups.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDatabasePath, getProjectRoot, openDatabase } from '$lib/server/database.js';
import { buildInfo, storageCompatibility } from '$lib/server/compatibility.js';

export async function load({ setHeaders, url }) {
	setHeaders({ 'x-saturday-build': buildInfo.id });
	let filesError = null,
		fileSummary = null,
		fileBackups = [];
	try {
		fileSummary = await storageSummary();
		fileBackups = (await listFileBackups()).backups;
	} catch (e) {
		filesError = e.code ? e.message : 'File store unavailable.';
	}
	let extensionsEnabled = false,
		extensionsError = null;
	try {
		extensionsEnabled = (await extensionCatalog()).extensions_enabled;
	} catch (e) {
		extensionsError = extensionError(e).message;
	}
	const databasePath = getDatabasePath();
	const nodePath = process.execPath;
	const mcpPath = join(getProjectRoot(), 'build', 'mcp', 'index.js');
	const config = {
		mcpServers: {
			saturday: {
				command: nodePath,
				args: [mcpPath],
				env: {
					SATURDAY_DB_PATH: databasePath,
					SATURDAY_FILES_PATH: filePaths().root,
					SATURDAY_EXTENSION_STATE_PATH: extensionPaths().state,
					SATURDAY_EXTENSIONS_PATH: extensionPaths().code
				}
			}
		}
	};
	const requestedPage = Number(url.searchParams.get('backup_page') ?? 1);
	let backupPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
	let history = await listBackupHistory({ offset: (backupPage - 1) * 50 });
	const backupPages = Math.max(1, Math.ceil(history.total / 50));
	if (backupPage > backupPages) {
		backupPage = backupPages;
		history = await listBackupHistory({ offset: (backupPage - 1) * 50 });
	}
	const backupHistory = history.backups;
	const db = openDatabase({ migrate: false });
	let diagnostics;
	try {
		diagnostics = {
			databaseVersion: db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
				.version,
			databaseFormat: db.prepare('SELECT format FROM app_metadata WHERE id=1').get().format,
			manifestVersion: fileSummary?.format_version ?? null,
			manifestFormat: fileSummary?.format ?? null,
			databasePaths: getBackupPaths(),
			filePaths: filePaths()
		};
	} finally {
		db.close();
	}
	return {
		extensionsEnabled,
		extensionsError,
		diagnostics,
		backupHistory,
		backupPage,
		backupPages,
		backupTotal: history.total,
		buildInfo,
		storageCompatibility,
		databasePath,
		filesError,
		fileSummary,
		fileBackups,
		pdfStatus: await pdfReadiness(),
		mcpPath,
		mcpReady: existsSync(mcpPath),
		configuration: JSON.stringify(config, null, 2)
	};
}

function actionFailure(error) {
	const detail =
		error.code && !(error instanceof BackupError)
			? { code: error.code, message: error.message }
			: publicBackupError(error);
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
	extensions: async ({ request }) => {
		try {
			const v = await request.formData();
			await setExtensionsEnabled(v.get('enabled') === 'on');
		} catch (e) {
			return fail(400, { extensionError: extensionError(e).message });
		}
		redirect(303, '/settings?saved=extension');
	},
	backup: async ({ request }) => {
		try {
			const values = await request.formData();
			const contents = values.get('contents') ?? 'all';
			if (!['all', 'database', 'files'].includes(String(contents)))
				return fail(400, {
					backupError: 'Choose database and files, database only, or files only.'
				});
			await createManualBackup({ contents: String(contents) });
		} catch (error) {
			return actionFailure(error);
		}
		redirect(303, '/settings?saved=backup');
	},
	filePairPrepare: async ({ request }) => {
		try {
			const v = await request.formData();
			return {
				filePairPreview: await prepareBackupPairRestore({
					file_backup_id: String(v.get('file_backup_id'))
				})
			};
		} catch (e) {
			return fail(400, { fileError: e.code ? e.message : 'Coordinated preview failed.' });
		}
	},
	filePairRestore: async ({ request }) => {
		try {
			const v = await request.formData();
			await restoreBackupPair({
				restore_id: String(v.get('restore_id')),
				confirm: v.get('confirm') === 'true'
			});
		} catch (e) {
			return fail(400, {
				fileError: e.code
					? e.message
					: 'Coordinated restore failed. Inspect recovery state before retrying.'
			});
		}
		redirect(303, '/settings?saved=restored');
	},
	fileBackup: async () => {
		try {
			await createManualBackup({ contents: 'files' });
		} catch (e) {
			return fail(400, { fileError: e.code ? e.message : 'File backup failed. Check disk space.' });
		}
		redirect(303, '/settings?saved=file-backup');
	},
	filePrepare: async ({ request }) => {
		try {
			const v = await request.formData();
			return {
				filePreview: await prepareFileRestore({
					backup_id: String(v.get('backup_id')),
					mode: String(v.get('mode'))
				})
			};
		} catch (e) {
			return fail(400, { fileError: e.code ? e.message : 'File restore preview failed.' });
		}
	},
	fileRestore: async ({ request }) => {
		try {
			const v = await request.formData();
			await restoreFiles({
				restore_id: String(v.get('restore_id')),
				confirm: v.get('confirm') === 'true'
			});
		} catch (e) {
			return fail(400, {
				fileError: e.code
					? e.message
					: 'File restore failed. Inspect recovery state before retrying.'
			});
		}
		redirect(303, '/settings?saved=restored');
	},
	download: () => {
		let backup;
		try {
			backup = createBackup();
		} catch (error) {
			return actionFailure(error);
		}
		redirect(303, `/settings/backups/${backup.backup_id}`);
	},
	deleteBackup: async ({ request }) => {
		try {
			const values = await request.formData();
			await deleteManualBackup({
				backup_id: String(values.get('backup_id')),
				contents: String(values.get('contents')),
				confirm: values.get('confirm') === 'true'
			});
		} catch (e) {
			return actionFailure(e);
		}
		redirect(303, '/settings?saved=backup-deleted');
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
			if (backupId.startsWith('all:')) {
				const database = getBackupFile(backupId.slice(4)).metadata;
				const fileId =
					database.file_backup_id ??
					(await listFileBackups({ limit: 100 })).backups.find(
						(b) => b.database_backup_id === database.backup_id
					)?.backup_id;
				if (!fileId)
					return fail(400, {
						backupError:
							'The file artifact is unavailable. Download its database archive and import it separately.'
					});
				return {
					filePairPreview: await prepareBackupPairRestore({
						file_backup_id: fileId
					})
				};
			}
			if (backupId.startsWith('files:'))
				return {
					filePreview: await prepareFileRestore({ backup_id: backupId.slice(6), mode: 'replace' })
				};
			if (backupId.startsWith('database:')) backupId = backupId.slice(9);
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
