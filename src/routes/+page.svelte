<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import JobRow from '$lib/components/app/job-row.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { relativeDay } from '$lib/format';
	import { DASHBOARD_CARDS } from '$lib/status';
	let { data } = $props();

	const isEmpty = $derived(data.recentJobs.length === 0);
	const history = DASHBOARD_CARDS.filter((card) => card.group === 'history');
	// Steps in the order a job moves through them; the two endings are shown separately.
	const steps = history.filter((card) => !['rejected', 'dismissed'].includes(card.key));
	const endings = history.filter((card) => ['rejected', 'dismissed'].includes(card.key));
	const widest = $derived(Math.max(1, ...steps.map((card) => data.stats[card.key])));
	const barWidth = (count: number) => (count === 0 ? 0 : Math.max(3, (count / widest) * 100));
</script>

<svelte:head><title>Dashboard · Saturday</title></svelte:head>

<div class="space-y-10">
	<PageHeader title="Dashboard" description="Your search, at a glance.">
		{#snippet actions()}
			{#if !isEmpty}
				<Button href="/jobs/new" size="lg">
					<Plus data-icon="inline-start" />
					Add job
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if isEmpty}
		<EmptyState
			title="Welcome to Saturday"
			description="Add the first job you are interested in. You can record progress yourself, or let a connected assistant do it."
		>
			{#snippet icon()}<Briefcase class="size-5" />{/snippet}
			{#snippet actions()}
				<Button href="/jobs/new" size="lg">
					<Plus data-icon="inline-start" />
					Add job
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<a href="/jobs" class="activity-summary">
			<div class="flex items-center gap-6">
				<p class="activity-count">{data.stats.active}</p>
				<div class="space-y-1">
					<h2 class="text-lg font-semibold">Active now</h2>
					<p class="text-sm">Jobs you’re still pursuing</p>
				</div>
			</div>
			<ArrowUpRight class="size-5 shrink-0" aria-hidden="true" />
		</a>

		{#if data.upcoming.length > 0}
			<section aria-labelledby="upcoming-heading" class="space-y-3">
				<h2 id="upcoming-heading" class="section-title">Coming up</h2>
				<Card.Root class="gap-0 divide-y divide-border p-0">
					{#each data.upcoming as item (item.id)}
						<a href="/jobs/{item.jobId}" class="job-row group">
							<div class="company-mark" aria-hidden="true"><CalendarDays class="size-5" /></div>
							<div class="job-row-title min-w-0">
								<p class="font-semibold">{item.label}</p>
								<p class="mt-1 text-sm text-muted-foreground">{item.title} · {item.company}</p>
							</div>
							<div class="job-row-status">
								<Badge variant="secondary">{relativeDay(item.date, data.today)}</Badge>
							</div>
							<ChevronRight
								class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
								aria-hidden="true"
							/>
						</a>
					{/each}
				</Card.Root>
			</section>
		{/if}

		<section aria-labelledby="history-heading" class="space-y-3">
			<div class="space-y-0.5">
				<h2 id="history-heading" class="section-title">Progress so far</h2>
				<p class="text-sm text-muted-foreground">
					Jobs that reached each step, including inactive jobs. A job can count at several steps.
					Select a step to see its jobs.
				</p>
			</div>
			<div class="funnel">
				{#each steps as card (card.key)}
					<a href="/jobs?step={card.key}" class="funnel-row">
						<span class="funnel-label text-sm font-medium">{card.label}</span>
						<span class="funnel-count">{data.stats[card.key]}</span>
						<span class="funnel-track" aria-hidden="true">
							<span class="funnel-bar" style="width: {barWidth(data.stats[card.key])}%"></span>
						</span>
					</a>
				{/each}
			</div>
			<div class="history-grid">
				{#each endings as card (card.key)}
					<a href="/jobs?step={card.key}" class="history-stat">
						<p class="text-sm text-muted-foreground">{card.label}</p>
						<p class="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
							{data.stats[card.key]}
						</p>
					</a>
				{/each}
			</div>
		</section>

		<section aria-labelledby="recent-heading" class="space-y-3">
			<div class="flex flex-wrap items-baseline justify-between gap-3">
				<h2 id="recent-heading" class="section-title">Recently updated</h2>
				<a href="/jobs" class="text-sm font-medium text-primary hover:underline">View all jobs</a>
			</div>
			<Card.Root class="gap-0 divide-y divide-border p-0">
				{#each data.recentJobs as job (job.id)}
					<JobRow
						href={`/jobs/${job.id}`}
						title={job.title}
						company={job.company}
						status={job.status}
						latestUpdate={job.latestUpdate}
					/>
				{/each}
			</Card.Root>
		</section>
	{/if}
</div>
