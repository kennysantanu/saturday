<script lang="ts">
	import Bot from '@lucide/svelte/icons/bot';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Pencil from '@lucide/svelte/icons/pencil';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { formatDate } from '$lib/format';
	import { cn } from '$lib/utils.js';

	type Entry = {
		id: number;
		date: string;
		stageId: number | null;
		isArchived?: boolean;
		label: string;
		note: string | null;
		createdVia: 'manual' | 'mcp';
	};
	let {
		entries,
		onedit,
		scheduled = false
	}: {
		entries: Entry[];
		onedit: (entry: Entry) => void;
		/** True for future-dated entries: hollow marker and a Scheduled badge. */
		scheduled?: boolean;
	} = $props();
</script>

<ol class={cn('space-y-6 border-l pl-5', scheduled ? 'border-primary/30' : 'border-border')}>
	{#each entries as entry (entry.id)}
		<li class="relative">
			<span
				class={cn(
					'absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full ring-4 ring-card',
					scheduled ? 'border-2 border-primary bg-card' : 'bg-primary'
				)}
				aria-hidden="true"
			></span>
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0 space-y-1">
					<p class="flex flex-wrap items-center gap-2 font-medium">
						{entry.label}{#if entry.isArchived}<Badge variant="outline">Archived</Badge>{/if}
						{#if scheduled}<Badge variant="secondary">Scheduled</Badge>{/if}
					</p>
					<p class="flex items-center gap-1.5 text-sm text-muted-foreground">
						<Calendar class="size-3.5 shrink-0" aria-hidden="true" />
						{formatDate(entry.date)}
						{#if entry.createdVia === 'mcp'}
							<span class="inline-flex items-center gap-1" title="Added by assistant">
								<Bot class="size-3.5" aria-hidden="true" />
								<span class="sr-only">Added by assistant</span>
							</span>
						{/if}
					</p>
				</div>
			</div>
			{#if entry.note}
				<p
					class="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-muted-foreground"
				>
					{entry.note}
				</p>
			{/if}
			<div class="mt-2 flex flex-wrap gap-2">
				<Button
					variant="ghost"
					size="sm"
					onclick={() => onedit(entry)}
					aria-label={`Edit history: ${entry.label} · ${formatDate(entry.date)}`}
				>
					<Pencil data-icon="inline-start" aria-hidden="true" />Edit history
				</Button>
			</div>
		</li>
	{/each}
</ol>
