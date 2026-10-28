import { z } from 'zod';
import { createDocumentationHelp } from '../documentation/help.js';
import { createAssistantCatalog } from '../application/assistant-catalog.js';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { localCapabilities } from './platform.js';
import { assistantApplication } from './application.js';
import { buildInfo } from './compatibility.js';
import { ServiceError, ValidationError } from '../domain/validation.js';
import { publicBackupError } from './backups.js';
import { publicFileError } from './files/store.js';
import { withServerActivity } from './server-lifecycle.js';
import { recoverJobDeletion } from './job-deletion.js';
import { extensionRegistry } from './extensions.generated.js';
import {
	extensionStatus,
	runExtension,
	runExtensionTool,
	toolName,
	extensionError,
	registerExtensionRuntime
} from './extensions.js';

const server = new McpServer(
	{ name: 'saturday', version: buildInfo.id },
	{
		instructions:
			'For help with Saturday installation, phone/LAN access, password recovery, usage or development, call search_documentation then read_documentation. These bundled guides match this build. Recovery instructions require separate authorized host-terminal actions; help tools cannot execute them.'
	}
);
const help = createDocumentationHelp(undefined, buildInfo);
function toolError(error) {
	const message =
		error instanceof ValidationError
			? Object.values(error.fieldErrors).join(' ')
			: error instanceof Error
				? error.message
				: String(error);
	return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}
function toolResult(value) {
	return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}
function publicNetworkError(error) {
	if (error?.code === 'BUSY') return { code: 'BUSY', message: error.message };
	if (error instanceof ValidationError)
		return { code: 'validation_error', message: error.message, fields: error.fieldErrors };
	if (error instanceof ServiceError) return { code: error.code, message: error.message };
	return {
		code: 'operation_failed',
		message: 'Saturday could not complete this Network operation. Try again.'
	};
}
function publicDeletionError(error) {
	if (error instanceof ValidationError)
		return { code: 'validation_error', message: error.message, fields: error.fieldErrors };
	if (error instanceof ServiceError) return { code: error.code, message: error.message };
	return publicFileError(error);
}
for (const [name, description, inputSchema, execute] of [
	[
		'search_documentation',
		'Search this build’s bundled Saturday guides for setup, phone/LAN, forgotten passwords, usage and development. Omit query for the guide index. Read-only, offline; does not access career records or execute recovery.',
		z
			.object({
				query: z.string().max(200).optional(),
				limit: z.number().int().min(1).max(10).optional()
			})
			.strict(),
		(input) => help.search(input)
	],
	[
		'read_documentation',
		'Read a bundled Saturday guide or section by IDs returned from search_documentation. Follow remaining_sections for long guides. Accepts no file paths or URLs; cannot execute commands or reset passwords.',
		z
			.object({ document_id: z.string().max(80), section_id: z.string().max(200).optional() })
			.strict(),
		(input) => help.read(input)
	]
])
	server.registerTool(
		name,
		{
			description,
			inputSchema,
			annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
		},
		async (input) => {
			try {
				return toolResult(execute(input));
			} catch (error) {
				return toolError(error);
			}
		}
	);
// Preserve existing MCP response/error envelopes outside the shared command catalog.
const responseGroups = {
	backup: [
		'import_backup_bundle',
		'create_backup',
		'list_backups',
		'prepare_restore',
		'restore_backup',
		'list_backup_history',
		'delete_backup',
		'export_backup'
	],
	file: [
		'create_backup_pair',
		'prepare_backup_pair_restore',
		'restore_backup_pair',
		'list_documents',
		'get_document',
		'create_document',
		'edit_document',
		'copy_document',
		'delete_document',
		'set_master_document',
		'generate_document_pdf',
		'create_file_backup',
		'list_file_backups',
		'prepare_file_restore',
		'restore_files'
	],
	network: [
		'list_networks',
		'get_network',
		'create_network',
		'edit_network',
		'link_job_network',
		'edit_job_network',
		'unlink_job_network',
		'list_network_updates',
		'add_network_update',
		'edit_network_update',
		'delete_network_update'
	],
	deletion: ['delete_job', 'delete_network']
};
const formatters = {
	backup: publicBackupError,
	file: publicFileError,
	network: publicNetworkError,
	deletion: publicDeletionError
};
for (const { name, description, inputSchema, annotations, execute } of createAssistantCatalog(
	assistantApplication,
	localCapabilities
)) {
	const errorGroup = Object.keys(responseGroups).find((group) =>
		responseGroups[group].includes(name)
	);
	server.registerTool(
		name,
		{ description, inputSchema, ...(annotations ? { annotations } : {}) },
		async (input) => {
			try {
				let value = await withServerActivity(() => execute(input));
				if (name === 'get_saturday_info')
					value = {
						...value,
						documentation: { search_tool: 'search_documentation', read_tool: 'read_documentation' }
					};
				return toolResult(errorGroup ? { ok: true, ...value } : value);
			} catch (error) {
				if (!errorGroup) return toolError(error);
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ ok: false, error: formatters[errorGroup](error) })
						}
					],
					isError: true
				};
			}
		}
	);
}

// Registration is local to this process; every invocation still checks persisted enablement.
const extensionTools = new Map();
let refreshingExtensions = false;
async function refreshExtensionTools() {
	if (refreshingExtensions) return;
	refreshingExtensions = true;
	try {
		const active = new Set();
		const status = await extensionStatus(extensionRegistry);
		for (const entry of status.installed.filter((e) => e.available)) {
			try {
				await runExtension(entry.id, extensionRegistry, async (mod) => {
					for (const [local, definition] of Object.entries(mod.tools ?? {})) {
						const name = toolName(entry.id, local);
						if (!extensionTools.has(name))
							extensionTools.set(
								name,
								server.registerTool(
									name,
									{
										description: `${entry.manifest.name}: ${definition.description}`,
										inputSchema: definition.inputSchema,
										annotations: definition.annotations
									},
									async (input) => {
										try {
											return toolResult(
												await runExtensionTool(entry.id, local, input, extensionRegistry)
											);
										} catch (e) {
											return {
												content: [
													{
														type: 'text',
														text: JSON.stringify({ ok: false, error: extensionError(e) })
													}
												],
												isError: true
											};
										}
									}
								)
							);
						active.add(name);
						if (!extensionTools.get(name).enabled) extensionTools.get(name).enable();
					}
				});
			} catch (e) {
				console.error(`Extension ${entry.id}: ${extensionError(e).message}`);
			}
		}
		for (const [name, tool] of extensionTools)
			if (!active.has(name) && tool.enabled) tool.disable();
	} catch (e) {
		for (const tool of extensionTools.values()) if (tool.enabled) tool.disable();
		console.error(`Extensions unavailable: ${extensionError(e).message}`);
	} finally {
		refreshingExtensions = false;
	}
}
await recoverJobDeletion();
try {
	await registerExtensionRuntime();
} catch (e) {
	console.error(`Extension runtime registration failed: ${e.message}`);
	if (e.code === 'BUSY') throw e;
}
await refreshExtensionTools();
const extensionRefresh = setInterval(() => void refreshExtensionTools(), 1000);
extensionRefresh.unref();

const transport = new StdioServerTransport();
server.connect(transport).catch((error) => {
	console.error(
		`Saturday MCP server stopped: ${error instanceof Error ? error.message : String(error)}`
	);
	process.exitCode = 1;
});
