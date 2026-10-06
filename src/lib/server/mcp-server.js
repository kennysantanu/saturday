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
import {
	addJobUpdate,
	createJob,
	editJob,
	setJobScore,
	setJobFollowUp,
	getJob,
	searchJobs
} from './services.js';
import { jobForMcp } from '../job-fields.js';
import {
	jobSearchShape,
	jobMcpInputShape,
	followUpMcpSchema,
	assessmentSchema
} from './validation.js';
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
		inputSchema: z.object(jobMcpInputShape({ assessment: true }))
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
			'Find jobs with AND across filters and OR within category selections. Legacy query matches title or company. Defaults to all jobs, 50 per page, recently updated. Historical step filters always include inactive jobs. Dates use the local calendar; score has no fixed scale. Returns total and pagination metadata.',
		inputSchema: z.object({ ...jobSearchShape, view: jobSearchShape.view.default('all') })
	},
	async (input) => {
		try {
			const { jobs, total, page, limit, totalPages } = searchJobs(input);
			return toolResult({
				jobs: jobs.map((job) => ({ ...jobForMcp(job, { list: true }), status: job.status.label })),
				total,
				page,
				limit,
				totalPages
			});
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
				...jobForMcp(job),
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

const jobTools = [
	[
		'edit_job',
		'Edit job details. Omitted fields are preserved; null or empty optional values clear them. Clearing follow_up_date also clears its comment. Assessment fields are changed with set_job_score.',
		z.object({
			job_id: z.string().min(1),
			...jobMcpInputShape({ partial: true })
		}),
		({ job_id, ...input }) => editJob(job_id, input)
	],
	[
		'set_job_follow_up',
		'Set or reschedule one follow-up without adding history or changing status. Null date clears date and comment. Inactive jobs retain follow-ups but hide them from Dashboard.',
		followUpMcpSchema.extend({ job_id: z.string().min(1) }),
		({ job_id, follow_up_date, follow_up_comment }) =>
			setJobFollowUp(job_id, follow_up_date, follow_up_comment)
	],
	[
		'set_job_score',
		'Set the AI assistant assessment and its explanation. Score accepts finite numbers, including decimals, without a fixed scale. Null means unscored; omitted comment clears the previous explanation. These fields are read-only in the UI.',
		assessmentSchema.extend({ job_id: z.string().min(1) }),
		({ job_id, ...input }) => setJobScore(job_id, input)
	]
];
for (const [name, description, inputSchema, operation] of jobTools) {
	server.registerTool(
		name,
		{
			description,
			inputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false
			}
		},
		async (input) => {
			try {
				const job = operation(input);
				return toolResult(jobForMcp(job));
			} catch (error) {
				return toolError(error);
			}
		}
	);
}

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
