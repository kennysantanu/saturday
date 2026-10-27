// Node/SQLite/filesystem implementation of the application operation contracts.
import * as jobs from './local/jobs.js';
import * as people from './local/people.js';
import * as workflow from './local/workflow.js';
import * as reminders from './local/reminders.js';
import * as tags from './local/tags.js';
import * as documents from './files/documents.js';
import * as databaseBackups from './backups.js';
import * as fileBackups from './files/backups.js';
import * as pairs from './files/pairs.js';
import * as pdf from './files/pdf.js';
import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { getInstallation } from './installation.js';
import { openDatabase } from './database.js';
import { buildInfo } from './compatibility.js';

// Temporary persistence spelling; semantic actor is independent of assistant transport.
const origin = (context) => (context.actor === 'assistant' ? 'mcp' : 'manual');
const nodeContent = (stream) => (stream?.getReader ? Readable.fromWeb(stream) : stream);
const webContent = (stream) =>
	Readable.toWeb(stream, {
		strategy: { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength }
	});
function webDownload({ stream, release, ...metadata }) {
	return { ...metadata, stream: webContent(stream) };
}
function publicStorageSummary({ root, ...summary }) {
	return summary;
}
export const localOperations = {
	createJob: (context, input) => jobs.createJob(input, origin(context)),
	editJob: (context, id, input) => jobs.editJob(id, input),
	setJobScore: (context, id, input) => jobs.setJobScore(id, input),
	setJobStarred: (context, id, starred) => jobs.setJobStarred(id, starred),
	getJob: (context, id) => jobs.getJob(id),
	listJobs: (context, input = {}) => jobs.listJobs(input),
	searchJobs: (context, input = {}, options = {}) => jobs.searchJobs(input, options),
	addJobUpdate: (context, input) => jobs.addJobUpdate(input, origin(context)),
	moveJobStage: (context, id, input) => jobs.moveJobStage(id, input, origin(context)),
	correctJobUpdate: (context, id, correction = {}) => jobs.correctJobUpdate(id, correction),
	getDashboardStats: (context, input = {}) => jobs.getDashboardStats(input),
	deleteJob: (context, input) => jobs.deleteJob(input),
	listNetworks: (context, input = {}) => people.listNetworks(input),
	getNetwork: (context, id) => people.getNetwork(id),
	deleteNetwork: (context, input) => people.deleteNetwork(input),
	createNetwork: (context, input) => people.createNetwork(input, origin(context)),
	editNetwork: (context, id, patch) => people.editNetwork(id, patch),
	listNetworkJobs: (context, input) => people.listNetworkJobs(input),
	linkJobNetwork: (context, input) => people.linkJobNetwork(input, origin(context)),
	editJobNetwork: (context, input) => people.editJobNetwork(input),
	unlinkJobNetwork: (context, input) => people.unlinkJobNetwork(input),
	networkLinkIds: (context, input) => people.networkLinkIds(input),
	listNetworkUpdates: (context, input) => people.listNetworkUpdates(input),
	addNetworkUpdate: (context, input) => people.addNetworkUpdate(input, origin(context)),
	editNetworkUpdate: (context, input) => people.editNetworkUpdate(input),
	deleteNetworkUpdate: (context, input) => people.deleteNetworkUpdate(input),
	listWorkflowStages: (context) => workflow.listWorkflowStages(),
	addWorkflowStage: (context, input) => workflow.addWorkflowStage(input),
	renameWorkflowStage: (context, id, name) => workflow.renameWorkflowStage(id, name),
	setWorkflowStageClosed: (context, id, isClosed, options) =>
		workflow.setWorkflowStageClosed(id, isClosed, options),
	reorderWorkflowStage: (context, id, direction, options) =>
		workflow.reorderWorkflowStage(id, direction, options),
	archiveWorkflowStage: (context, id, options) => workflow.archiveWorkflowStage(id, options),
	restoreWorkflowStage: (context, id) => workflow.restoreWorkflowStage(id),
	createReminder: (context, input) => reminders.createReminder(input, origin(context)),
	listReminders: (context, input) => reminders.listReminders(input),
	editReminder: (context, input) => reminders.editReminder(input),
	dismissReminder: (context, input) => reminders.dismissReminder(input),
	deleteReminder: (context, input) => reminders.deleteReminder(input),
	createTag: (context, input) => tags.createTag(input),
	editTag: (context, input) => tags.editTag(input),
	listTags: (context, input) => tags.listTags(input),
	getTagSelection: (context, input) => tags.getTagSelection(input),
	setTagAssignments: (context, input) => tags.setTagAssignments(input),
	changeTagAssignment: (context, input, add) => tags.changeTagAssignment(input, add),
	deleteTag: (context, input) => tags.deleteTag(input),
	mergeTags: (context, input) => tags.mergeTags(input),
	listDocuments: (context, input = {}) => documents.listDocuments(input),
	getDocument: (context, input, options = {}) => documents.getDocument(input, options),
	createDocument: (context, input) => documents.createDocument(input, origin(context)),
	editDocument: (context, input) => documents.editDocument(input),
	copyDocument: (context, input) => documents.copyDocument(input, origin(context)),
	deleteDocument: (context, input) => documents.deleteDocument(input),
	setMasterDocument: (context, input) => documents.setMasterDocument(input),
	uploadDocument: (context, input) =>
		documents.uploadDocument({ ...input, stream: nodeContent(input.stream) }, origin(context)),
	openDocument: async (context, input) => webDownload(await documents.openDocument(input)),
	storageSummary: async (context) => publicStorageSummary(await documents.storageSummary()),
	recoveryDocuments: (context, jobId) => documents.recoveryDocuments(jobId),
	recoverCopy: (context, input) => documents.recoverCopy(input),
	createBackup: (context) => databaseBackups.createBackup(),
	listBackups: (context, input = {}) => databaseBackups.listBackups(input),
	prepareRestore: (context, backupId) => databaseBackups.prepareRestore(backupId),
	restoreBackup: (context, restoreId, confirm) => databaseBackups.restoreBackup(restoreId, confirm),
	importBackupBytes: (context, bytes) => databaseBackups.importBackupBytes(bytes),
	createFileBackup: (context) => fileBackups.createFileBackup(),
	listFileBackups: (context, input = {}) => fileBackups.listFileBackups(input),
	prepareFileRestore: (context, input) => fileBackups.prepareFileRestore(input),
	restoreFiles: (context, input) => fileBackups.restoreFiles(input),
	importFileBackup: (context, stream) => fileBackups.importFileBackup(nodeContent(stream)),
	createBackupPair: (context) => pairs.createBackupPair(),
	prepareBackupPairRestore: (context, input) => pairs.prepareBackupPairRestore(input),
	restoreBackupPair: (context, input) => pairs.restoreBackupPair(input),
	createManualBackup: (context, input = {}) => pairs.createManualBackup(input),
	listBackupHistory: (context, input = {}) => pairs.listBackupHistory(input),
	deleteManualBackup: (context, input) => pairs.deleteManualBackup(input),
	importBackupBundle: (context, stream) => pairs.importBackupBundle(nodeContent(stream)),
	downloadManualBackup: async (context, input) =>
		webDownload(await pairs.downloadManualBackup(input)),
	exportManualBackup: (context, input, destination) => pairs.exportManualBackup(input, destination),
	generateDocumentPdf: (context, input) => pdf.generateDocumentPdf(input, origin(context)),
	pdfReadiness: (context) => pdf.pdfReadiness(),
	importBackupPath: (context, source) => pairs.importBackupBundle(createReadStream(source)),
	getBackupMetadata: (context, id) => databaseBackups.getBackupFile(id).metadata,
	downloadFileBackup: async (context, id) => {
		const { path, metadata } = await fileBackups.getFileBackup(id);
		return { metadata, stream: webContent(createReadStream(path)) };
	},
	openRecoveryDocument: async (context, input) =>
		webDownload(await documents.openRecoveryDocument(input)),
	getSaturdayInfo: () => {
		const installation = getInstallation();
		const db = openDatabase({ migrate: false });
		try {
			return {
				installation_id: installation.installation_id,
				dataset_id: db.prepare('SELECT dataset_id FROM app_metadata WHERE id=1').get().dataset_id,
				build: buildInfo,
				jobs: db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count,
				networks: db.prepare('SELECT COUNT(*) AS count FROM networks').get().count
			};
		} finally {
			db.close();
		}
	}
};
