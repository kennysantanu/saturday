<script lang="ts">
	import type { Tag } from '$lib/tag-types';
	import TagChip from './tag-chip.svelte';
	/**
	 * A wrapping row of tags. Beyond `limit` (and beyond `wideLimit` from 48rem up) the rest collapse
	 * into a neutral "+N" chip whose tooltip and screen-reader text list the hidden names.
	 */
	let {
		tags = [],
		limit = 2,
		wideLimit = limit
	}: { tags?: Tag[]; limit?: number; wideLimit?: number } = $props();
	const names = (from: number) => tags.slice(from).map((tag) => tag.display_name);
	const split = $derived(wideLimit > limit);
</script>

{#snippet more(from: number, cls: string)}
	<span class={`tag-more ${cls}`} title={names(from).join(', ')}
		><span aria-hidden="true">+{tags.length - from}</span><span class="sr-only"
			>{tags.length - from} more {tags.length - from === 1 ? 'tag' : 'tags'}: {names(from).join(
				', '
			)}</span
		></span
	>
{/snippet}

{#if tags.length}<div class="flex min-w-0 flex-wrap items-center gap-2" aria-label="Tags">
		{#each tags.slice(0, wideLimit) as tag, index (tag.id)}
			<span class="max-w-full min-w-0" class:wide-only={split && index >= limit}
				><TagChip {tag} /></span
			>
		{/each}
		{#if tags.length > limit}{@render more(limit, split ? 'narrow-only' : '')}{/if}
		{#if split && tags.length > wideLimit}{@render more(wideLimit, 'wide-only')}{/if}
	</div>{/if}

<style>
	.tag-more {
		display: inline-flex;
		align-items: center;
		min-height: 1.75rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--r-control);
		background: var(--muted);
		color: var(--muted-foreground);
		font-size: 0.8125rem;
		font-weight: 500;
		line-height: 1.3;
	}
	@media (width < 48rem) {
		.wide-only {
			display: none;
		}
	}
	@media (width >= 48rem) {
		.narrow-only {
			display: none;
		}
	}
</style>
