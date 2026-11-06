<script lang="ts">
	import { tagColorPattern } from '$lib/tags.js';
	import type { Tag } from '$lib/tag-types';
	let { tag }: { tag: Tag } = $props();
	const color = $derived(tagColorPattern.test(tag.color) ? tag.color : '#64748b');
</script>

<span class="tag-chip tag-tint" style:--tag={color} title={tag.display_name}>
	<span class="tag-dot" aria-hidden="true"></span>
	<span class="tag-label">{tag.display_name}{tag.unavailable ? ' · Unavailable' : ''}</span>
</span>

<style>
	.tag-chip {
		display: inline-flex;
		align-items: center;
		max-width: 100%;
		min-width: 0;
		border-radius: var(--r-control);
		padding: 0.25rem 0.625rem;
		gap: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.3;
		font-weight: 500;
		vertical-align: middle;
	}
	.tag-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
</style>
