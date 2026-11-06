<script lang="ts">
	import TagList from './tag-list.svelte';
	import type { Tag } from '$lib/tag-types';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ReminderBadge from './reminder-badge.svelte';
	import { formatDate, initialOf } from '$lib/format';

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
	<div class="row-mark" aria-hidden="true">{initialOf(name)}</div>
	<div class="list-row-title min-w-0">
		<p class="font-semibold">
			{name}
			<span
				class="meta-text ml-2 font-normal whitespace-nowrap text-muted-foreground"
				aria-label={`Person number ${recordNumber}`}>#{recordNumber}</span
			>
		</p>
		{#if role || organization}
			<p class="mt-1 text-sm text-muted-foreground">
				{[role, organization].filter(Boolean).join(' · ')}
			</p>
		{/if}
		<TagList {tags} wideLimit={3} />
	</div>
	<div class="list-row-status">
		{#if nextReminder}
			<span
				><span class="sr-only">Reminder: </span><ReminderBadge
					schedule={nextReminder}
					now={now ?? today + 'T00:00'}
				/></span
			>
		{:else}
			<span class="meta-text text-muted-foreground">No active reminders</span>
		{/if}
		<span class="meta-text text-muted-foreground"
			>Last contact: {latestInteractionDate
				? formatDate(latestInteractionDate)
				: 'None recorded'}</span
		>
	</div>
	<ChevronRight
		class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
		aria-hidden="true"
	/>
</a>
