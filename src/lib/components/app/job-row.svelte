<script lang="ts">
	import TagList from './tag-list.svelte';
	import type { Tag } from '$lib/tag-types';
	import { formatReminder } from '$lib/format';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Star from '@lucide/svelte/icons/star';
	import Bell from '@lucide/svelte/icons/bell';
	import StatusBadge from './status-badge.svelte';
	import type { StatusInfo } from '$lib/status';

	let {
		tags = [],
		href,
		recordNumber,
		title,
		company,
		status,
		latestUpdate,
		isStarred = false,
		nextReminder = null,
		score = null
	}: {
		tags?: Tag[];
		href: string;
		recordNumber: number;
		title: string;
		company: string;
		status: StatusInfo;
		latestUpdate: string;
		isStarred?: boolean;
		nextReminder?: string | null;
		score?: number | null;
	} = $props();
	// The badge already names the current stage; say "Updated" when the latest entry repeats it.
	const updateText = $derived(
		latestUpdate.startsWith(`${status.label} · `)
			? `Updated ${latestUpdate.slice(status.label.length + 3)}`
			: latestUpdate
	);
</script>

<a {href} class="list-row group">
	<div class="list-row-body">
		<div class="list-row-head">
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
			<StatusBadge {status} />
		</div>
		<div class="list-row-meta">
			<span class="list-row-primary">{company}</span>
			<span>{updateText}</span>
			{#if nextReminder}<span class="inline-flex items-center gap-1"
					><Bell class="size-3.5" aria-hidden="true" /><span class="sr-only"
						>Reminder:
					</span>{formatReminder(nextReminder)}</span
				>{/if}
			{#if score !== null}<span
					><span aria-hidden="true">Score {score}</span><span class="sr-only"
						>Assistant score: {score}</span
					></span
				>{/if}
			<span class="list-row-tags"><TagList {tags} wideLimit={3} /></span>
		</div>
	</div>
	<ChevronRight
		class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
		aria-hidden="true"
	/>
</a>
