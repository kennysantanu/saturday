import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'build', 'mcp', 'index.js');

try {
	await mkdir(dirname(outfile), { recursive: true });
	await build({
		entryPoints: [join(root, 'src', 'lib', 'server', 'mcp-server.js')],
		outfile,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22.13',
		packages: 'bundle',
		banner: { js: '#!/usr/bin/env node' }
	});
	console.log(`Built local MCP server at ${outfile}`);
} catch (error) {
	console.error(`MCP build failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
