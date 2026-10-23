import { AsyncLocalStorage } from 'node:async_hooks';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { getInstallation } from './installation.js';
import { ServiceError } from './validation.js';

const owner = new AsyncLocalStorage();
export const jobDeletionPath = () => join(getInstallation().files_state, 'job-deletion.json');
export const jobDeletionRecoveryMessage =
	'Job document cleanup needs recovery. Stop other Saturday processes and run npm run files -- recover-job-deletion, then reopen Saturday.';

export function hasPendingJobDeletion() {
	try {
		lstatSync(jobDeletionPath());
		return true;
	} catch (error) {
		if (error.code === 'ENOENT') return false;
		throw new ServiceError(jobDeletionRecoveryMessage, 'RECOVERY_REQUIRED');
	}
}

export function assertJobDeletionAvailable(force = false) {
	if (!force && owner.getStore() === jobDeletionPath()) return;
	if (hasPendingJobDeletion())
		throw new ServiceError(jobDeletionRecoveryMessage, 'RECOVERY_REQUIRED');
}

// Async ownership is local to this operation, never a process-wide recovery bypass.
export const withJobDeletionAccess = (operation) => owner.run(jobDeletionPath(), operation);
