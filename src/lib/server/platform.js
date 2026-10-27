import { capabilityNames, requireCapability } from '../application/capabilities.js';
import {
	checkUpdates,
	queueOperation,
	operationStatus,
	installedCheck
} from './installation-operations.js';
import { loginStartupStatus, setLoginStartup, getInstallation } from './installation.js';
import { controlServer, serverSummary } from './server-lifecycle.js';
import { extensionStatus, setExtensionsEnabled, extensionCatalog } from './extensions.js';
import { openDatabase } from './database.js';
import { getBackupPaths } from './backups.js';
import { filePaths } from './files/store.js';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

// Only the local composition imports these Node services. Future compositions supply their own map.
export const localCapabilities = Object.freeze(
	Object.fromEntries(capabilityNames.map((name) => [name, true]))
);
const local =
	(capability, operation) =>
	(...args) => {
		requireCapability(localCapabilities, capability);
		return operation(...args);
	};

// These guards supplement the browser adapter's session/origin/local ownership checks.
export const localPlatform = Object.freeze({
	checkUpdates: local('host.installation', checkUpdates),
	queueOperation: local('host.installation', queueOperation),
	operationStatus: local('host.installation', operationStatus),
	installedCheck: local('host.installation', installedCheck),
	loginStartupStatus: local('host.controls', loginStartupStatus),
	setLoginStartup: local('host.controls', setLoginStartup),
	controlServer: local('host.controls', controlServer),
	serverSummary: local('host.controls', serverSummary),
	extensionStatus: local('extensions', extensionStatus),
	extensionCatalog: local('extensions', extensionCatalog),
	storageDiagnostics: local('host.files', (fileSummary) => {
		const db = openDatabase({ migrate: false });
		try {
			return {
				databaseVersion: db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
					.version,
				databaseFormat: db.prepare('SELECT format FROM app_metadata WHERE id=1').get().format,
				datasetId: db.prepare('SELECT dataset_id FROM app_metadata WHERE id=1').get().dataset_id,
				manifestVersion: fileSummary?.format_version ?? null,
				manifestFormat: fileSummary?.format ?? null,
				databasePaths: getBackupPaths(),
				filePaths: filePaths()
			};
		} finally {
			db.close();
		}
	}),
	openDataFolder: local('host.files', async () => {
		const path = getInstallation().data_root;
		if (!existsSync(path)) throw new Error('The data directory is unavailable.');
		const command = { darwin: 'open', win32: 'explorer.exe', linux: 'xdg-open' }[process.platform];
		if (!command)
			throw new Error('Opening a folder is unavailable on this platform. Copy its path instead.');
		await new Promise((resolve, reject) => {
			const child = spawn(command, [path], { stdio: 'ignore', shell: false });
			child.once('error', reject);
			child.once('close', (code) =>
				code === 0
					? resolve(undefined)
					: reject(new Error('Could not open the folder. Copy its path instead.'))
			);
		});
	}),
	setExtensionsEnabled: local('extensions', setExtensionsEnabled)
});
