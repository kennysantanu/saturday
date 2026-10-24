<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { tagTextColor, tagColorPattern } from '$lib/tags.js';
	import type { Tag } from '$lib/tag-types';
	let { tag, onremove }: { tag: Tag; onremove?: () => void } = $props();
	const color = $derived(tagColorPattern.test(tag.color) ? tag.color : '#64748b');
</script>

<span
	class="tag-chip"
	class:removable={!!onremove}
	style:background-color={color}
	style:color={tagTextColor(color)}
	title={tag.display_name}
>
	<span class="tag-label">{tag.display_name}{tag.unavailable ? ' · Unavailable' : ''}</span>
	{#if onremove}<button
			type="button"
			onclick={onremove}
			aria-label={`Remove ${tag.display_name}`}
			title={`Remove ${tag.display_name}`}><X class="size-4" aria-hidden="true" /></button
		>{/if}
</span>

<style>
	.tag-chip {
		display: inline-flex;
		align-items: center;
		max-width: 100%;
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: var(--r-control);
		padding: 0.25rem 0.625rem;
		gap: 0.25rem;
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
	.removable {
		padding-block: 0;
		min-height: 44px;
		padding-right: 0;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		flex-shrink: 0;
		border-radius: var(--r-control);
		cursor: pointer;
	}
	button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (forced-colors: active) {
		.tag-chip {
			background: Canvas !important;
			color: CanvasText !important;
			border-color: CanvasText;
		}
	}
</style>
