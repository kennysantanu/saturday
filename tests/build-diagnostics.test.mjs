import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { captureBuildDiagnostics, install, copySource } from '../scripts/install.mjs';

test('failed build diagnostics retain exact manifests after installer staging cleanup', async (t) => {
	const root = await fs.mkdtemp(join(tmpdir(), 'saturday-build-diagnostics-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const project = join(root, 'stage', 'app'),
		logs = join(root, 'logs'),
		manifest = '{"C:/different/path/src/routes/api/documents/+server.js":{"file":"route.js"}}';
	await fs.mkdir(join(project, '.svelte-kit/output/server/.vite'), { recursive: true });
	await fs.mkdir(join(project, 'src/routes/api/documents'), { recursive: true });
	await fs.mkdir(join(project, 'node_modules/vite'), { recursive: true });
	await fs.mkdir(join(project, 'data'), { recursive: true });
	await fs.writeFile(join(project, '.svelte-kit/output/server/.vite/manifest.json'), manifest);
	await fs.writeFile(join(project, 'src/routes/api/documents/+server.js'), 'fixture');
	await fs.writeFile(join(project, 'node_modules/vite/package.json'), '{"version":"8.3.1"}');
	await fs.writeFile(join(project, 'data/private.txt'), 'Never collect workspace files.');
	const destination = await captureBuildDiagnostics(project, logs, {
		node: process.execPath,
		build: { commit: 'a'.repeat(40) },
		error: new Error('Fictional manifest build failure')
	});
	await fs.rm(join(root, 'stage'), { recursive: true, force: true });
	assert.equal(await fs.readFile(join(destination, 'server-manifest.json'), 'utf8'), manifest);
	assert.deepEqual((await fs.readdir(destination)).sort(), ['report.json', 'server-manifest.json']);
	const report = JSON.parse(await fs.readFile(join(destination, 'report.json')));
	assert.equal(report.packages.vite, '8.3.1');
	assert.equal(report.error, 'Fictional manifest build failure');
	assert.equal(report.artifacts['server-manifest.json'].status, 'saved');
	assert.equal(report.artifacts['client-manifest.json'].error, 'ENOENT');
	assert.equal(report.build.commit, 'a'.repeat(40));
});

test('installer captures failure evidence before cleanup and preserves the original error', async (t) => {
	const temporary = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'saturday-failed-install-')));
	t.after(() => fs.rm(temporary, { recursive: true, force: true }));
	const root = join(temporary, 'installation'),
		source = join(temporary, 'source'),
		failure = new Error('Fictional SvelteKit manifest failure');
	await copySource(process.cwd(), source);
	await assert.rejects(
		install(
			{ root, source, 'skip-pdf': true, 'no-open': true },
			{
				prepareRuntime: async (config) => config,
				run: async (_node, _args, options) => {
					const output = join(options.cwd, '.svelte-kit/output/server/.vite');
					await fs.mkdir(output, { recursive: true });
					await fs.writeFile(join(output, 'manifest.json'), '{"fixture":{"file":"route.js"}}');
					throw failure;
				}
			}
		),
		(error) => error === failure
	);
	const entries = await fs.readdir(root);
	assert.deepEqual(entries, ['logs']);
	const diagnosticFolders = (await fs.readdir(join(root, 'logs'))).filter((name) =>
		name.startsWith('failed-build-')
	);
	assert.equal(diagnosticFolders.length, 1);
	const evidence = join(root, 'logs', diagnosticFolders[0]);
	assert.equal(
		await fs.readFile(join(evidence, 'server-manifest.json'), 'utf8'),
		'{"fixture":{"file":"route.js"}}'
	);
	assert.match(
		await fs.readFile(join(root, 'logs', 'installer.log'), 'utf8'),
		/Build diagnostics saved:/
	);
});
