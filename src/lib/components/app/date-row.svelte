<script lang="ts">
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import DueBadge from './due-badge.svelte';

	/** A dated item on the Dashboard that links to its job. */
	let {
		href,
		title,
		subtitle,
		comment,
		date,
		today
	}: {
		href: string;
		title: string;
		subtitle: string;
		comment?: string | null;
		date: string;
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
		<DueBadge {date} {today} />
	</div>
	<ChevronRight
		class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
		aria-hidden="true"
	/>
</a>
