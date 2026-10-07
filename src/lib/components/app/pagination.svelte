<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';

	/**
	 * Previous/Next for a paged list. Pass an address for link navigation or a function for
	 * in-place paging. Both buttons always render; unavailable ones are disabled.
	 */
	let {
		page,
		totalPages,
		label,
		previous,
		next
	}: {
		page: number;
		totalPages: number;
		label: string;
		previous?: string | null | (() => void);
		next?: string | null | (() => void);
	} = $props();

	const hasPrevious = $derived(Boolean(previous) && page > 1);
	const hasNext = $derived(Boolean(next) && page < totalPages);
</script>

{#if totalPages > 1}
	<nav aria-label={label} class="flex flex-wrap items-center justify-between gap-3">
		<Button
			variant="outline"
			href={typeof previous === 'string' ? previous : undefined}
			onclick={typeof previous === 'function' ? previous : undefined}
			disabled={!hasPrevious}>Previous</Button
		>
		<span class="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
		<Button
			variant="outline"
			href={typeof next === 'string' ? next : undefined}
			onclick={typeof next === 'function' ? next : undefined}
			disabled={!hasNext}>Next</Button
		>
	</nav>
{/if}
