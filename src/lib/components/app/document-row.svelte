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
	<span class="list-row-icon" aria-hidden="true">{@render icon()}</span>
	<div class="list-row-body">
		{@render title()}
		{#if meta}<p class="list-row-meta">{@render meta()}</p>{/if}
	</div>
	{#if actions}
		<div class="list-row-actions">{@render actions()}</div>
	{/if}
</div>
