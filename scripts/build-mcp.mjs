import { buildDocumentation } from './documentation-build.mjs';
import { generateExtensions } from './extension-build.mjs';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildInfo } from './build-info.mjs';
import { checkReleasePolicy } from './check-release.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'build', 'mcp', 'index.js');

try {
	checkReleasePolicy(root);
	await generateExtensions();
	await mkdir(dirname(outfile), { recursive: true });
	await build({
		entryPoints: [join(root, 'src', 'lib', 'server', 'mcp-server.js')],
		outfile,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22.13',
		define: {
			__SATURDAY_BUILD_INFO__: JSON.stringify(readBuildInfo(root)),
			__SATURDAY_DOCUMENTATION__: JSON.stringify(buildDocumentation(root))
		},
		packages: 'bundle',
		// Zod's ESM cycles must retain module initialization order alongside the SDK.
		external: ['puppeteer', 'yazl', 'yauzl', 'zod'],
		banner: { js: '#!/usr/bin/env node' }
	});
	await build({
		entryPoints: [join(root, 'src', 'lib', 'server', 'extensions.generated.js')],
		outfile: join(root, 'build', 'mcp', 'extensions.js'),
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22.13',
		packages: 'bundle'
	});
	console.log(`Built local MCP server at ${outfile}`);
} catch (error) {
	console.error(`MCP build failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
