<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A list item that has several actions of its own, so the row itself is not a link. */
	let {
		icon,
		title,
		meta,
		actions
	}: { icon: Snippet; title: Snippet; meta?: Snippet; actions?: Snippet } = $props();
</script>

<div class="list-row" data-static>
	<div class="row-mark" aria-hidden="true">{@render icon()}</div>
	<div class="list-row-title min-w-0">
		{@render title()}
		{#if meta}<p class="mt-1 text-sm text-muted-foreground">{@render meta()}</p>{/if}
	</div>
	{#if actions}
		<div class="list-row-status">{@render actions()}</div>
	{/if}
</div>
