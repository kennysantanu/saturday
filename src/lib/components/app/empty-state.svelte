<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		icon,
		actions
	}: {
		title: string;
		description?: string;
		icon?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

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
