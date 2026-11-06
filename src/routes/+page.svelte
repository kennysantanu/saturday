<script lang="ts">
	import { allJobsUrl, milestoneJobsUrl } from '$lib/job-search.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Bell from '@lucide/svelte/icons/bell';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import { networkDetailUrl } from '$lib/network-navigation.js';
	import DateRow from '$lib/components/app/date-row.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import JobPipeline from '$lib/components/app/job-pipeline.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { jobDetailUrl } from '$lib/job-navigation.js';
	import { page } from '$app/state';
	let { data } = $props();

	const isEmpty = $derived(data.totalJobs === 0 && data.reminders.length === 0);
	const history = $derived(
		data.stages.filter((stage: { is_archived: boolean; is_closed: boolean }) => !stage.is_archived)
	);
	const archivedHistory = $derived(
		data.stages.filter((stage: { is_archived: boolean }) => stage.is_archived)
	);

	const attentionGroups = $derived(
		[{ key: 'deadlines', label: 'Application deadlines', items: data.deadlines }].filter(
			(group) => group.items.length > 0
		)
	);
	const attentionCount = $derived(data.reminders.length + data.deadlines.length);
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
				<Button href={'/jobs/new?return_to=' + encodeURIComponent('/')} size="lg">
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
				<Button href={'/jobs/new?return_to=' + encodeURIComponent('/')} size="lg">
					<Plus data-icon="inline-start" />
					Add job
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<section id="job-pipeline" aria-labelledby="pipeline-heading" class="min-w-0 space-y-4">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div class="space-y-1">
					<h2 id="pipeline-heading" class="section-title">Job pipeline</h2>
					<p class="text-sm text-muted-foreground">
						Where each job is now, most recently updated first.
					</p>
				</div>
				<a href={allJobsUrl()} class="link text-sm">View all jobs</a>
			</div>
			{#if data.errors.pipeline}
				<Notice tone="error" title="Job pipeline unavailable">{data.errors.pipeline}</Notice>
			{:else}
				<JobPipeline columns={data.pipeline} />
			{/if}
		</section>
		<div class="dashboard-overview">
			<section aria-labelledby="notifications-heading" class="min-w-0 space-y-6">
				<div class="space-y-1">
					<h2 id="notifications-heading" class="section-title flex items-center gap-2">
						<Bell class="size-5 text-muted-foreground" aria-hidden="true" />Notifications
					</h2>
					<p class="text-sm text-muted-foreground">
						Job and person reminders, application deadlines and upcoming milestones.
					</p>
				</div>
				<section aria-labelledby="attention-heading" class="dash-attention space-y-3">
					<h3 id="attention-heading" class="section-title flex items-center gap-2">
						Needs attention
						<span class="font-normal text-muted-foreground"
							>({data.errors.attention ? 'Unavailable' : attentionCount})</span
						>
					</h3>
					{#if data.errors.attention}
						<Notice tone="error" title="Needs attention unavailable">{data.errors.attention}</Notice
						>
					{:else if attentionCount === 0}
						<EmptyState
							size="inline"
							title="Nothing due"
							description="No reminders or deadlines right now. You’re all caught up."
						/>
					{:else}
						<Card.Root class="gap-0 divide-y divide-border p-0">
							{#if data.reminders.length}<h4 class="group-title">
									Reminders <span class="font-normal text-muted-foreground"
										>({data.reminders.length})</span
									>
								</h4>{/if}
							{#each data.reminders as item (item.id)}
								<DateRow
									href={(item.job_id
										? jobDetailUrl(item.job_id, page.url.pathname + page.url.search)
										: networkDetailUrl(item.network_id, page.url.pathname + page.url.search)) +
										'#reminders'}
									title={item.job_title ?? item.person_name ?? 'Reminder'}
									subtitle={item.job_id
										? `${item.company_name}${item.job_closed ? ' · Closed job' : ''}`
										: 'Network'}
									comment={item.note}
									date={item.scheduled_at.slice(0, 10)}
									schedule={item.scheduled_at}
									now={data.now}
									today={data.today}
								/>
							{/each}
							{#each attentionGroups as group (group.key)}
								<h4 class="group-title">
									{group.label}
									<span class="font-normal text-muted-foreground">({group.items.length})</span>
								</h4>
								{#each group.items as item (item.jobId)}
									<DateRow
										href={jobDetailUrl(item.jobId, page.url.pathname + page.url.search)}
										title={item.title}
										subtitle={`${item.company} · ${item.stage}`}
										comment={'comment' in item ? item.comment : null}
										date={item.date}
										today={data.today}
									/>
								{/each}
							{/each}
						</Card.Root>
					{/if}
				</section>
				{#if data.errors.upcoming || data.upcoming.length > 0}
					<section aria-labelledby="upcoming-heading" class="dash-upcoming space-y-3">
						<h3 id="upcoming-heading" class="section-title flex items-center gap-2">
							<CalendarClock class="size-5 text-muted-foreground" aria-hidden="true" />
							Coming up
						</h3>
						{#if data.errors.upcoming}
							<Notice tone="error" title="Coming up unavailable">{data.errors.upcoming}</Notice>
						{:else}
							<Card.Root class="gap-0 divide-y divide-border p-0">
								{#each data.upcoming as item (item.id)}
									<DateRow
										href={jobDetailUrl(item.jobId, page.url.pathname + page.url.search)}
										title={item.label}
										subtitle="{item.title} · {item.company} · {item.stage}"
										date={item.date}
										today={data.today}
									/>
								{/each}
							</Card.Root>
						{/if}
					</section>
				{/if}
			</section>
			<section aria-labelledby="history-heading" class="min-w-0 space-y-3">
				<div class="space-y-1">
					<h2 id="history-heading" class="section-title flex items-center gap-2">
						<TrendingUp class="size-5 text-muted-foreground" aria-hidden="true" />Milestone history
					</h2>
					<p class="text-sm text-muted-foreground">
						Jobs with each milestone, including closed jobs and scheduled milestones. Counts overlap
						and are separate from current placement.
					</p>
				</div>
				{#if data.errors.history}
					<Notice tone="error" title="Milestone history unavailable">{data.errors.history}</Notice>
				{:else}
					<div class="milestone-counts">
						{#each history as stage (stage.id)}
							<a href={milestoneJobsUrl(stage.id)} class="milestone-count"
								><span
									>{stage.name}{#if stage.is_closed}<span
											class="meta-text ml-2 text-muted-foreground">Closed</span
										>{/if}</span
								><strong class="tabular-nums">{stage.history_count}</strong></a
							>
						{/each}
					</div>
					{#if archivedHistory.length}
						<details class="disclosure">
							<summary>Archived milestones</summary>
							<div class="disclosure-body milestone-counts">
								{#each archivedHistory as stage (stage.id)}
									<a href={milestoneJobsUrl(stage.id)} class="milestone-count"
										><span
											>{stage.name}
											<span class="meta-text text-muted-foreground">Archived</span></span
										><strong class="tabular-nums">{stage.history_count}</strong></a
									>
								{/each}
							</div>
						</details>
					{/if}
				{/if}
			</section>
		</div>
	{/if}
</PageShell>
