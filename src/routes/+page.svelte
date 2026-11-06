<script lang="ts">
	import { allJobsUrl, milestoneJobsUrl } from '$lib/job-search.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Check from '@lucide/svelte/icons/check';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Bell from '@lucide/svelte/icons/bell';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import { enhance, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { checkAuthResponse } from '$lib/auth-notice.svelte';
	import { withPending } from '$lib/forms';
	import { toast } from '$lib/toast.svelte';
	import { attentionBuckets, buildAttention, splitAttention } from '$lib/dashboard-attention.js';
	import { formatDate, relativeDay } from '$lib/format';
	import { jobDetailUrl, newJobUrl } from '$lib/job-navigation.js';
	import AttentionRow from '$lib/components/app/attention-row.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import JobPipeline from '$lib/components/app/job-pipeline.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { page } from '$app/state';
	let { data } = $props();

	const isEmpty = $derived(data.totalJobs === 0 && data.reminders.length === 0);
	const history = $derived(
		data.stages.filter((stage: { is_archived: boolean; is_closed: boolean }) => !stage.is_archived)
	);
	const archivedHistory = $derived(
		data.stages.filter((stage: { is_archived: boolean }) => stage.is_archived)
	);
	const here = $derived(page.url.pathname + page.url.search);
	const attention = $derived(
		buildAttention({
			reminders: data.reminders,
			deadlines: data.deadlines,
			today: data.today,
			now: data.now,
			returnTo: here
		})
	);
	const shown = $derived(splitAttention(attention.items, 5));
	const bucketLabel = (key: string) => attentionBuckets.find((b) => b.key === key)?.label ?? key;
	// A stage's bar is its share of all jobs; a non-zero count always shows a sliver.
	const share = (count: number) =>
		data.totalJobs && count ? Math.max(2, Math.round((count / data.totalJobs) * 100)) : 0;
	// today is a local calendar date, so build it without a time-zone shift.
	const todayLabel = $derived.by(() => {
		const [year, month, day] = data.today.split('-').map(Number);
		return new Intl.DateTimeFormat('en-US', {
			weekday: 'long',
			month: 'long',
			day: 'numeric'
		}).format(new Date(year, month - 1, day));
	});

	type Item = (typeof attention.items)[number];
	const ownerField = (item: Item) => Object.entries(item.reminder?.owner ?? {})[0];
	async function undo(item: Item) {
		const body = new FormData();
		const [field, id] = ownerField(item);
		body.set(field, String(id));
		body.set('reminder_id', String(item.reminder?.id));
		body.set('enhanced', '1');
		const response = checkAuthResponse(
			await fetch('?/restore', {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			})
		);
		const result = deserialize(await response.text());
		if (result.type === 'success') {
			await invalidateAll();
			toast.show('Reminder restored.');
		} else toast.show('Saturday could not restore this reminder.');
	}
	// Scripts get data back (no redirect) so the toast can offer Undo.
	const dismissing =
		(item: Item): SubmitFunction =>
		({ formData }) => {
			formData.set('enhanced', '1');
			return async ({ result, update }) => {
				if (result.type === 'success') {
					await update({ reset: false });
					toast.show('Reminder dismissed.', {
						duration: 8000,
						action: { label: 'Undo', run: () => undo(item) }
					});
				} else {
					toast.show(
						result.type === 'failure' && typeof result.data?.error === 'string'
							? result.data.error
							: 'Saturday could not dismiss this reminder.'
					);
					await update();
				}
			};
		};
</script>

{#snippet dismiss(item: Item)}
	{@const [field, id] = ownerField(item)}
	<form method="POST" action="?/dismiss" use:enhance={withPending(dismissing(item))}>
		<input type="hidden" name={field} value={id} />
		<input type="hidden" name="reminder_id" value={item.reminder?.id} />
		<Button
			type="submit"
			variant="ghost"
			size="icon"
			class="size-11 text-foreground"
			aria-label={`Dismiss reminder: ${item.title}`}
			title="Dismiss reminder"><Check class="size-5" aria-hidden="true" /></Button
		>
	</form>
{/snippet}

{#snippet attentionRows(items: Item[], continued: boolean)}
	{#each items as item, index (item.key)}
		{#if index === 0 || item.bucket !== items[index - 1].bucket}
			<h4 class="group-title">
				{bucketLabel(item.bucket)}
				<span class="font-normal text-muted-foreground"
					>{continued
						? `· ${items.filter((x) => x.bucket === item.bucket).length} more`
						: `(${attention.counts[item.bucket]})`}</span
				>
			</h4>
		{/if}
		<AttentionRow
			href={item.href}
			kind={item.kind}
			title={item.title}
			subtitle={item.subtitle}
			comment={item.comment}
			relative={item.relative}
			absolute={item.absolute}
			overdue={item.overdue}
			action={item.reminder ? dismiss : undefined}
			actionArg={item}
		/>
	{/each}
{/snippet}

<PageShell title="Dashboard">
	<PageHeader title="Dashboard" description={todayLabel} />

	{#if isEmpty}
		<EmptyState
			title="Welcome to Saturday"
			description="Add the first job you are interested in. You can record progress yourself, or let a connected assistant do it."
		>
			{#snippet icon()}<Briefcase class="size-5" />{/snippet}
			{#snippet actions()}
				<Button href={newJobUrl('/')} size="lg">
					<Plus data-icon="inline-start" />
					Add job
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		{#if !data.errors.attention && attention.counts.overdue + attention.counts.today > 0}
			<nav class="attention-summary" aria-label="Needs attention summary">
				{#if attention.counts.overdue}<a
						href="#needs-attention"
						data-tone="overdue"
						class="font-medium"
						><strong class="tabular-nums">{attention.counts.overdue}</strong> overdue</a
					>{/if}
				{#if attention.counts.today}<a href="#needs-attention" class="font-medium"
						><strong class="tabular-nums">{attention.counts.today}</strong> due today</a
					>{/if}
			</nav>
		{/if}
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
				<JobPipeline columns={data.pipeline} now={data.now} />
			{/if}
		</section>
		<div class="dashboard-overview">
			<div id="notifications" class="min-w-0 space-y-8">
				<section id="needs-attention" aria-labelledby="attention-heading" class="space-y-3">
					<h2 id="attention-heading" class="section-title flex items-center gap-2">
						<Bell class="size-5 text-muted-foreground" aria-hidden="true" />
						Needs attention
						<span class="font-normal text-muted-foreground"
							>({data.errors.attention ? 'Unavailable' : attention.total})</span
						>
					</h2>
					{#if data.errors.attention}
						<Notice tone="error" title="Needs attention unavailable">{data.errors.attention}</Notice
						>
					{:else if attention.total === 0}
						<EmptyState
							size="inline"
							title="Nothing due"
							description="No reminders or deadlines right now. You’re all caught up."
						/>
					{:else}
						<Card.Root class="gap-0 divide-y divide-border overflow-hidden p-0">
							{@render attentionRows(shown.first, false)}
						</Card.Root>
						{#if shown.rest.length}
							<details class="disclosure">
								<summary>Show {shown.rest.length} more</summary>
								<div class="disclosure-body">
									<Card.Root class="gap-0 divide-y divide-border overflow-hidden p-0">
										{@render attentionRows(shown.rest, true)}
									</Card.Root>
								</div>
							</details>
						{/if}
					{/if}
				</section>
				{#if data.errors.upcoming || data.upcoming.length > 0}
					<section aria-labelledby="upcoming-heading" class="space-y-3">
						<h2 id="upcoming-heading" class="section-title flex items-center gap-2">
							<CalendarClock class="size-5 text-muted-foreground" aria-hidden="true" />
							Coming up
						</h2>
						{#if data.errors.upcoming}
							<Notice tone="error" title="Coming up unavailable">{data.errors.upcoming}</Notice>
						{:else}
							<Card.Root class="gap-0 divide-y divide-border overflow-hidden p-0">
								{#each data.upcoming as item (item.id)}
									<AttentionRow
										href={jobDetailUrl(item.jobId, here)}
										kind="milestone"
										title={item.label}
										subtitle="{item.title} · {item.company} · {item.stage}"
										relative={relativeDay(item.date, data.today)}
										absolute={formatDate(item.date)}
									/>
								{/each}
							</Card.Root>
						{/if}
					</section>
				{/if}
			</div>
			<section aria-labelledby="history-heading" class="min-w-0 space-y-3">
				<div class="space-y-1">
					<h2 id="history-heading" class="section-title flex items-center gap-2">
						<TrendingUp class="size-5 text-muted-foreground" aria-hidden="true" />Milestone history
					</h2>
					<p class="text-sm text-muted-foreground">
						Jobs that reached each stage, including closed and scheduled milestones. Counts overlap
						and are separate from current placement. Bars show the share of all {data.totalJobs} jobs.
					</p>
				</div>
				{#if data.errors.history}
					<Notice tone="error" title="Milestone history unavailable">{data.errors.history}</Notice>
				{:else}
					<div class="milestone-counts">
						{#each history as stage (stage.id)}
							<a
								href={milestoneJobsUrl(stage.id)}
								class="milestone-count"
								data-closed={stage.is_closed ? '' : undefined}
								><span
									>{stage.name}{#if stage.is_closed}<span
											class="meta-text ml-2 text-muted-foreground">Closed</span
										>{/if}</span
								><strong class="tabular-nums">{stage.history_count}</strong><span
									class="milestone-bar"
									aria-hidden="true"><span style:width="{share(stage.history_count)}%"></span></span
								></a
							>
						{/each}
					</div>
					{#if archivedHistory.length}
						<details class="disclosure">
							<summary>Archived milestones</summary>
							<div class="disclosure-body milestone-counts">
								{#each archivedHistory as stage (stage.id)}
									<a href={milestoneJobsUrl(stage.id)} class="milestone-count" data-closed
										><span
											>{stage.name}
											<span class="meta-text text-muted-foreground">Archived</span></span
										><strong class="tabular-nums">{stage.history_count}</strong><span
											class="milestone-bar"
											aria-hidden="true"
											><span style:width="{share(stage.history_count)}%"></span></span
										></a
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
