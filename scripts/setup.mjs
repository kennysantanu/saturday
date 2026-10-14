// Resumable source setup; bootstrap wrappers call this same engine.
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import {
	sourceInstallation,
	defaultInstallationRoot,
	getInstallation,
	descriptorPath,
	validateInstallation,
	installationEnvironment,
	assertInstallationStorage,
	atomicJson,
	acquireDirectoryLock
} from '../src/lib/server/installation.js';
import { storageCompatibility } from '../src/lib/server/compatibility.js';
import { readBuildInfo } from './build-info.mjs';
let json = process.argv.includes('--json'),
	config,
	path,
	release,
	log = '';
const say = (value) => {
	process.stderr.write(value + '\n');
	log = (log + value + '\n').slice(-1024 * 1024);
};
try {
	const { values } = parseArgs({
		options: {
			json: { type: 'boolean' },
			managed: { type: 'boolean' },
			root: { type: 'string' },
			'skip-dependencies': { type: 'boolean' },
			'skip-build': { type: 'boolean' },
			'skip-pdf': { type: 'boolean' }
		}
	});
	if (values.root && !values.managed)
		throw new Error(
			'--root is only for a new managed installation. Existing source data is not relocated.'
		);
	const source = sourceInstallation();
	path = process.env.SATURDAY_INSTALLATION_PATH
		? resolve(process.env.SATURDAY_INSTALLATION_PATH)
		: values.managed
			? join(values.root ? resolve(values.root) : defaultInstallationRoot(), 'installation.json')
			: descriptorPath() || join(source.data_root, 'installation.json');
	await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
	release = await acquireDirectoryLock(`${path}.lock`, { attempts: 0 });
	if (!release) throw new Error('Another setup is running for this installation.');
	if (existsSync(path)) {
		process.env.SATURDAY_INSTALLATION_PATH = path;
		config = getInstallation();
		if (values.managed && config.mode !== 'managed')
			throw new Error('An existing source installation will not be relocated by setup.');
	} else {
		config = { ...source, installation_id: randomUUID(), build: readBuildInfo(source.code_root) };
		if (values.managed) {
			const root = dirname(path),
				data = join(root, 'data');
			config = {
				...config,
				mode: 'managed',
				data_root: data,
				database: join(data, 'saturday.db'),
				files: join(data, 'files'),
				files_state: join(data, 'files.state'),
				database_backups: join(data, 'backups', 'database'),
				database_restore: join(data, 'saturday.db.restore'),
				file_backups: join(data, 'backups', 'files'),
				extension_state: join(data, 'extensions'),
				extension_code: join(root, 'extensions'),
				extension_backups: join(data, 'extensions.backups'),
				runtime_root: source.runtime_root,
				logs: join(root, 'logs')
			};
		}
		config.initialized = {
			database: existsSync(config.database),
			files: existsSync(join(config.files, 'manifest.json')),
			extensions: existsSync(join(config.extension_state, 'catalog.json'))
		};
		validateInstallation(config);
		await atomicJson(path, config);
		process.env.SATURDAY_INSTALLATION_PATH = path;
	}
	Object.assign(process.env, installationEnvironment({ ...config, descriptor_path: path }));
	assertInstallationStorage();
	await fs.mkdir(config.logs, { recursive: true, mode: 0o700 });
	const persist = () => atomicJson(path, config);
	const command = (args) =>
		new Promise((res, rej) => {
			const child = spawn(config.node_path, args, {
				cwd: config.code_root,
				env: installationEnvironment({ ...config, descriptor_path: path }),
				stdio: ['ignore', 'pipe', 'pipe']
			});
			for (const stream of [child.stdout, child.stderr])
				stream.on('data', (data) => say(String(data).trimEnd()));
			child.on('error', rej);
			child.on('close', (code) =>
				code === 0
					? res()
					: rej(
							new Error(
								`Setup command failed (exit ${code}). See ${join(config.logs, 'setup.log')}.`
							)
						)
			);
		});
	const npm = [
		join(dirname(config.node_path), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
		join(dirname(config.node_path), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
		process.env.npm_execpath
	]
		.filter(Boolean)
		.find(existsSync);
	if (!npm && (!values['skip-dependencies'] || !values['skip-build'] || !values['skip-pdf']))
		throw new Error(
			'This Node runtime has no matching npm. Use the supported Node distribution or retry with a complete runtime.'
		);
	async function step(name, skip, work, optional = false) {
		if (skip) {
			config.setup[name] ??= { status: 'skipped' };
			await persist();
			return;
		}
		config.setup[name] = { status: 'running' };
		await persist();
		say(`Preparing ${name}…`);
		try {
			await work();
			config.setup[name] = { status: 'complete', completed_at: new Date().toISOString() };
			await persist();
		} catch (e) {
			config.setup[name] = { status: 'failed', message: e.message };
			await persist();
			if (!optional) throw e;
			say('PDF export is unavailable; setup will continue. Retry with npm run setup:pdf.');
		}
	}
	await step('dependencies', values['skip-dependencies'], () => command([npm, 'ci']));
	const { withFileLock, validateWholeStore } = await import('../src/lib/server/files/store.js');
	const { migrateDatabase } = await import('../src/lib/server/database.js');
	const { extensionCatalog, withExtensionLock, extensionPaths } =
		await import('../src/lib/server/extensions.js');
	await step(
		'pdf',
		values['skip-pdf'],
		async () => {
			await command([npm, 'run', 'setup:pdf']);
			const { default: puppeteer } = await import('puppeteer');
			const browser = await puppeteer.launch({ headless: true });
			try {
				const page = await browser.newPage();
				await page.setContent('<p>Saturday setup check</p>');
				await page.pdf();
			} finally {
				await browser.close();
			}
		},
		true
	);
	await step('build', values['skip-build'], () => command([npm, 'run', 'build']));
	await step('database', false, async () => {
		migrateDatabase();
		config.initialized.database = true;
		await persist();
	});
	await step('files', false, async () => {
		await withFileLock(validateWholeStore);
		config.initialized.files = true;
		await persist();
	});
	await step('extensions', false, async () => {
		await withExtensionLock(async () => {
			const catalog = await extensionCatalog();
			if (!existsSync(extensionPaths().catalog))
				await atomicJson(extensionPaths().catalog, catalog);
		});
		config.initialized.extensions = true;
		await persist();
	});
	config.requirements = {
		node: JSON.parse(await fs.readFile(join(config.code_root, 'package.json'), 'utf8')).engines
			.node,
		storage: storageCompatibility
	};
	config.build = readBuildInfo(config.code_root);
	await persist();
	const result = {
		ok: true,
		installation_id: config.installation_id,
		descriptor_path: path,
		data_path: config.data_root,
		logs_path: config.logs,
		build: config.build,
		steps: config.setup,
		app_ready: existsSync(join(config.code_root, 'build', 'index.js')),
		mcp_ready: existsSync(join(config.code_root, 'build', 'mcp', 'index.js'))
	};
	if (json) console.log(JSON.stringify(result));
	else {
		say('Saturday workspace is ready.');
		say(`Data: ${config.data_root}`);
		say('Open the UI with npm run open; reconnect your assistant if its configuration changed.');
	}
} catch (e) {
	if (json)
		console.log(
			JSON.stringify({
				ok: false,
				error: { code: 'SETUP_FAILED', message: e.message },
				descriptor_path: path
			})
		);
	else say(`Setup failed: ${e.message}`);
	process.exitCode = 1;
} finally {
	try {
		if (config && existsSync(config.logs))
			await fs.writeFile(join(config.logs, 'setup.log'), log, { mode: 0o600 });
	} catch {
		process.stderr.write('Setup log could not be written. Check disk space and permissions.\n');
	} finally {
		await release?.();
	}
}
