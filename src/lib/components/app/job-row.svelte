<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import StatusBadge from './status-badge.svelte';
	import type { StatusInfo } from '$lib/status';

	let {
		href,
		title,
		company,
		status,
		latestUpdate
	}: {
		href: string;
		title: string;
		company: string;
		status: StatusInfo;
		latestUpdate: string;
	} = $props();
</script>

<a {href} class="job-row group">
	<div class="company-mark" aria-hidden="true">{company.slice(0, 1).toLocaleUpperCase()}</div>
	<div class="job-row-title min-w-0">
		<p class="font-semibold">{title}</p>
		<p class="mt-1 text-sm text-muted-foreground">{company}</p>
	</div>
	<div class="job-row-status">
		<StatusBadge {status} />
		<span class="text-[0.8125rem] text-muted-foreground">{latestUpdate}</span>
	</div>
	<ChevronRight
		class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
	/>
</a>
