<script lang="ts">
	import Clipboard from '@lucide/svelte/icons/clipboard';
	import Check from '@lucide/svelte/icons/check';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';

	let { data } = $props();
	let copied = $state<'path' | 'config' | null>(null);
	let copyError = $state('');

	async function copy(kind: 'path' | 'config', text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = kind;
			copyError = '';
			setTimeout(() => (copied = null), 2000);
		} catch {
			copyError = 'Select the text and copy it manually.';
		}
	}
</script>

<svelte:head><title>Settings · Saturday</title></svelte:head>

<div class="space-y-8">
	<PageHeader
		title="Settings"
		description="Where your data lives and how to connect an assistant."
	/>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Connect an assistant</Card.Title>
			<Card.Description
				>Let ChatGPT Work on this computer add jobs and record updates in Saturday.</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-5">
			{#if data.mcpReady}
				<Notice tone="success" title="MCP entry point is built"
					>The desktop client will start this process when it connects.</Notice
				>
			{:else}
				<Notice tone="info" title="Build the MCP entry point first"
					>Run <code>npm run build:mcp</code> in this project folder.</Notice
				>
			{/if}
			<ol class="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
				<li>
					Build the MCP entry point with <code>npm run build:mcp</code>.
				</li>
				<li>Copy the configuration below into the desktop client's local MCP settings.</li>
				<li>Reconnect the client, then ask it to list your jobs to check the connection.</li>
			</ol>
			<div class="space-y-2">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<p class="text-sm font-medium" role="status">
						{copied === 'config' ? 'Configuration copied' : 'Local desktop configuration'}
					</p>
					<Button variant="outline" size="sm" onclick={() => copy('config', data.configuration)}>
						{#if copied === 'config'}<Check data-icon="inline-start" />Copied{:else}<Clipboard
								data-icon="inline-start"
							/>Copy config{/if}
					</Button>
				</div>
				<pre
					class="inset-surface overflow-x-auto bg-muted/50 p-4 text-xs leading-relaxed whitespace-pre"><code
						>{data.configuration}</code
					></pre>
				{#if copyError}<p class="text-sm text-muted-foreground">{copyError}</p>{/if}
				<p class="text-xs text-muted-foreground">
					This configuration points at the same database path shown below. It includes absolute
					paths for the current project and Node installation.
				</p>
			</div>
			<div class="inset-surface px-4 py-3 text-sm">
				<p class="font-medium">Connection check</p>
				<p class="mt-1 text-muted-foreground">
					In ChatGPT Work, ask: “List my jobs in Saturday.” A result from <code>list_jobs</code> confirms
					the local MCP process can read this database.
				</p>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Local database</Card.Title>
			<Card.Description
				>Saturday stores everything in one file on this computer. Nothing is sent anywhere.</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-3">
			<div class="flex flex-wrap items-center gap-3">
				<p
					class="min-w-0 flex-1 rounded-[var(--r-group)] bg-muted px-3 py-2.5 font-mono text-sm break-all text-muted-foreground"
				>
					{data.databasePath}
				</p>
				<Button
					variant="outline"
					size="sm"
					aria-label="Copy database path"
					onclick={() => copy('path', data.databasePath)}
				>
					{#if copied === 'path'}<Check data-icon="inline-start" />Copied{:else}<Clipboard
							data-icon="inline-start"
						/>Copy path{/if}
				</Button>
			</div>
			<p class="text-sm text-muted-foreground">
				Set <code>SATURDAY_DB_PATH</code> before starting Saturday to use another location.
			</p>
		</Card.Content>
	</Card.Root>
</div>
