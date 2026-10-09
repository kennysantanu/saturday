<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Star from '@lucide/svelte/icons/star';
	import StatusBadge from './status-badge.svelte';
	import { initialOf } from '$lib/format';
	import type { StatusInfo } from '$lib/status';

	let {
		href,
		recordNumber,
		title,
		company,
		status,
		latestUpdate,
		isStarred = false,
		score = null
	}: {
		href: string;
		recordNumber: number;
		title: string;
		company: string;
		status: StatusInfo;
		latestUpdate: string;
		isStarred?: boolean;
		score?: number | null;
	} = $props();
</script>

<a {href} class="list-row group">
	<div class="row-mark" aria-hidden="true">{initialOf(company)}</div>
	<div class="list-row-title min-w-0">
		<p class="font-semibold">
			{#if isStarred}<Star class="mr-1 inline size-4 fill-current text-primary" /><span
					class="sr-only"
					>Starred:
				</span>{/if}{title}
			<span
				class="meta-text ml-2 font-normal whitespace-nowrap text-muted-foreground"
				aria-label={`Job number ${recordNumber}`}>#{recordNumber}</span
			>
		</p>
		<p class="mt-1 text-sm text-muted-foreground">{company}</p>
	</div>
	<div class="list-row-status">
		<StatusBadge {status} />
		{#if score !== null}<span class="meta-text text-muted-foreground">Assistant score: {score}</span
			>{/if}
		<span class="meta-text text-muted-foreground">{latestUpdate}</span>
	</div>
	<ChevronRight
		class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
	/>
</a>
