<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Bell from '@lucide/svelte/icons/bell';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Clock from '@lucide/svelte/icons/clock';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import DateRow from '$lib/components/app/date-row.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import JobRow from '$lib/components/app/job-row.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { DASHBOARD_CARDS } from '$lib/status';
	let { data } = $props();

	const isEmpty = $derived(data.recentJobs.length === 0);
	const history = DASHBOARD_CARDS.filter((card) => card.group === 'history');
	// Steps in the order a job moves through them; the two endings are shown separately.
	const steps = history.filter((card) => !['rejected', 'dismissed'].includes(card.key));
	const endings = history.filter((card) => ['rejected', 'dismissed'].includes(card.key));
	const widest = $derived(Math.max(1, ...steps.map((card) => data.stats[card.key])));
	const barWidth = (count: number) => (count === 0 ? 0 : Math.max(3, (count / widest) * 100));
	const endingIcons = { rejected: CircleX, dismissed: EyeOff };
	const attentionGroups = $derived(
		[
			{ key: 'follow-ups', label: 'Follow-ups', items: data.followUps },
			{ key: 'deadlines', label: 'Application deadlines', items: data.deadlines }
		].filter((group) => group.items.length > 0)
	);
	const attentionCount = $derived(data.followUps.length + data.deadlines.length);
	// today is a local calendar date, so build it without a time-zone shift.
	const todayLabel = $derived.by(() => {
		const [year, month, day] = data.today.split('-').map(Number);
		return new Intl.DateTimeFormat('en-US', {
			weekday: 'long',
			month: 'long',
			day: 'numeric'
		}).format(new Date(year, month - 1, day));
	});
</script>

<PageShell title="Dashboard">
	<PageHeader title="Dashboard" description={todayLabel}>
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
		<div class="activity-summary">
			<a href="/jobs" class="activity-main">
				<p class="activity-count">{data.stats.active}</p>
				<div class="space-y-1">
					<h2 class="flex items-center gap-2 text-lg font-semibold">
						Active now<ArrowUpRight class="size-5 shrink-0" aria-hidden="true" />
					</h2>
					<p class="text-sm">Jobs you’re still pursuing</p>
				</div>
			</a>
			<div class="activity-chips">
				<a href="/jobs?step=applied" class="activity-chip">
					<span class="font-semibold tabular-nums">{data.stats.applied}</span> Ever applied
				</a>
				<a href="/jobs?step=offer" class="activity-chip">
					<span class="font-semibold tabular-nums">{data.stats.offer}</span> Offers received
				</a>
			</div>
		</div>

		<div class="dashboard-layout">
			<div class="dashboard-main">
				<section aria-labelledby="attention-heading" class="dash-attention space-y-3">
					<h2 id="attention-heading" class="section-title flex items-center gap-2">
						<Bell class="size-5 text-muted-foreground" aria-hidden="true" />
						Needs attention
						<span class="font-normal text-muted-foreground">({attentionCount})</span>
					</h2>
					{#if attentionCount === 0}
						<EmptyState
							size="inline"
							title="Nothing due"
							description="No follow-ups or deadlines right now. You’re all caught up."
						/>
					{:else}
						<Card.Root class="gap-0 divide-y divide-border p-0">
							{#each attentionGroups as group (group.key)}
								<h3 class="group-title">
									{group.label}
									<span class="font-normal text-muted-foreground">({group.items.length})</span>
								</h3>
								{#each group.items as item (item.jobId)}
									<DateRow
										href="/jobs/{item.jobId}"
										title={item.title}
										subtitle={item.company}
										comment={'comment' in item ? item.comment : null}
										date={item.date}
										today={data.today}
									/>
								{/each}
							{/each}
						</Card.Root>
					{/if}
				</section>

				<section aria-labelledby="recent-heading" class="dash-recent space-y-3">
					<div class="flex flex-wrap items-baseline justify-between gap-3">
						<h2 id="recent-heading" class="section-title flex items-center gap-2">
							<Clock class="size-5 text-muted-foreground" aria-hidden="true" />
							Recently updated
						</h2>
						<a href="/jobs" class="link text-sm">View all jobs</a>
					</div>
					<Card.Root class="gap-0 divide-y divide-border p-0">
						{#each data.recentJobs as job (job.id)}
							<JobRow
								recordNumber={job.id}
								href={`/jobs/${job.id}`}
								title={job.title}
								company={job.company}
								status={job.status}
								latestUpdate={job.latestUpdate}
								isStarred={job.isStarred}
								score={job.score}
							/>
						{/each}
					</Card.Root>
				</section>
			</div>

			<div class="dashboard-side">
				{#if data.upcoming.length > 0}
					<section aria-labelledby="upcoming-heading" class="dash-upcoming space-y-3">
						<h2 id="upcoming-heading" class="section-title flex items-center gap-2">
							<CalendarClock class="size-5 text-muted-foreground" aria-hidden="true" />
							Coming up
						</h2>
						<Card.Root class="gap-0 divide-y divide-border p-0">
							{#each data.upcoming as item (item.id)}
								<DateRow
									href="/jobs/{item.jobId}"
									title={item.label}
									subtitle="{item.title} · {item.company}"
									date={item.date}
									today={data.today}
								/>
							{/each}
						</Card.Root>
					</section>
				{/if}

				<section aria-labelledby="history-heading" class="dash-progress space-y-3">
					<div class="space-y-0.5">
						<h2 id="history-heading" class="section-title flex items-center gap-2">
							<TrendingUp class="size-5 text-muted-foreground" aria-hidden="true" />
							Progress so far
						</h2>
						<p class="text-sm text-muted-foreground">
							Jobs that reached each step, including inactive ones. Counts overlap. Select a step to
							see its jobs.
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
							{@const Icon = endingIcons[card.key as keyof typeof endingIcons]}
							<a href="/jobs?step={card.key}" class="history-stat">
								<p class="flex items-center gap-2 text-sm text-muted-foreground">
									<Icon class="size-4 shrink-0" aria-hidden="true" />{card.label}
								</p>
								<p class="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
									{data.stats[card.key]}
								</p>
							</a>
						{/each}
					</div>
				</section>
			</div>
		</div>
	{/if}
</PageShell>
