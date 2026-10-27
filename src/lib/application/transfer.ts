import type { DocumentContent, DocumentMetadata } from './contracts.js';

// A future cross-backend transfer protocol, separate from existing SQLite/ZIP backups.
// No exporter/importer is implemented or advertised yet.
export type TransferCollection =
	| 'stages'
	| 'jobs'
	| 'job_history'
	| 'people'
	| 'relationships'
	| 'interactions'
	| 'reminders'
	| 'job_tags'
	| 'person_tags'
	| 'job_tag_assignments'
	| 'person_tag_assignments';
export type TransferValue =
	null | boolean | number | string | TransferValue[] | { [key: string]: TransferValue };
export type TransferHeader = {
	format: 'saturday.transfer';
	version: 1;
	dataset_id: string;
	schema_version: number;
	// Preserve high-water marks, including deleted IDs; never derive solely from surviving rows.
	counters: Partial<Record<TransferCollection, number>>;
	profile: Record<string, string | null>;
};
export type TransferSource = {
	header(): Promise<TransferHeader>;
	records(collection: TransferCollection): AsyncIterable<Record<string, TransferValue>>;
	documents(): AsyncIterable<DocumentMetadata>;
	content(documentId: string): Promise<DocumentContent>;
};
