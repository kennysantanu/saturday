import { build } from 'esbuild';
import { isBuiltin } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Check the complete resolved graph, including modules removed by tree shaking.
const forbiddenSource =
	/[/\\]src[/\\](?:routes[/\\]|lib[/\\](?:server[/\\]|extensions\.generated\.js))/;
const forbiddenPackage =
	/^(?:@sveltejs\/kit|@modelcontextprotocol|puppeteer|yazl|yauzl|miniflare|workerd)(?:\/|$)/;
const forbiddenFile = (path) =>
	forbiddenSource.test(path) ||
	forbiddenPackage.test(path.replaceAll('\\', '/').split('/node_modules/').at(-1));
const nodeGlobals = new Set(['process', 'Buffer', 'require', '__dirname', '__filename']);
export function portableGraphGuard() {
	return {
		name: 'saturday-portable-graph',
		setup(build) {
			build.onResolve({ filter: /.*/ }, ({ path }) => {
				if (
					path.startsWith('node:') ||
					isBuiltin(path) ||
					forbiddenPackage.test(path) ||
					forbiddenFile(path)
				)
					return { errors: [{ text: `Unavailable in the portable runtime: ${path}` }] };
			});
			build.onLoad({ filter: /\.[cm]?[jt]s$/ }, async ({ path }) => {
				if (forbiddenFile(path))
					return {
						errors: [{ text: `Local/framework code cannot enter the portable runtime: ${path}` }]
					};
				if (path.includes('node_modules')) return;
				const source = ts.createSourceFile(
					path,
					await readFile(path, 'utf8'),
					ts.ScriptTarget.Latest,
					true
				);
				let forbidden;
				const inspect = (node) => {
					if (
						ts.isPropertyAccessExpression(node) &&
						ts.isIdentifier(node.expression) &&
						node.expression.text === 'globalThis' &&
						nodeGlobals.has(node.name.text) &&
						!ts.isTypeOfExpression(node.parent)
					)
						forbidden = node.name.text;
					// Ordinary property names and typeof globalThis probes do not use a Node runtime.
					if (
						ts.isIdentifier(node) &&
						nodeGlobals.has(node.text) &&
						!(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
						!(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
					)
						forbidden = node.text;
					ts.forEachChild(node, inspect);
				};
				inspect(source);
				if (forbidden)
					return {
						errors: [
							{ text: `Node global cannot enter the portable runtime: ${forbidden} in ${path}` }
						]
					};
			});
		}
	};
}

export async function buildCloudflareHarness(entryPoint = 'tests/fixtures/cloudflare/worker.js') {
	const result = await build({
		entryPoints: [resolve(entryPoint)],
		bundle: true,
		format: 'esm',
		platform: 'browser',
		conditions: ['workerd', 'worker', 'browser'],
		target: 'es2022',
		write: false,
		metafile: true,
		logLevel: 'silent',
		plugins: [portableGraphGuard()]
	});
	for (const [path, module] of Object.entries(result.metafile.inputs)) {
		if (
			forbiddenSource.test(resolve(path)) ||
			module.imports.some((entry) => entry.external && entry.path !== '<runtime>')
		)
			throw new Error(`Unverified runtime dependency: ${path}`);
	}
	if (Object.values(result.metafile.outputs).some((output) => output.imports.length))
		throw new Error('The runtime bundle must be self-contained.');
	return result;
}
