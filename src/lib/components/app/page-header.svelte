<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	let {
		title,
		recordNumber,
		description,
		eyebrow,
		back,
		leading,
		meta,
		actions
	}: {
		title: string;
		recordNumber?: number;
		description?: string;
		eyebrow?: string;
		/** Link to the page this one belongs to, shown above the title as "Back to …". */
		back?: { href: string; label: string };
		/** Optional compact visual beside the title, such as a job's assistant score. */
		leading?: Snippet;
		/** Status or attribution shown with the title, such as a badge row. */
		meta?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<div class="space-y-4">
	{#if back}
		<a href={back.href} class="back-link"><ArrowLeft class="size-4" />Back to {back.label}</a>
	{/if}
	<header class="page-header">
		<div class="max-w-full min-w-0 space-y-3">
			<div class="page-title-row">
				{#if leading}{@render leading()}{/if}
				<div class="page-title-copy min-w-0 space-y-1">
					<h1 class="page-title">
						{title}{#if recordNumber}
							<span
								class="ml-2 text-base font-normal whitespace-nowrap text-muted-foreground"
								aria-label={`Record number ${recordNumber}`}>#{recordNumber}</span
							>{/if}
					</h1>
					{#if eyebrow}
						<p class="text-sm font-medium text-muted-foreground">{eyebrow}</p>
					{/if}
					{#if description}
						<p class="max-w-prose text-base text-muted-foreground">{description}</p>
					{/if}
				</div>
			</div>
			{#if meta}
				<div class="page-meta flex flex-wrap items-center gap-2">
					{@render meta()}
				</div>
			{/if}
		</div>
		{#if actions}
			<div class="page-actions">
				{@render actions()}
			</div>
		{/if}
	</header>
</div>
