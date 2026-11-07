import {
	getNavigationSettings,
	setNavigationSettings,
	clearRecentViews,
	getBackupMetadata,
	listTags,
	listWorkflowStages,
	addWorkflowStage,
	renameWorkflowStage,
	setWorkflowStageClosed,
	reorderWorkflowStage,
	archiveWorkflowStage,
	restoreWorkflowStage,
	listFileBackups,
	prepareFileRestore,
	restoreFiles,
	storageSummary,
	pdfReadiness,
	createManualBackup,
	listBackupHistory,
	deleteManualBackup,
	prepareBackupPairRestore,
	restoreBackupPair,
	createBackup,
	importBackupBytes,
	prepareRestore,
	restoreBackup
} from '$lib/server/application.js';
import { localPlatform, localCapabilities } from '$lib/server/platform.js';
const {
	checkUpdates,
	installedCheck,
	operationStatus,
	queueOperation,
	serverSummary,
	controlServer,
	loginStartupStatus,
	setLoginStartup,
	setExtensionsEnabled
} = localPlatform;
import { ServiceError, ValidationError } from '$lib/server/validation.js';
import { ownedRemovalTargets } from '$lib/server/installation-operations.js';
import {
	accessForm,
	accessCookieName,
	localBrowser,
	sameOrigin,
	readAccessSettings,
	updateAccessSettings,
	parseIdleHours,
	AccessError
} from '$lib/server/access-settings.js';
import {
	authState,
	loginCookie,
	logout,
	checkPassword,
	passwordHash
} from '$lib/server/access-auth.js';
import { withAccessChange } from '$lib/server/access-admin.js';
import { validServerSession, networkSummary } from '$lib/server/server-lifecycle.js';
import { assistantConfiguration, getInstallation } from '$lib/server/installation.js';
import { extensionPaths, extensionError } from '$lib/server/extensions.js';
import { fail, redirect } from '@sveltejs/kit';
import { publicBackupError, MAX_BACKUP_BYTES, BackupError } from '$lib/server/backups.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDatabasePath, getProjectRoot } from '$lib/server/database.js';
import { applicationVersion, buildInfo, storageCompatibility } from '$lib/server/compatibility.js';
export async function load(event) {
	const { setHeaders, url } = event;
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
		extensionsEnabled = (await localPlatform.extensionCatalog()).extensions_enabled;
	} catch (e) {
		extensionsError = extensionError(e).message;
	}
	let server;
	try {
		server = {
			...serverSummary(),
			controlsAvailable: Boolean(process.env.SATURDAY_SERVER_TOKEN) && localBrowser(event)
		};
	} catch (e) {
		server = { managed: false, status: 'unavailable', controlsAvailable: false, error: e.message };
	}
	const databasePath = getDatabasePath();
	const installation = getInstallation();
	const nodePath = installation.node_path;
	const mcpPath = join(getProjectRoot(), 'build', 'mcp', 'index.js');
	const config = assistantConfiguration(installation);
	const requestedPage = Number(url.searchParams.get('backup_page') ?? 1);
	let backupPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
	let history = await listBackupHistory({ offset: (backupPage - 1) * 50 });
	const backupPages = Math.max(1, Math.ceil(history.total / 50));
	if (backupPage > backupPages) {
		backupPage = backupPages;
		history = await listBackupHistory({ offset: (backupPage - 1) * 50 });
	}
	const backupHistory = history.backups;
	const diagnostics = localPlatform.storageDiagnostics(fileSummary);
	let installationOperation = null,
		updateCheck = null,
		installationError = null,
		deleteDataPaths = [],
		deletionUnavailable = null;
	try {
		installationOperation = operationStatus();
		updateCheck = installedCheck();
		deleteDataPaths = ownedRemovalTargets(installation, true);
	} catch (e) {
		deletionUnavailable = e.message;
	}
	let workflowStages = [],
		workflowError = null;
	let navigationSettings = null;
	try {
		navigationSettings = await getNavigationSettings();
	} catch {
		// Keep diagnostics and recovery available when storage cannot be opened normally.
	}
	try {
		workflowStages = await listWorkflowStages();
	} catch {
		workflowError =
			'Workflow is unavailable. Repair storage before editing stages; diagnostics and recovery remain available.';
	}
	return {
		navigationSettings,
		tagCollections: workflowError
			? null
			: {
					job: await listTags({ collection: 'job' }),
					person: await listTags({ collection: 'person' })
				},
		access: event.locals.access,
		workflowStages,
		workflowError,
		network: networkSummary(readAccessSettings(), Number(url.port || 80)),
		installationOperation,
		updateCheck,
		installationError,
		deleteDataPaths,
		deletionUnavailable,
		extensionsEnabled,
		extensionsError,
		diagnostics,
		installation,
		server,
		loginStartup: await loginStartupStatus(),
		folderSupported: ['darwin', 'win32', 'linux'].includes(process.platform),
		backupHistory,
		backupPage,
		backupPages,
		backupTotal: history.total,
		buildInfo,
		applicationVersion,
		storageCompatibility,
		databasePath,
		filesError,
		fileSummary,
		capabilities: localCapabilities,
		fileBackups,
		pdfStatus: await pdfReadiness(),
		mcpPath,
		mcpReady: existsSync(mcpPath),
		configuration: config.json,
		configurationToml: config.toml
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
function installationAuthorized(event) {
	const { request, cookies, url } = event;
	return (
		request.headers.get('origin') === url.origin &&
		localBrowser(event) &&
		validServerSession(cookies.get(accessCookieName('control')))
	);
}
export const actions = {
	navigation: async (event) => {
		if (!sameOrigin(event))
			return fail(403, {
				navigationError: 'Use Saturday’s own page to change navigation settings.'
			});
		try {
			const form = await event.request.formData();
			if (form.get('kind') === 'clear') {
				await clearRecentViews();
				return { navigationMessage: 'Recently viewed cleared.' };
			}
			await setNavigationSettings({
				enabled: form.get('enabled') === '1',
				limit: Number(form.get('limit'))
			});
			return { navigationMessage: 'Navigation settings saved.' };
		} catch (e) {
			return fail(400, {
				navigationError:
					e instanceof ValidationError
						? 'Choose 5, 10, or 20 items per list.'
						: 'Navigation settings could not be saved. Try again.'
			});
		}
	},
	workflow: async (event) => {
		if (!sameOrigin(event))
			return fail(403, { workflowError: 'Use this Saturday browser to save workflow changes.' });
		const values = Object.fromEntries(
			Array.from((await event.request.formData()).entries(), ([key, value]) => [
				key,
				typeof value === 'string' ? value : ''
			])
		);
		const options = { confirm_starting_stage: values.confirm_starting_stage === '1' };
		try {
			switch (values.kind) {
				case 'add':
					await addWorkflowStage({ name: values.name, is_closed: values.is_closed === '1' });
					break;
				case 'rename':
					await renameWorkflowStage(values.stage_id, values.name);
					break;
				case 'closure':
					await setWorkflowStageClosed(values.stage_id, values.is_closed === '1', options);
					break;
				case 'reorder':
					await reorderWorkflowStage(values.stage_id, values.direction, options);
					break;
				case 'archive':
					await archiveWorkflowStage(values.stage_id, options);
					break;
				case 'restore':
					await restoreWorkflowStage(values.stage_id);
					break;
				default:
					throw new ServiceError('Choose an available workflow action.');
			}
			return { workflowSaved: true };
		} catch (error) {
			if (error instanceof ServiceError && error.code === 'starting_stage_confirmation')
				return fail(400, { workflowConfirm: values, workflowValues: values });
			if (error instanceof ValidationError)
				return fail(400, {
					workflowError: 'Check the workflow fields.',
					workflowErrors: error.fieldErrors,
					workflowValues: values
				});
			if (error instanceof ServiceError)
				return fail(400, { workflowError: error.message, workflowValues: values });
			console.error('Workflow setting could not be saved:', error);
			return fail(500, {
				workflowError: 'Workflow could not be saved. Try again.',
				workflowValues: values
			});
		}
	},
	lan: async (event) => {
		if (!localBrowser(event) || !sameOrigin(event))
			return fail(403, {
				lanError: 'Change LAN access from the Saturday shortcut on the server computer.'
			});
		try {
			const values = await accessForm(event.request);
			const enable = values.get('operation') === 'enable';
			if (!['enable', 'disable'].includes(String(values.get('operation'))))
				throw new AccessError('Choose Allow LAN access or Disable LAN access.');
			if (enable && values.get('confirm') !== 'true')
				throw new AccessError('Confirm allowing reachable network devices.');
			await withAccessChange(() =>
				updateAccessSettings((current) => ({ ...current, allow_lan: enable }))
			);
			return { lanSaved: true };
		} catch (e) {
			return fail(e.status ?? 503, {
				lanError: e.status
					? e.message
					: 'LAN access could not be saved. Check local settings and try again.'
			});
		}
	},
	password: async (event) => {
		if (!sameOrigin(event) || !localBrowser(event))
			return fail(403, {
				accessError: 'Change sign-in settings from the computer’s local browser.'
			});
		try {
			const values = await accessForm(event.request);
			await withAccessChange(async () => {
				const before = readAccessSettings(),
					operation = values.get('operation');
				if (!['enable', 'change', 'disable', 'timeout'].includes(String(operation)))
					throw new AccessError('Choose a valid sign-in setting.');
				if ((operation === 'enable') === Boolean(before.password))
					throw new AccessError(
						'The sign-in setting changed. Refresh Settings and try again.',
						409
					);
				if (
					['change', 'disable'].includes(String(operation)) &&
					!(await checkPassword(values.get('current_password'), event.getClientAddress(), before))
				)
					throw new AccessError('Incorrect current password.');
				if (operation === 'disable' && values.get('confirm') !== 'true')
					throw new AccessError('Confirm disabling password login.');
				let verifier = before.password;
				if (operation === 'enable' || operation === 'change') {
					if (values.get('password') !== values.get('confirm_password'))
						throw new AccessError('The new passwords do not match.');
					verifier = await passwordHash(values.get('password'));
				} else if (operation === 'disable') verifier = null;
				const next = await updateAccessSettings((current) => {
					if (JSON.stringify(current) !== JSON.stringify(before))
						throw new AccessError('The sign-in setting changed. Refresh and try again.', 409);
					return {
						...current,
						password: verifier,
						idle_timeout_seconds:
							operation === 'timeout'
								? parseIdleHours(values.get('hours'), values.get('no_expiration') === 'on')
								: current.idle_timeout_seconds
					};
				});
				authState(next);
				if (operation === 'enable' || operation === 'change') loginCookie(event, next);
				if (operation === 'disable') logout(event, true);
			});
		} catch (e) {
			return fail(e.status ?? 503, {
				accessError: e.status ? e.message : 'Sign-in settings could not be saved.'
			});
		}
		redirect(303, '/settings?saved=access#password');
	},
	logout: async (event) => {
		if (!sameOrigin(event)) return fail(403, { accessError: 'Log out from this Saturday page.' });
		const values = await accessForm(event.request);
		const all = values.get('all') === 'true';
		if (all && values.get('confirm') !== 'true')
			return fail(400, { accessError: 'Confirm logging out all devices.' });
		logout(event, all);
		redirect(303, '/signin');
	},
	checkUpdates: async (event) => {
		if (!installationAuthorized(event))
			return fail(403, { installationError: 'Use this installation’s local browser session.' });
		try {
			await checkUpdates();
			return { updatesChecked: true };
		} catch (e) {
			return fail(409, { installationError: e.message });
		}
	},
	installationOperation: async (event) => {
		if (!installationAuthorized(event))
			return fail(403, { installationError: 'Use this installation’s local browser session.' });
		try {
			const values = await event.request.formData(),
				operation = String(values.get('operation')),
				deleteData = values.get('delete_data') === 'on';
			if (deleteData && values.get('confirmation') !== 'DELETE DATA')
				throw new Error('Type DELETE DATA to confirm permanent deletion.');
			const result = await queueOperation(operation, {
				check_id: String(values.get('check_id') || ''),
				confirm: values.get('confirm') === 'true',
				delete_data: deleteData,
				retry_pdf: operation === 'repair'
			});
			return { installationOperation: result };
		} catch (e) {
			return fail(409, { installationError: e.message });
		}
	},
	loginStartup: async (event) => {
		const { request } = event;
		if (!installationAuthorized(event))
			return fail(403, {
				loginError: 'Startup controls require this installation’s local browser session.'
			});
		try {
			const values = await request.formData();
			const result = await setLoginStartup(values.get('enabled') === 'on');
			if (!result.available) throw new Error(result.error);
			return { loginSaved: true };
		} catch (e) {
			return fail(409, { loginError: e.message });
		}
	},
	serverControl: async (event) => {
		const { request, setHeaders } = event;
		if (!installationAuthorized(event))
			return fail(403, {
				serverError: 'Server controls require this installation’s local browser session.'
			});
		try {
			const values = await request.formData();
			const operation = String(values.get('operation'));
			if (operation === 'stop' && values.get('confirm') !== 'true')
				throw new Error('Confirm stopping the UI server.');
			const result = await controlServer(operation, { defer: true });
			setHeaders({ 'x-saturday-server-operation': result.generation });
			return { serverOperation: result };
		} catch (e) {
			return fail(409, { serverError: e.message });
		}
	},
	openFolder: async (event) => {
		if (!localBrowser(event) || !sameOrigin(event))
			return fail(403, { storageError: 'Open folders from this computer’s local browser.' });
		try {
			await localPlatform.openDataFolder();
			return { folderOpened: true };
		} catch (e) {
			return fail(400, { storageError: e.message });
		}
	},
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
	download: async () => {
		let backup;
		try {
			backup = await createBackup();
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
				backupId = (await importBackupBytes(new Uint8Array(await file.arrayBuffer()))).backup_id;
			}
			if (typeof backupId !== 'string' || !backupId)
				return fail(400, { backupError: 'Choose a backup file or a saved backup.' });
			if (backupId.startsWith('all:')) {
				const database = await getBackupMetadata(backupId.slice(4));
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
			return { preview: await prepareRestore(backupId) };
		} catch (error) {
			return actionFailure(error);
		}
	},
	restore: async ({ request }) => {
		let result;
		try {
			const values = await request.formData();
			result = await restoreBackup(
				String(values.get('restore_id') ?? ''),
				values.get('confirm') === 'true'
			);
		} catch (error) {
			return actionFailure(error);
		}
		redirect(303, `/settings?recovery=${result.recovery_backup_id}&saved=restored`);
	}
};
