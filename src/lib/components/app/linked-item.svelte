<script lang="ts">
	import type { Snippet } from 'svelte';

	/** One linked record inside a card: a link, a subtitle, an optional note, then its actions. */
	let {
		href,
		title,
		subtitle,
		note,
		actions
	}: {
		href: string;
		title: string;
		subtitle?: string;
		note?: string | null;
		actions?: Snippet;
	} = $props();
</script>

<div class="space-y-3 border-b pb-4 last:border-0 last:pb-0">
	<div class="min-w-0">
		<a class="link break-words" {href}>{title}</a>
		{#if subtitle}<p class="text-sm break-words text-muted-foreground">{subtitle}</p>{/if}
	</div>
	{#if note}
		<p class="text-sm break-words whitespace-pre-wrap">
			<span class="text-muted-foreground">Relationship note:</span>{' '}{note}
		</p>
	{/if}
	{#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
</div>
