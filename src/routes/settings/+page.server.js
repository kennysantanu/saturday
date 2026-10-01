import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDatabasePath, getProjectRoot } from '$lib/server/database.js';

export function load() {
	const databasePath = getDatabasePath();
	const nodePath = process.execPath;
	const mcpPath = join(getProjectRoot(), 'build', 'mcp', 'index.js');
	const config = {
		mcpServers: {
			saturday: {
				command: nodePath,
				args: [mcpPath],
				env: { SATURDAY_DB_PATH: databasePath }
			}
		}
	};
	return {
		databasePath,
		mcpPath,
		mcpReady: existsSync(mcpPath),
		configuration: JSON.stringify(config, null, 2)
	};
}
