<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import FilterBar from '$lib/components/app/filter-bar.svelte';
	import FilterChips from '$lib/components/app/filter-chips.svelte';
	import Checkbox from '$lib/components/app/checkbox.svelte';
	import Pagination from '$lib/components/app/pagination.svelte';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import JobRow from '$lib/components/app/job-row.svelte';
	import Field from '$lib/components/app/field.svelte';
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import {
		statusOptions,
		stepOptions,
		workOptions,
		employmentOptions,
		sortOptions
	} from '$lib/job-search.js';
	import { focusFirstError } from '$lib/forms';

	let { data } = $props();
	// Draft controls change only on Apply; URL-backed data remains the applied result.
	let values = $state(untrack(() => ({ ...data.filters })));
	let hydrated = $state(false);
	let hadHistorical = untrack(() => data.filters.step.length > 0);
	$effect(() => {
		const hasHistorical = values.step.length > 0;
		if (hasHistorical !== hadHistorical) {
			values.view = hasHistorical ? 'all' : 'active';
			hadHistorical = hasHistorical;
		}
	});
	onMount(() => {
		hydrated = true;
	});
	$effect(() => {
		values = { ...data.filters };
		hadHistorical = data.filters.step.length > 0;
		if (Object.keys(data.errors).length) void tick().then(focusFirstError);
	});
	const errors = $derived(data.errors as Record<string, string>);
	const invalid = $derived(Object.keys(errors).length > 0);
	const historical = $derived(values.step.length > 0);
	const advancedKeys = [
		'step',
		'work_arrangement',
		'employment_type',
		'created_via',
		'source',
		'follow_up',
		'follow_up_from',
		'follow_up_to',
		'deadline',
		'deadline_from',
		'deadline_to',
		'score',
		'score_min',
		'score_max',
		'created_from',
		'created_to',
		'updated_from',
		'updated_to'
	];
	const advancedOpen = $derived(
		data.chips.some((chip: { key: string }) => advancedKeys.includes(chip.key.split(':')[0])) ||
			Object.keys(errors).some((key) => advancedKeys.includes(key))
	);
	const categoryGroups = [
		{ key: 'step', label: 'Ever reached', options: stepOptions },
		{
			key: 'work_arrangement',
			label: 'Work arrangement',
			options: [
				...workOptions.map((value) => ({ value, label: value })),
				{ value: 'unset', label: 'Not specified' }
			]
		},
		{
			key: 'employment_type',
			label: 'Employment type',
			options: [
				...employmentOptions.map((value) => ({ value, label: value })),
				{ value: 'unset', label: 'Not specified' }
			]
		},
		{
			key: 'created_via',
			label: 'Created via',
			options: [
				{ value: 'manual', label: 'Manual' },
				{ value: 'mcp', label: 'MCP' }
			]
		}
	] as const;
	const dateGroups = [
		{ key: 'follow_up', label: 'Follow-up date' },
		{ key: 'deadline', label: 'Application deadline' }
	] as const;
</script>

<PageShell title="Jobs">
	<PageHeader title="Jobs" description="Find jobs and review their latest progress.">
		{#snippet actions()}
			{#if data.totalJobs > 0 || invalid}
				<Button href="/jobs/new" size="lg"><Plus data-icon="inline-start" />Add job</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<FilterBar label="Filter jobs" action="/jobs" clearHref="/jobs">
		{#snippet before()}
			{#if invalid}
				<Notice tone="error" title="Check the filters">
					{#each Object.entries(errors) as [key, message]}<p>
							{key.replaceAll('_', ' ')}: {message}
						</p>{/each}
				</Notice>
			{/if}
		{/snippet}
		<p class="text-sm text-muted-foreground">
			All filters must match. Multiple choices within a category match any selected choice.
		</p>
		<div class="grid gap-4 sm:grid-cols-3">
			<Field id="title" label="Title contains" error={errors.title}>
				{#snippet control(attrs)}<Input
						{...attrs}
						name="title"
						bind:value={values.title}
						maxlength={200}
						placeholder="Engineer"
					/>{/snippet}
			</Field>
			<Field id="company" label="Company contains" error={errors.company}>
				{#snippet control(attrs)}<Input
						{...attrs}
						name="company"
						bind:value={values.company}
						maxlength={200}
						placeholder="Company name"
					/>{/snippet}
			</Field>
			<Field id="location" label="Location contains" error={errors.location}>
				{#snippet control(attrs)}<Input
						{...attrs}
						name="location"
						bind:value={values.location}
						maxlength={200}
						placeholder="City or region"
					/>{/snippet}
			</Field>
		</div>
		{#if values.query}<input type="hidden" name="query" value={values.query} />{/if}
		<div class="grid gap-4 sm:grid-cols-3">
			<Field
				id="view"
				label="Activity"
				error={errors.view}
				hint={historical ? 'Ever reached includes active and inactive jobs.' : undefined}
			>
				{#snippet control(attrs)}
					<NativeSelect
						{...attrs}
						name="view"
						value={historical ? 'all' : values.view}
						onchange={(event) => (values.view = event.currentTarget.value)}
						disabled={historical}
					>
						<option value="active">Active</option><option value="inactive">Inactive</option><option
							value="all">All</option
						>
					</NativeSelect>
				{/snippet}
			</Field>
			<Field id="starred" label="Starred" error={errors.starred}>
				{#snippet control(attrs)}<NativeSelect {...attrs} name="starred" bind:value={values.starred}
						><option value="all">All</option><option value="starred">Starred</option><option
							value="not_starred">Not starred</option
						></NativeSelect
					>{/snippet}
			</Field>
			<Field id="sort" label="Sort by" error={errors.sort}>
				{#snippet control(attrs)}<NativeSelect {...attrs} name="sort" bind:value={values.sort}
						>{#each sortOptions as option}<option value={option.value}>{option.label}</option
							>{/each}</NativeSelect
					>{/snippet}
			</Field>
		</div>
		<fieldset class="space-y-3" aria-describedby={errors.status ? 'status-error' : undefined}>
			<legend class="text-sm font-medium">Current status</legend>
			<div class="flex flex-wrap gap-x-5 gap-y-3">
				{#each statusOptions as option}
					<Checkbox
						name="status"
						value={option.value}
						label={option.label}
						bind:group={values.status}
						aria-invalid={Boolean(errors.status)}
					/>
				{/each}
			</div>
			{#if errors.status}<p id="status-error" class="text-sm text-destructive">
					{errors.status}
				</p>{/if}
		</fieldset>
		{#snippet more()}
			<details class="disclosure" open={advancedOpen}>
				<summary
					><span>Advanced filters</span><ChevronDown class="disclosure-chevron size-4" /></summary
				>
				<div class="disclosure-body space-y-6">
					<div class="grid gap-6 sm:grid-cols-2">
						{#each categoryGroups as group}
							<fieldset
								class="space-y-3"
								aria-describedby={errors[group.key] ? `${group.key}-error` : undefined}
							>
								<legend class="text-sm font-medium">{group.label}</legend>
								<div class="flex flex-wrap gap-x-5 gap-y-3">
									{#each group.options as option}<Checkbox
											name={group.key}
											value={option.value}
											label={option.label}
											bind:group={values[group.key]}
											aria-invalid={Boolean(errors[group.key])}
										/>{/each}
								</div>
								{#if group.key === 'step'}<p class="text-sm text-muted-foreground">
										Includes active and inactive jobs that ever reached any selected step.
									</p>{/if}
								{#if errors[group.key]}<p
										id={`${group.key}-error`}
										class="text-sm text-destructive"
									>
										{errors[group.key]}
									</p>{/if}
							</fieldset>
						{/each}
					</div>
					<Field id="source" label="Source contains" error={errors.source}>
						{#snippet control(attrs)}<Input
								{...attrs}
								name="source"
								bind:value={values.source}
								maxlength={200}
								placeholder="Referral or job board"
							/>{/snippet}
					</Field>
					<div class="grid gap-6 lg:grid-cols-2">
						{#each dateGroups as group}
							<fieldset class="space-y-4">
								<legend class="mb-3 text-sm font-medium">{group.label}</legend>
								<Field id={group.key} label="Dates" error={errors[group.key]}>
									{#snippet control(attrs)}
										<NativeSelect {...attrs} name={group.key} bind:value={values[group.key]}>
											<option value="any">Any</option><option value="unset"
												>{group.key === 'follow_up' ? 'Not scheduled' : 'Not specified'}</option
											><option value="set"
												>{group.key === 'follow_up' ? 'Scheduled' : 'Specified'}</option
											><option value="overdue">Overdue</option><option value="today">Today</option
											><option value="upcoming">Upcoming</option><option value="range"
												>Date range</option
											>
										</NativeSelect>
									{/snippet}
								</Field>
								<div class="grid grid-cols-2 gap-4">
									{#each ['from', 'to'] as bound}
										{@const key = `${group.key}_${bound}` as
											'follow_up_from' | 'follow_up_to' | 'deadline_from' | 'deadline_to'}
										<Field
											id={key}
											label={bound === 'from' ? 'From' : 'Through'}
											error={errors[key]}
										>
											{#snippet control(attrs)}<Input
													{...attrs}
													name={key}
													type="date"
													bind:value={values[key]}
												/>{/snippet}
										</Field>
									{/each}
								</div>
								<p class="text-sm text-muted-foreground">
									From and Through apply when Date range is selected. Today uses the local calendar.
								</p>
							</fieldset>
						{/each}
					</div>
					<fieldset class="space-y-4">
						<legend class="mb-3 text-sm font-medium">Assistant score</legend>
						<div class="grid gap-4 sm:grid-cols-3">
							<Field id="score" label="Assessment" error={errors.score}>
								{#snippet control(attrs)}<NativeSelect
										{...attrs}
										name="score"
										bind:value={values.score}
										onchange={(event) => {
											if (event.currentTarget.value === 'unscored') {
												values.score_min = undefined;
												values.score_max = undefined;
											}
										}}
										><option value="any">Any</option><option value="scored">Scored</option><option
											value="unscored">Unscored</option
										></NativeSelect
									>{/snippet}
							</Field>
							<Field id="score_min" label="Minimum" error={errors.score_min}>
								{#snippet control(attrs)}<Input
										{...attrs}
										name="score_min"
										type="number"
										step="any"
										bind:value={values.score_min}
										disabled={hydrated && values.score === 'unscored'}
									/>{/snippet}
							</Field>
							<Field id="score_max" label="Maximum" error={errors.score_max}>
								{#snippet control(attrs)}<Input
										{...attrs}
										name="score_max"
										type="number"
										step="any"
										bind:value={values.score_max}
										disabled={hydrated && values.score === 'unscored'}
									/>{/snippet}
							</Field>
						</div>
						<p class="text-sm text-muted-foreground">
							Scores have no fixed scale. Bounds match scored jobs only.
						</p>
					</fieldset>
					<div class="grid gap-6 lg:grid-cols-2">
						{#each ['created', 'updated'] as kind}
							<fieldset>
								<legend class="mb-3 text-sm font-medium"
									>{kind === 'created' ? 'Created date' : 'Updated date'}</legend
								>
								<div class="grid grid-cols-2 gap-4">
									{#each ['from', 'to'] as bound}
										{@const key = `${kind}_${bound}` as
											'created_from' | 'created_to' | 'updated_from' | 'updated_to'}
										<Field
											id={key}
											label={bound === 'from' ? 'From' : 'Through'}
											error={errors[key]}
											>{#snippet control(attrs)}<Input
													{...attrs}
													name={key}
													type="date"
													bind:value={values[key]}
												/>{/snippet}</Field
										>
									{/each}
								</div>
							</fieldset>
						{/each}
					</div>
				</div>
			</details>
		{/snippet}
	</FilterBar>

	<FilterChips chips={data.chips} />
	{#if !invalid}
		<div class="space-y-4">
			<p class="text-sm text-muted-foreground" aria-live="polite">
				{data.total}{data.chips.length ? '' : ' active'}
				{data.total === 1 ? 'job' : 'jobs'}{data.chips.length
					? ' matching filters'
					: ''}{data.total > 50 ? ` · Page ${data.page} of ${data.totalPages}` : ''}
			</p>
			{#if data.jobs.length === 0}
				<EmptyState
					title={data.totalJobs === 0
						? 'No jobs yet'
						: data.chips.length
							? 'No matching jobs'
							: 'No active jobs'}
					description={data.totalJobs === 0
						? 'Add a job to start tracking it. Only a title and company are needed.'
						: data.chips.length
							? 'Try fewer filters or clear them to see active jobs.'
							: 'View all jobs to review inactive opportunities.'}
				>
					{#snippet icon()}<Briefcase class="size-5" />{/snippet}
					{#snippet actions()}{#if data.totalJobs === 0}<Button href="/jobs/new" size="lg"
								><Plus data-icon="inline-start" />Add job</Button
							>{:else}<Button
								href={data.chips.length ? '/jobs' : '/jobs?view=all'}
								variant="outline"
								size="lg">{data.chips.length ? 'Clear filters' : 'Show all jobs'}</Button
							>{/if}{/snippet}
				</EmptyState>
			{:else}
				<Card.Root class="gap-0 divide-y divide-border p-0">
					{#each data.jobs as job (job.id)}<JobRow
							recordNumber={job.id}
							href={`/jobs/${job.id}`}
							title={job.title}
							company={job.company}
							status={job.status}
							latestUpdate={job.latestUpdate}
							isStarred={job.isStarred}
							score={job.score}
						/>{/each}
				</Card.Root>
				<Pagination
					label="Jobs pages"
					page={data.page}
					totalPages={data.totalPages}
					previous={data.previous}
					next={data.next}
				/>
			{/if}
		</div>
	{/if}
</PageShell>
