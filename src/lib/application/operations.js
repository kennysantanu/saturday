import { ServiceError } from '../domain/validation.js';
import { requireCapability } from './capabilities.js';
import { assessmentJobFields } from '../job-fields.js';

// An implementation owns each complete operation, including its transaction.
// No connection, statement or transaction callback crosses this boundary.
const records = [
	'getNavigationSettings',
	'setNavigationSettings',
	'listRecentViews',
	'recordRecentView',
	'clearRecentViews',
	'createJob',
	'editJob',
	'setJobScore',
	'setJobStarred',
	'getJob',
	'listJobs',
	'searchJobs',
	'addJobUpdate',
	'moveJobStage',
	'correctJobUpdate',
	'getDashboardStats',
	'deleteJob',
	'listNetworks',
	'getNetwork',
	'deleteNetwork',
	'createNetwork',
	'editNetwork',
	'listNetworkJobs',
	'linkJobNetwork',
	'editJobNetwork',
	'unlinkJobNetwork',
	'networkLinkIds',
	'listNetworkUpdates',
	'addNetworkUpdate',
	'editNetworkUpdate',
	'deleteNetworkUpdate',
	'listWorkflowStages',
	'addWorkflowStage',
	'renameWorkflowStage',
	'setWorkflowStageClosed',
	'reorderWorkflowStage',
	'archiveWorkflowStage',
	'restoreWorkflowStage',
	'createReminder',
	'listReminders',
	'editReminder',
	'dismissReminder',
	'deleteReminder',
	'createTag',
	'editTag',
	'listTags',
	'getTagSelection',
	'setTagAssignments',
	'changeTagAssignment',
	'deleteTag',
	'mergeTags'
];
const documents = [
	'listDocuments',
	'getDocument',
	'createDocument',
	'editDocument',
	'copyDocument',
	'deleteDocument',
	'setMasterDocument',
	'uploadDocument',
	'openDocument'
];
export const operationPolicies = Object.freeze(
	Object.fromEntries(
		[
			...records.map((name) => [name, { capability: 'records' }]),
			...documents.map((name) => [name, { capability: 'documents' }]),
			...[
				'createBackup',
				'listBackups',
				'prepareRestore',
				'restoreBackup',
				'importBackupBytes'
			].map((name) => [name, { capability: 'recovery.database' }]),
			...[
				'createFileBackup',
				'listFileBackups',
				'prepareFileRestore',
				'restoreFiles',
				'importFileBackup',
				'recoveryDocuments',
				'recoverCopy',
				'openRecoveryDocument',
				'downloadFileBackup'
			].map((name) => [name, { capability: 'recovery.files' }]),
			...[
				'createBackupPair',
				'prepareBackupPairRestore',
				'restoreBackupPair',
				'createManualBackup',
				'listBackupHistory',
				'deleteManualBackup',
				'importBackupBundle',
				'downloadManualBackup'
			].map((name) => [name, { capability: 'recovery.paired' }]),
			['exportManualBackup', { capability: 'host.files' }],
			['importBackupPath', { capability: 'host.files' }],
			['generateDocumentPdf', { capability: 'pdf' }],
			['pdfReadiness', { capability: 'pdf' }],
			['storageSummary', { capability: 'documents' }],
			['getSaturdayInfo', { capability: 'records' }],
			['getBackupMetadata', { capability: 'recovery.database' }],
			['setJobScore', { capability: 'records', permission: 'assessment.write' }],
			[
				'createJob',
				{
					capability: 'records',
					prepareArguments: ([input, ...rest], context) => [
						context.actor === 'manual' && input && typeof input === 'object'
							? Object.fromEntries(
									Object.entries(input).filter(
										([key]) => !assessmentJobFields.some((field) => field.name === key)
									)
								)
							: input,
						...rest
					],
					permissionForInput: ([input]) =>
						assessmentJobFields.some((field) => Object.hasOwn(input ?? {}, field.name))
							? 'assessment.write'
							: null
				}
			],
			[
				'correctJobUpdate',
				{
					capability: 'records',
					permissionForInput: ([, correction]) => (correction?.remove ? 'records.delete' : null)
				}
			],
			...[
				'deleteJob',
				'deleteNetwork',
				'deleteNetworkUpdate',
				'deleteReminder',
				'deleteTag',
				'mergeTags'
			].map((name) => [name, { capability: 'records', permission: 'records.delete' }]),
			['deleteDocument', { capability: 'documents', permission: 'documents.delete' }],
			['setMasterDocument', { capability: 'documents', permission: 'documents.designate' }],
			...['restoreBackup', 'restoreFiles', 'restoreBackupPair', 'deleteManualBackup'].map(
				(name) => [
					name,
					{
						capability:
							name === 'restoreBackup'
								? 'recovery.database'
								: name === 'restoreFiles'
									? 'recovery.files'
									: 'recovery.paired',
						permission: 'recovery.write'
					}
				]
			),
			...[
				'addWorkflowStage',
				'renameWorkflowStage',
				'setWorkflowStageClosed',
				'reorderWorkflowStage',
				'archiveWorkflowStage',
				'restoreWorkflowStage'
			].map((name) => [name, { capability: 'records', permission: 'workflow.write' }])
		].map(([name, policy]) => [name, Object.freeze(policy)])
	)
);

/**
 * @template {Record<string, (context: import('./contracts.js').ExecutionContext, ...args: any[]) => any>} T
 * @param {T} implementations
 * @param {import('./contracts.js').ExecutionContext} execution
 * @param {Record<string, boolean>} capabilities
 * @returns {{[K in keyof T]: (...args: import('./contracts.js').OperationArguments<T[K]>) => Promise<Awaited<ReturnType<T[K]>>>}}
 */
export function createApplication(implementations, execution, capabilities) {
	if (!['manual', 'assistant'].includes(execution.actor))
		throw new ServiceError('Unknown actor.', 'invalid_actor');
	// Only trusted composition code constructs this context. Never accept it from an input schema.
	const context = Object.freeze({
		actor: execution.actor,
		permissions: Object.freeze([...execution.permissions])
	});
	const available = Object.freeze({ ...capabilities });
	return /** @type {any} */ (
		Object.freeze(
			Object.fromEntries(
				Object.entries(implementations).map(([name, operation]) => {
					const policy = operationPolicies[name];
					if (!policy) throw new Error(`Missing operation policy: ${name}`);
					return [
						name,
						async (...args) => {
							requireCapability(available, policy.capability);
							const values = policy.prepareArguments?.(args, context) ?? args;
							const permission = policy.permission ?? policy.permissionForInput?.(values);
							if (permission && !context.permissions.includes(permission))
								throw new ServiceError(
									'This operation is not permitted for this caller.',
									'forbidden'
								);
							return await operation(context, ...values);
						}
					];
				})
			)
		)
	);
}
