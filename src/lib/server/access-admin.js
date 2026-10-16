import { acquireDirectoryLock, getInstallation } from './installation.js';
import { AccessError } from './access-settings.js';
import { operationPaths, operationStatus } from './installation-operations.js';
import * as fs from 'node:fs/promises';
const finished = new Set(['complete', 'failed', 'interrupted']);
export async function withAccessChange(work) {
	const installation = getInstallation();
	if (!installation.descriptor_path)
		throw new AccessError(
			'Finish Saturday setup, then reload Settings before changing password login. Setup preserves existing records and files.',
			409
		);
	const paths = operationPaths(installation);
	await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
	const release = await acquireDirectoryLock(paths.lock, { attempts: 0 });
	if (!release)
		throw new AccessError(
			'Installation work is running. Wait before changing sign-in settings.',
			409
		);
	try {
		const operation = operationStatus();
		if (operation && !finished.has(operation.status))
			throw new AccessError(
				'Installation work is queued or running. Wait before changing sign-in settings.',
				409
			);
		return await work();
	} finally {
		await release();
	}
}
