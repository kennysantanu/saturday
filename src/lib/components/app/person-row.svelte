<script lang="ts">
	import TagList from './tag-list.svelte';
	import type { Tag } from '$lib/tag-types';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ReminderBadge from './reminder-badge.svelte';
	import { formatDate } from '$lib/format';

	let {
		tags = [],
		href,
		recordNumber,
		name,
		role,
		organization,
		nextReminder,
		latestInteractionDate,
		today,
		now
	}: {
		tags?: Tag[];
		href: string;
		recordNumber: number;
		name: string;
		role?: string | null;
		organization?: string | null;
		nextReminder?: string | null;
		latestInteractionDate?: string | null;
		today: string;
		now?: string;
	} = $props();
</script>

<a {href} class="list-row group">
	<div class="list-row-body">
		<div class="list-row-head">
			<p class="font-semibold">
				{name}
				<span
					class="meta-text ml-2 font-normal whitespace-nowrap text-muted-foreground"
					aria-label={`Person number ${recordNumber}`}>#{recordNumber}</span
				>
			</p>
			{#if nextReminder}
				<span
					><span class="sr-only">Reminder: </span><ReminderBadge
						schedule={nextReminder}
						now={now ?? today + 'T00:00'}
					/></span
				>
			{/if}
		</div>
		{#if role || organization || latestInteractionDate || tags.length}
			<div class="list-row-meta">
				{#if role || organization}<span class="list-row-primary"
						>{[role, organization].filter(Boolean).join(' · ')}</span
					>{/if}
				{#if latestInteractionDate}<span>Last contact: {formatDate(latestInteractionDate)}</span
					>{/if}
				<span class="list-row-tags"><TagList {tags} wideLimit={3} /></span>
			</div>
		{/if}
	</div>
	<ChevronRight
		class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
		aria-hidden="true"
	/>
</a>
