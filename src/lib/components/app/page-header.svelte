<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		eyebrow,
		meta,
		actions
	}: {
		title: string;
		description?: string;
		eyebrow?: string;
		/** Status or attribution shown with the title, such as a badge row. */
		meta?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<header class="page-header">
	<div class="min-w-0 space-y-1">
		{#if eyebrow}
			<p class="text-sm font-medium text-muted-foreground">{eyebrow}</p>
		{/if}
		<h1 class="page-title">{title}</h1>
		{#if description}
			<p class="max-w-prose text-base text-muted-foreground">{description}</p>
		{/if}
		{#if meta}
			<div class="flex flex-wrap items-center gap-2 pt-3">
				{@render meta()}
			</div>
		{/if}
	</div>
	{#if actions}
		<div class="page-actions">
			{@render actions()}
		</div>
	{/if}
</header>
