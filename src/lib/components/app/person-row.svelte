<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import DueBadge from './due-badge.svelte';
	import { formatDate, initialOf } from '$lib/format';

	let {
		href,
		recordNumber,
		name,
		role,
		organization,
		followUpDate,
		latestInteractionDate,
		today
	}: {
		href: string;
		recordNumber: number;
		name: string;
		role?: string | null;
		organization?: string | null;
		followUpDate?: string | null;
		latestInteractionDate?: string | null;
		today: string;
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
	</div>
	<div class="list-row-status">
		{#if followUpDate}
			<span><span class="sr-only">Follow-up: </span><DueBadge date={followUpDate} {today} /></span>
		{:else}
			<span class="meta-text text-muted-foreground">No follow-up scheduled</span>
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
