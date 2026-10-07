<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	/**
	 * Every page's outer frame: one vertical rhythm and the document title, "{title} · Saturday".
	 * Use `width="form"` for add and edit forms.
	 */
	let {
		title,
		width = 'full',
		children
	}: { title: string; width?: 'full' | 'form'; children: Snippet } = $props();
</script>

<svelte:head><title>{title} · Saturday</title></svelte:head>

<div class={cn('space-y-8', width === 'form' && 'mx-auto max-w-2xl')}>
	{@render children()}
</div>
