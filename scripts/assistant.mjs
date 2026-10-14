// Prepare supported local-client configuration. No client file changes without an explicit path and confirmation.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import {
	assistantConfiguration,
	configureAssistantJson,
	getInstallation
} from '../src/lib/server/installation.js';
try {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			installation: { type: 'string' },
			format: { type: 'string', default: 'json' },
			config: { type: 'string' },
			confirm: { type: 'boolean' },
			replace: { type: 'boolean' }
		}
	});
	if (values.installation) process.env.SATURDAY_INSTALLATION_PATH = resolve(values.installation);
	const action = positionals[0] || 'config';
	if (positionals.length > 1 || !['config', 'connect', 'disconnect'].includes(action))
		throw new Error('Use config, connect or disconnect.');
	if (action === 'config') {
		if (!['json', 'toml'].includes(values.format))
			throw new Error('Use --format json or --format toml.');
		console.log(assistantConfiguration(getInstallation())[values.format]);
	} else {
		if (!values.config)
			throw new Error(
				'Provide --config <absolute-client-JSON-path>. TOML is configured through the client or manual reviewed merge.'
			);
		console.log(
			JSON.stringify(
				await configureAssistantJson(values.config, {
					remove: action === 'disconnect',
					replace: values.replace,
					confirm: values.confirm
				})
			)
		);
	}
} catch (error) {
	console.error(`Assistant setup failed: ${error.message}`);
	process.exitCode = 1;
}
