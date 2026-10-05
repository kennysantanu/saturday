import {
	createBackup,
	listBackups,
	prepareRestore,
	restoreBackup,
	getBackupSettings,
	setBackupSettings,
	publicBackupError
} from './backups.js';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { addJobUpdate, createJob, getJob, listJobs } from './services.js';
import { ServiceError, ValidationError } from './validation.js';

const server = new McpServer({ name: 'saturday', version: '0.1.0' });
const milestoneTypes = [
	'applied',
	'prescreened',
	'interview_1',
	'interview_2',
	'offer',
	'accepted',
	'rejected'
];

/** @returns {import('@modelcontextprotocol/server').CallToolResult} */
function toolError(error) {
	const message = error instanceof Error ? error.message : String(error);
	return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/** @returns {import('@modelcontextprotocol/server').CallToolResult} */
function toolResult(value) {
	return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

server.registerTool(
	'create_job',
	{
		description:
			'Create a job in Saturday. This writes a new record. Provide the exact job title and company; optional fields are stored as plain text.',
		inputSchema: z.object({
			job_title: z.string().trim().min(1).max(200).describe('Required job title.'),
			company_name: z.string().trim().min(1).max(200).describe('Required company name.'),
			posting_url: z
				.string()
				.trim()
				.max(2048)
				.optional()
				.describe('Optional http or https job posting link.'),
			job_description: z
				.string()
				.trim()
				.max(50000)
				.optional()
				.describe('Optional job description as plain text.'),
			notes: z.string().trim().max(10000).optional().describe('Optional job notes as plain text.')
		})
	},
	async (input) => {
		try {
			const job = createJob(input, 'mcp');
			return toolResult({
				id: job.id,
				title: job.title,
				company: job.company,
				status: job.status.label
			});
		} catch (error) {
			return toolError(error);
		}
	}
);

server.registerTool(
	'list_jobs',
	{
		description:
			'Find jobs by title or company before recording progress. Results are limited to 50 and include active and inactive jobs with stable IDs. An empty query lists the most recently updated jobs.',
		inputSchema: z.object({
			query: z
				.string()
				.trim()
				.max(200)
				.optional()
				.describe('Optional title or company search text.')
		})
	},
	async ({ query }) => {
		try {
			const jobs = listJobs({ includeInactive: true, query: query ?? '', limit: 50 }).map(
				(job) => ({
					id: job.id,
					title: job.title,
					company: job.company,
					is_active: job.isActive,
					status: job.status.label
				})
			);
			return toolResult({ jobs });
		} catch (error) {
			return toolError(error);
		}
	}
);

server.registerTool(
	'get_job',
	{
		description: 'Read one job and its dated update history using its stable Saturday job ID.',
		inputSchema: z.object({
			job_id: z.string().trim().min(1).describe('Stable ID returned by list_jobs or create_job.')
		})
	},
	async ({ job_id }) => {
		try {
			const job = getJob(job_id);
			if (!job)
				return toolError(
					new ServiceError('Job not found. Check the job ID and try again.', 'not_found')
				);
			return toolResult({
				id: job.id,
				title: job.title,
				company: job.company,
				posting_url: job.postingUrl,
				job_description: job.description,
				notes: job.notes,
				is_active: job.isActive,
				status: job.status.label,
				updates: job.updates.map(({ id, eventType, date, note, createdVia }) => ({
					id,
					event_type: eventType,
					event_date: date,
					note,
					created_via: createdVia
				}))
			});
		} catch (error) {
			return toolError(error);
		}
	}
);

server.registerTool(
	'add_job_update',
	{
		description:
			'Record a dated milestone or note for a job. This writes to Saturday. Use list_jobs first to confirm the correct ID. Inactive jobs accept notes but must be reopened in the UI before milestones can be added.',
		inputSchema: z.object({
			job_id: z.string().trim().min(1).describe('Stable Saturday job ID.'),
			event_date: z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/)
				.describe('Required real calendar date in YYYY-MM-DD format.'),
			event_type: z
				.enum(milestoneTypes)
				.optional()
				.describe(
					'Optional milestone: applied, prescreened, interview_1, interview_2, offer, accepted, or rejected.'
				),
			note: z
				.string()
				.trim()
				.max(10000)
				.optional()
				.describe('Optional context; required when event_type is omitted.')
		})
	},
	async (input) => {
		try {
			if (!input.event_type && !input.note?.trim()) {
				throw new ValidationError({ note: 'Enter a note when event_type is omitted.' });
			}
			const update = addJobUpdate(input, 'mcp');
			return toolResult({
				id: update.id,
				job_id: update.jobId,
				event_type: update.eventType,
				event_date: update.date,
				note: update.note
			});
		} catch (error) {
			return toolError(error);
		}
	}
);

// Backup tools intentionally accept managed IDs rather than arbitrary filesystem paths.
const backupTools = [
	[
		'create_backup',
		'Create a local Saturday backup. Contains private career data; returns an ID, not file contents.',
		z.object({}),
		() => createBackup(),
		false,
		false
	],
	[
		'list_backups',
		'List managed local backups, including automatic and recovery backups.',
		z.object({
			limit: z.number().int().min(1).max(50).optional(),
			offset: z.number().int().min(0).optional()
		}),
		(input) => listBackups(input),
		true,
		false
	],
	[
		'prepare_restore',
		'Preview replacement of all current jobs and updates from a backup. Show current/incoming counts to the user and obtain explicit authorization before restore_backup. Preview expires after ten minutes.',
		z.object({ backup_id: z.string().uuid() }),
		({ backup_id }) => prepareRestore(backup_id),
		false,
		false
	],
	[
		'restore_backup',
		'DESTRUCTIVE: replace current records using a prepared restore. Call only after showing the preview and obtaining explicit user authorization. Creates a recovery backup first. Never automatically retry.',
		z.object({ restore_id: z.string().uuid(), confirm: z.literal(true) }),
		({ restore_id, confirm }) => restoreBackup(restore_id, confirm),
		false,
		true
	],
	[
		'get_backup_settings',
		'Read automatic backup settings and status. Automatic backups run only while the web app runs through npm start or npm run dev.',
		z.object({}),
		() => getBackupSettings(),
		true,
		false
	],
	[
		'set_backup_settings',
		'Configure automatic backups. Enabling authorizes deletion of older automatic backups beyond keep_count. Manual and recovery backups are preserved. Obtain user authorization for this policy before changing it.',
		z
			.object({
				enabled: z.boolean().optional(),
				interval_hours: z.number().int().min(1).max(168).optional(),
				keep_count: z.number().int().min(1).max(100).optional()
			})
			.refine((input) => Object.keys(input).length > 0, 'Provide at least one setting.'),
		(input) => setBackupSettings(input),
		false,
		true
	]
];
for (const [
	name,
	description,
	inputSchema,
	operation,
	readOnlyHint,
	destructiveHint
] of backupTools) {
	server.registerTool(
		name,
		{
			description,
			inputSchema,
			annotations: {
				readOnlyHint,
				destructiveHint,
				idempotentHint: readOnlyHint || name === 'set_backup_settings',
				openWorldHint: false
			}
		},
		async (input) => {
			try {
				return toolResult({ ok: true, ...operation(input) });
			} catch (error) {
				return {
					content: [
						{ type: 'text', text: JSON.stringify({ ok: false, error: publicBackupError(error) }) }
					],
					isError: true
				};
			}
		}
	);
}

const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
	console.error(
		`Saturday MCP server stopped: ${error instanceof Error ? error.message : String(error)}`
	);
	process.exitCode = 1;
});
