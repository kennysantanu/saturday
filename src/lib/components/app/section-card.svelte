<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { cn } from '$lib/utils.js';

	/** A titled card: heading with optional count and description, header actions, then content. */
	let {
		id,
		title,
		count,
		description,
		action,
		children,
		class: className,
		contentClass
	}: {
		id?: string;
		title: string;
		count?: number;
		description?: string;
		action?: Snippet;
		children: Snippet;
		class?: string;
		contentClass?: string;
	} = $props();
</script>

<Card.Root {id} class={className}>
	<Card.Header class="flex flex-row flex-wrap items-start justify-between gap-3">
		<div class="min-w-0 space-y-1">
			<h2 data-slot="card-title" class="text-base leading-snug font-medium">
				{title}{#if count !== undefined}
					<span class="ml-1 text-muted-foreground">({count})</span>{/if}
			</h2>
			{#if description}<p class="text-sm text-muted-foreground">{description}</p>{/if}
		</div>
		{#if action}<div class="flex flex-wrap items-center gap-2">{@render action()}</div>{/if}
	</Card.Header>
	<Card.Content class={cn('space-y-4', contentClass)}>{@render children()}</Card.Content>
</Card.Root>
