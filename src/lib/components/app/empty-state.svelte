<script lang="ts">
	import type { Snippet } from 'svelte';

	/** `page` fills a page or list; `inline` sits inside a card for a section with nothing in it yet. */
	let {
		title,
		description,
		icon,
		actions,
		size = 'page'
	}: {
		title: string;
		description?: string;
		icon?: Snippet;
		actions?: Snippet;
		size?: 'page' | 'inline';
	} = $props();
</script>

{#if size === 'inline'}
	<div class="rounded-[var(--r-group)] bg-muted/60 px-5 py-8 text-center">
		<p class="font-medium">{title}</p>
		{#if description}<p class="mt-1 text-sm text-muted-foreground">{description}</p>{/if}
		{#if actions}<div class="mt-4 flex flex-wrap justify-center gap-2">
				{@render actions()}
			</div>{/if}
	</div>
{:else}
	<div class="empty-state">
		{#if icon}
			<div
				class="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground"
			>
				{@render icon()}
			</div>
		{/if}
		<h2 class="text-2xl font-semibold tracking-tight">{title}</h2>
		{#if description}
			<p class="max-w-md text-base leading-relaxed text-muted-foreground">{description}</p>
		{/if}
		{#if actions}
			<div class="mt-3 flex flex-wrap gap-2">
				{@render actions()}
			</div>
		{/if}
	</div>
{/if}
