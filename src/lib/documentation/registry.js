// Only these maintained guides may be included in assistant help.
export const documentationRegistry = [
	[
		'overview',
		'README.md',
		'Saturday overview',
		'Features, privacy and quick installation.',
		['start', 'features']
	],
	['help', 'docs/README.md', 'Documentation index', 'Choose the guide for your task.', ['help']],
	[
		'installation',
		'docs/installation-guide.md',
		'Installation and recovery',
		'Install, open, update, repair, LAN and password recovery.',
		['phone', 'wifi', 'lan', 'forgot password', 'locked out', 'restart', 'uninstall']
	],
	[
		'usage',
		'docs/user-guide.md',
		'Using Saturday',
		'Jobs, people, reminders, tags, documents and backups.',
		['stage', 'workflow', 'network', 'reminder', 'profile']
	],
	[
		'assistant',
		'docs/assistant-guide.md',
		'Connect an assistant',
		'Configure and verify local MCP access.',
		['chatgpt', 'codex', 'mcp', 'connect']
	],
	[
		'mcp',
		'docs/mcp-reference.md',
		'MCP reference',
		'Core tool inputs and safeguards.',
		['tools', 'api']
	],
	[
		'recovery',
		'docs/agent-guide.md',
		'Agent setup and recovery',
		'Host commands and safe installation/data recovery.',
		['backup', 'restore', 'offline']
	],
	[
		'contributing',
		'docs/contributing.md',
		'Contributing',
		'Development commands, source map and storage contracts.',
		['develop', 'feature', 'database', 'migration']
	],
	[
		'architecture',
		'docs/application-architecture.md',
		'Application architecture',
		'Shared operations and platform boundaries.',
		['adapter', 'assistant', 'server']
	],
	[
		'cloudflare',
		'docs/cloudflare-storage-contract.md',
		'Cloudflare storage contracts',
		'Local harness and future hosted storage requirements.',
		['supabase', 'cloud', 'mobile']
	],
	[
		'design',
		'docs/design-guide.md',
		'Design guide',
		'Shared UI, dialogs, layout and accessibility.',
		['ui', 'component', 'styling']
	],
	[
		'extensions',
		'docs/extension-guide.md',
		'Extension guide',
		'Trusted packages, public APIs and independent recovery.',
		['extension', 'plugin']
	]
].map(([id, source, title, summary, aliases]) => ({ id, source, title, summary, aliases }));
