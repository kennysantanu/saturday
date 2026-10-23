<script lang="ts">
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ReminderBadge from './reminder-badge.svelte';
	import DueBadge from './due-badge.svelte';

	/** A dated item on the Dashboard that links to its job. */
	let {
		href,
		title,
		subtitle,
		comment,
		date,
		schedule,
		now,
		today
	}: {
		href: string;
		title: string;
		subtitle: string;
		comment?: string | null;
		date: string;
		schedule?: string;
		now?: string;
		today: string;
	} = $props();
</script>

<a {href} class="list-row group">
	<div class="row-mark" aria-hidden="true"><CalendarDays class="size-5" /></div>
	<div class="list-row-title min-w-0">
		<p class="font-semibold">{title}</p>
		<p class="mt-1 text-sm text-muted-foreground">{subtitle}</p>
		{#if comment}
			<p class="mt-1 text-sm break-words whitespace-pre-wrap text-muted-foreground">{comment}</p>
		{/if}
	</div>
	<div class="list-row-status">
		{#if schedule}<ReminderBadge {schedule} now={now ?? ''} />{:else}<DueBadge
				{date}
				{today}
			/>{/if}
	</div>
	<ChevronRight
		class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
		aria-hidden="true"
	/>
</a>
