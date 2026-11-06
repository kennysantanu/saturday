<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The shared "nothing matched" line for pickers and dialogs: "No matching people. <hint>".
	 * Page-level lists use EmptyState instead. `children` can hold a link such as Add a job.
	 */
	let { noun, hint, children }: { noun: string; hint?: string; children?: Snippet } = $props();
</script>

<p class="text-sm text-muted-foreground">
	No matching {noun}.{#if hint}&nbsp;{hint}{/if}{#if children}&nbsp;{@render children()}{/if}
</p>
