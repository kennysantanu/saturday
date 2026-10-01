<script lang="ts">
	import Bot from '@lucide/svelte/icons/bot';
	import Calendar from '@lucide/svelte/icons/calendar';
	import UpdateCorrection from './update-correction.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { formatDate } from '$lib/format';
	import { cn } from '$lib/utils.js';

	type Entry = {
		id: string;
		date: string;
		eventType: string | null;
		label: string;
		note: string | null;
		createdVia: 'manual' | 'mcp';
	};
	let {
		entries,
		scheduled = false,
		errors = {},
		values = {}
	}: {
		entries: Entry[];
		/** True for future-dated entries: hollow marker and a Scheduled badge. */
		scheduled?: boolean;
		errors?: Record<string, string | undefined>;
		values?: Record<string, string | undefined>;
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
						{entry.label}
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
				{#if entry.eventType !== 'dismissed' && entry.eventType !== 'reopened'}
					<UpdateCorrection {entry} {errors} {values} />
				{/if}
			</div>
			{#if entry.note}
				<p
					class="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-muted-foreground"
				>
					{entry.note}
				</p>
			{/if}
		</li>
	{/each}
</ol>
