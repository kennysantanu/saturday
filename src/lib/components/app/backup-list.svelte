<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { formatDateTime } from '$lib/format';

	type Item = {
		id: string;
		kind: string;
		createdAt: string;
		detail: string;
		href: string;
		filename: string;
		paired?: boolean;
	};

	/** Saved backups as rows: kind, when, what it holds, and a download link. */
	let {
		title,
		items,
		note,
		extra
	}: { title: string; items: Item[]; note?: string; extra?: Snippet<[Item]> } = $props();
</script>

{#if items.length}
	<div class="space-y-2">
		<h3 class="font-medium">{title}</h3>
		<ul class="divide-y">
			{#each items as item (item.id)}
				<li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-sm">
					<div class="min-w-0 space-y-1">
						<p class="flex flex-wrap items-center gap-2 font-medium">
							{formatDateTime(item.createdAt)}
							<Badge variant="secondary" class="capitalize">{item.kind}</Badge>
							{#if item.paired}<Badge variant="outline">Paired</Badge>{/if}
						</p>
						<p class="text-muted-foreground">{item.detail}</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						{#if extra}{@render extra(item)}{/if}
						<a class="link" href={item.href}
							>Download<span class="sr-only"> {item.filename}</span></a
						>
					</div>
				</li>
			{/each}
		</ul>
		{#if note}<p class="meta-text text-muted-foreground">{note}</p>{/if}
	</div>
{/if}
