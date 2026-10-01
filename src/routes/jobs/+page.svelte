<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import X from '@lucide/svelte/icons/x';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import JobRow from '$lib/components/app/job-row.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	let { data } = $props();

	const showAll = $derived(data.showAll);
	const jobs = $derived(data.jobs);
	const step = $derived(data.step);

	const tabs = $derived([
		{ label: 'Active', href: '/jobs', selected: !showAll },
		{ label: 'All', href: '/jobs?view=all', selected: showAll }
	]);
	const noun = $derived(jobs.length === 1 ? 'job' : 'jobs');
	const summary = $derived(
		step
			? `${jobs.length} ${noun}`
			: showAll
				? `${jobs.length} ${noun} in total`
				: `${jobs.length} active ${noun}`
	);
</script>

<svelte:head><title>Jobs · Saturday</title></svelte:head>

<div class="space-y-8">
	<PageHeader title="Jobs" description="Your jobs and their latest progress.">
		{#snippet actions()}
			<!-- An empty list shows its own Add job button, so the header does not repeat it. -->
			{#if jobs.length > 0 || step}
				<Button href="/jobs/new" size="lg">
					<Plus data-icon="inline-start" />
					Add job
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<div class="space-y-4">
		<div class="filter-bar">
			<nav aria-label="Job filter" class="job-filters">
				{#each tabs as tab (tab.label)}
					<a href={tab.href} aria-current={tab.selected ? 'page' : undefined}>{tab.label}</a>
				{/each}
			</nav>
			<p class="text-sm text-muted-foreground" aria-live="polite">{summary}</p>
		</div>

		{#if step}
			<div class="filter-chip">
				<span>Reached step: {data.stepLabel}</span>
				<a
					href="/jobs?view=all"
					aria-label="Clear step filter"
					title="Clear step filter"
					class="hover:bg-foreground/10"><X class="size-4" aria-hidden="true" /></a
				>
			</div>
		{/if}

		{#if jobs.length === 0}
			<EmptyState
				title={step ? 'No jobs at this step' : showAll ? 'No jobs yet' : 'No active jobs'}
				description={step
					? 'No job has reached this step yet. Clear the filter to see every job.'
					: 'Add a job to start tracking it. Only a title and company are needed.'}
			>
				{#snippet icon()}<Briefcase class="size-5" />{/snippet}
				{#snippet actions()}
					{#if step}
						<Button href="/jobs?view=all" variant="outline" size="lg">Show all jobs</Button>
					{:else}
						<Button href="/jobs/new" size="lg">
							<Plus data-icon="inline-start" />
							Add job
						</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<Card.Root class="gap-0 divide-y divide-border p-0">
				{#each jobs as job (job.id)}
					<JobRow
						href={`/jobs/${job.id}`}
						title={job.title}
						company={job.company}
						status={job.status}
						latestUpdate={job.latestUpdate}
					/>
				{/each}
			</Card.Root>
		{/if}
	</div>
</div>
