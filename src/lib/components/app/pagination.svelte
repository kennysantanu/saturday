<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	/**
	 * Previous/Next for a paged list. Pass an address for link navigation or a function for
	 * in-place paging. Both buttons always render; unavailable ones are disabled.
	 */
	let {
		page,
		totalPages,
		label,
		previous,
		next,
		compact = false
	}: {
		page: number;
		totalPages: number;
		label: string;
		previous?: string | null | (() => void);
		next?: string | null | (() => void);
		compact?: boolean;
	} = $props();

	const hasPrevious = $derived(Boolean(previous) && page > 1);
	const hasNext = $derived(Boolean(next) && page < totalPages);
</script>

{#if totalPages > 1}
	<nav aria-label={label} class="flex flex-wrap items-center justify-between gap-3">
		<Button
			variant="outline"
			size={compact ? 'icon' : 'default'}
			aria-label={compact ? 'Previous page' : undefined}
			title={compact ? 'Previous page' : undefined}
			href={typeof previous === 'string' ? previous : undefined}
			onclick={typeof previous === 'function' ? previous : undefined}
			disabled={!hasPrevious}
			>{#if compact}<ChevronLeft aria-hidden="true" />{:else}Previous{/if}</Button
		>
		<span class="text-sm text-muted-foreground" aria-label={`Page ${page} of ${totalPages}`}
			>{compact ? `${page} / ${totalPages}` : `Page ${page} of ${totalPages}`}</span
		>
		<Button
			variant="outline"
			size={compact ? 'icon' : 'default'}
			aria-label={compact ? 'Next page' : undefined}
			title={compact ? 'Next page' : undefined}
			href={typeof next === 'string' ? next : undefined}
			onclick={typeof next === 'function' ? next : undefined}
			disabled={!hasNext}
			>{#if compact}<ChevronRight aria-hidden="true" />{:else}Next{/if}</Button
		>
	</nav>
{/if}
