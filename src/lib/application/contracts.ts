// Domain contracts intentionally use Web streams and plain values, with no Node/framework types.
import type { z } from 'zod';
import type {
	jobInputSchema,
	jobSearchSchema,
	jobUpdateSchema,
	networkInputSchema,
	assessmentSchema
} from '../domain/validation.js';
import type { reminderInputShape } from '../domain/reminders.js';
import type { tagInputShape } from '../domain/tags.js';

export type JobInput = z.input<typeof jobInputSchema> & {
	job_title: string;
	company_name: string;
	tag_ids?: RecordId[];
};
export type JobSearch = z.input<typeof jobSearchSchema>;
export type JobHistoryInput = z.input<typeof jobUpdateSchema>;
export type PersonInput = z.input<typeof networkInputSchema> & { tag_ids?: RecordId[] };
export type AssessmentInput = z.input<typeof assessmentSchema>;
export type ReminderInput = z.input<z.ZodObject<typeof reminderInputShape>>;
export type TagInput = z.input<z.ZodObject<typeof tagInputShape>>;
export type Actor = 'manual' | 'assistant';
export type ExecutionContext = Readonly<{ actor: Actor; permissions: readonly string[] }>;
export type OperationArguments<T> = T extends (
	context: ExecutionContext,
	...args: infer A
) => unknown
	? A
	: never;
export type RecordId = number;
export type CalendarDate = string; // YYYY-MM-DD; no implicit timezone conversion.
export type ReminderSchedule = string; // YYYY-MM-DDTHH:mm; fixed local schedule.
export type DocumentScope = 'documents' | RecordId;
export type DocumentContent = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;
export type Pagination = { page: number; limit: number; total: number; totalPages: number };
export type Stage = { id: RecordId; name: string; is_closed: boolean; is_archived: boolean };
export type Tag = { id: RecordId; name: string; display_name: string; color: string };
export type JobHistory = {
	id: RecordId;
	jobId: RecordId;
	stageId: RecordId | null;
	date: CalendarDate;
	note: string | null;
	createdVia: Actor;
	createdAt: string;
	updatedAt: string;
	label: string;
	isArchived: boolean;
};
export type Job = {
	id: RecordId;
	title: string;
	company: string;
	currentStageId: RecordId;
	currentStage: Stage;
	updates: JobHistory[];
	tags: Tag[];
	nextReminder: ReminderSchedule | null;
	score: number | null;
	scoreComment: string | null;
	createdVia: Actor;
	createdAt: string;
	updatedAt: string;
	dataset_id?: string;
};
export type DocumentMetadata = {
	id: string;
	key: string;
	scope: DocumentScope;
	filename: string;
	size: number;
	sha256: string;
	token: string;
	created_via: Actor;
	created_at: string;
	updated_at: string;
	designations: string[];
	format: string;
	can_read_text: boolean;
	can_edit_text: boolean;
	can_generate_pdf: boolean;
};
export type DocumentIdentity = { id: string; scope?: DocumentScope; token: string };
export type DocumentPage = Pagination & {
	documents: DocumentMetadata[];
	catalog_token: string;
	designations?: Record<string, string | null>;
};
export type OpenDocument = {
	stream: ReadableStream<Uint8Array>;
	size: number;
	document: DocumentMetadata;
};
export type DocumentStore = {
	listDocuments(input?: {
		scope?: DocumentScope;
		query?: string;
		page?: number;
		limit?: number;
		catalog_token?: string;
	}): Promise<DocumentPage>;
	getDocument(input: {
		id?: string;
		designation?: string;
		scope?: DocumentScope;
		include_content?: boolean;
	}): Promise<DocumentMetadata & { catalog_token: string; content?: string; can_preview: boolean }>;
	openDocument(input: {
		id: string;
		scope?: DocumentScope;
		token?: string;
		range?: { start: number; end: number };
	}): Promise<OpenDocument>;
	uploadDocument(input: {
		scope?: DocumentScope;
		filename: string;
		stream: DocumentContent;
		designation?: string;
		catalog_token?: string;
	}): Promise<DocumentMetadata>;
	createDocument(input: {
		scope?: DocumentScope;
		filename: string;
		content: string;
		designation?: string;
		catalog_token?: string;
	}): Promise<DocumentMetadata>;
	editDocument(
		input: DocumentIdentity & { filename?: string; content?: string }
	): Promise<DocumentMetadata>;
	copyDocument(
		input: DocumentIdentity & { destination_scope?: DocumentScope; filename?: string }
	): Promise<DocumentMetadata>;
	deleteDocument(
		input: DocumentIdentity & {
			confirm: true;
			catalog_token?: string;
			clear_designations?: boolean;
			clear_master?: boolean;
		}
	): Promise<{ id: string; deleted: true; catalog_token: string }>;
	setMasterDocument(input: {
		id: string | null;
		token?: string;
		catalog_token: string;
		designation?: string;
	}): Promise<Record<string, string | null>>;
};

// Future provider code receives a credential reference, never a secret in career data.
// Implementations use host-private storage / native secure storage; not document/Profile content.
export type ProviderConnection = { provider: string; credentialRef: string };
export type CredentialStore = {
	read(reference: string): Promise<string | null>;
	write(reference: string, secret: string): Promise<void>;
	remove(reference: string): Promise<void>;
};
