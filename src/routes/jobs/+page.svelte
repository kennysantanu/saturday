<script lang="ts">
	import { validTagSelection } from '$lib/tags.js';
	import TagPicker from '$lib/components/app/tag-picker.svelte';
	import { onMount, tick, untrack } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import RecentMenu from '$lib/components/app/recent-menu.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import FilterBar from '$lib/components/app/filter-bar.svelte';
	import FilterToggle from '$lib/components/app/filter-toggle.svelte';
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
		workOptions,
		employmentOptions,
		sortOptions,
		statusValue,
		applyStatus,
		searchUrl,
		allJobsUrl
	} from '$lib/job-search.js';
	import { jobDetailUrl } from '$lib/job-navigation.js';
	import { readableKey, resultCount, reminderLabel, noMatchHint } from '$lib/filter-labels.js';
	import SearchField from '$lib/components/app/search-field.svelte';
	import { page } from '$app/state';
	import { focusFirstError } from '$lib/forms';

	let { data } = $props();
	// Draft controls change only on Apply, except the quick controls (Status, Starred, Sort),
	// which apply on change. URL-backed data remains the applied result.
	const draftFrom = (filters: typeof data.filters) => ({
		...filters,
		tag_ids: validTagSelection(filters.tag_ids),
		current_stage: filters.current_stage.map(String),
		milestone_stage: filters.milestone_stage.map(String),
		status: statusValue({ ...filters, current_stage: filters.current_stage.map(String) })
	});
	let values = $state(untrack(() => draftFrom(data.filters)));
	let hydrated = $state(false);
	let hadMilestone = untrack(() => data.filters.milestone_stage.length > 0);
	// Milestone history includes active and closed jobs, so Status reads All while it is selected
	// (unless a specific stage is chosen).
	const stageSelected = $derived(values.status.startsWith('stage-') || values.status === 'custom');
	$effect(() => {
		const hasMilestone = values.milestone_stage.length > 0;
		if (hasMilestone !== hadMilestone) {
			if (!stageSelected) values.status = hasMilestone ? 'all' : 'active';
			hadMilestone = hasMilestone;
		}
	});
	onMount(() => {
		hydrated = true;
	});
	$effect(() => {
		values = draftFrom(data.filters);
		hadMilestone = data.filters.milestone_stage.length > 0;
		if (Object.keys(data.errors).length) void tick().then(focusFirstError);
	});
	const statusLocked = $derived(values.milestone_stage.length > 0 && !stageSelected);
	const unapplied = $derived(
		hydrated &&
			!Object.keys(data.errors).length &&
			searchUrl(applyStatus(values)) !== searchUrl(data.filters)
	);
	const errors = $derived(data.errors as Record<string, string>);
	const invalid = $derived(Object.keys(errors).length > 0);
	const advancedKeys = [
		'tag_ids',
		'starred',
		'title',
		'company',
		'location',
		'milestone_stage',
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
	// Once scripts run, From/Through show only for Date range and Min/Max only for Scored (or a
	// bound already in the URL); without scripts every field stays visible.
	const showRange = (key: 'follow_up' | 'deadline') =>
		!hydrated || values[key] === 'range' || Boolean(errors[`${key}_from`] || errors[`${key}_to`]);
	const hasBound = (value: unknown) => value !== undefined && value !== null && value !== '';
	const showBounds = $derived(
		!hydrated ||
			values.score === 'scored' ||
			(values.score === 'any' && (hasBound(values.score_min) || hasBound(values.score_max))) ||
			Boolean(errors.score_min || errors.score_max)
	);
	const advancedCount = $derived(
		data.chips.filter((chip: { key: string }) => advancedKeys.includes(chip.key.split(':')[0]))
			.length
	);
	const countText = $derived(
		resultCount(data.total, {
			one: data.chips.length ? 'job' : 'active job',
			many: data.chips.length ? 'jobs' : 'active jobs',
			filtered: data.chips.length > 0
		}) + (data.totalPages > 1 ? ` · Page ${data.page} of ${data.totalPages}` : '')
	);
	const advancedOpen = $derived(
		data.chips.some((chip: { key: string }) => advancedKeys.includes(chip.key.split(':')[0])) ||
			Object.keys(errors).some((key) => advancedKeys.includes(key))
	);
	const categoryGroups = $derived([
		{
			key: 'milestone_stage',
			label: 'Milestone history (includes scheduled)',
			options: data.stages.map((stage: { id: number; name: string; is_archived: boolean }) => ({
				value: String(stage.id),
				label: stage.name + (stage.is_archived ? ' · Archived' : '')
			}))
		},
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
				{ value: 'assistant', label: 'Assistant' }
			]
		}
	] as const);
	const dateGroups = [
		{ key: 'follow_up', label: 'Reminder date' },
		{ key: 'deadline', label: 'Application deadline' }
	] as const;
</script>

<PageShell title="Jobs">
	<PageHeader title="Jobs" description="Find jobs and review their latest progress.">
		{#snippet actions()}
			<RecentMenu kind="jobs" enabled={Boolean(data.navigationSettings?.enabled)} />
			<Button
				href={'/jobs/new?return_to=' + encodeURIComponent(page.url.pathname + page.url.search)}
				size="lg"><Plus data-icon="inline-start" />Add job</Button
			>
		{/snippet}
	</PageHeader>

	<FilterBar
		label="Filter jobs"
		action="/jobs"
		clearHref="/jobs"
		showClear={data.chips.length > 0 || invalid}
		instant
		{unapplied}
		chips={data.chips}
		advancedLabel="Advanced filters"
		{advancedCount}
		{advancedOpen}
	>
		{#snippet before()}
			{#if invalid}
				<Notice tone="error" title="Check the filters">
					{#each Object.entries(errors) as [key, message]}<p>
							{readableKey(key)}: {message}
						</p>{/each}
				</Notice>
			{/if}
		{/snippet}
		<div class="filter-row">
			<div class="filter-row-search">
				<SearchField
					id="query"
					label="Search jobs"
					bind:value={values.query}
					placeholder="Title, company or location"
					error={errors.query}
				/>
			</div>
			<div class="filter-row-one">
				<Field
					id="status"
					label="Status"
					error={errors.view ?? errors.current_stage}
					hint={statusLocked ? 'Milestone history includes active and closed jobs.' : undefined}
				>
					{#snippet control(attrs)}
						<NativeSelect
							{...attrs}
							name="status"
							bind:value={values.status}
							disabled={statusLocked}
							data-instant
						>
							<option value="active">Active</option>
							<option value="closed">Closed</option>
							<option value="all">All</option>
							{#if values.status === 'custom'}<option value="custom">Several stages</option>{/if}
							<optgroup label="Current stage">
								{#each data.stages.filter((stage: { is_archived: boolean }) => !stage.is_archived) as stage (stage.id)}
									<option value={`stage-${stage.id}`}>{stage.name}</option>
								{/each}
							</optgroup>
						</NativeSelect>
						{#if values.status === 'custom'}{#each values.current_stage as id}<input
									type="hidden"
									name="current_stage"
									value={id}
								/>{/each}{/if}
					{/snippet}
				</Field>
			</div>
			<div class="filter-row-two">
				<Field id="sort" label="Sort by" error={errors.sort}>
					{#snippet control(attrs)}<NativeSelect
							{...attrs}
							name="sort"
							bind:value={values.sort}
							data-instant
							>{#each sortOptions as option}<option value={option.value}>{option.label}</option
								>{/each}</NativeSelect
						>{/snippet}
				</Field>
			</div>
			<div class="filter-row-toggle"><FilterToggle /></div>
		</div>

		{#snippet advanced()}
			<p class="text-sm text-muted-foreground">
				All filters must match. Multiple choices within a category match any selected choice.
			</p>
			<section class="space-y-4" aria-labelledby="adv-details">
				<h3 id="adv-details" class="text-base font-semibold">Details</h3>
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
				<div class="grid gap-4 sm:grid-cols-2">
					<Field id="source" label="Source contains" error={errors.source}>
						{#snippet control(attrs)}<Input
								{...attrs}
								name="source"
								bind:value={values.source}
								maxlength={200}
								placeholder="Referral or job board"
							/>{/snippet}
					</Field>
					<Field id="starred" label="Starred" error={errors.starred}>
						{#snippet control(attrs)}<NativeSelect
								{...attrs}
								name="starred"
								bind:value={values.starred}
								data-instant
								><option value="all">All</option><option value="starred">Starred</option><option
									value="not_starred">Not starred</option
								></NativeSelect
							>{/snippet}
					</Field>
				</div>
			</section>
			<section class="space-y-4" aria-labelledby="adv-type">
				<h3 id="adv-type" class="text-base font-semibold">Job type and history</h3>
				<div class="grid gap-6 sm:grid-cols-2">
					{#each categoryGroups as group}
						<fieldset
							class="space-y-3"
							aria-describedby={errors[group.key] ? `${group.key}-error` : undefined}
						>
							<legend class="text-sm font-medium">{group.label}</legend>
							<div class="choice-pills flex flex-wrap gap-2">
								{#each group.options as option}<Checkbox
										name={group.key}
										value={option.value}
										label={option.label}
										bind:group={values[group.key]}
										aria-invalid={Boolean(errors[group.key])}
									/>{/each}
							</div>
							{#if group.key === 'milestone_stage'}<p class="text-sm text-muted-foreground">
									Includes active and closed jobs with any selected milestone, including scheduled
									milestones.
								</p>{/if}
							{#if errors[group.key]}<p id={`${group.key}-error`} class="text-sm text-destructive">
									{errors[group.key]}
								</p>{/if}
						</fieldset>
					{/each}
				</div>
			</section>
			<section class="space-y-4" aria-label="Job tags">
				<TagPicker
					collection="job"
					initial={data.tagOptions}
					bind:selected={values.tag_ids}
					allowCreate={false}
					marker={false}
					error={errors.tag_ids}
				/>
			</section>
			<section class="space-y-4" aria-labelledby="adv-dates">
				<h3 id="adv-dates" class="text-base font-semibold">Dates</h3>
				<div class="grid gap-6 lg:grid-cols-2">
					{#each dateGroups as group}
						<fieldset class="space-y-4">
							<legend class="sr-only">{group.label}</legend>
							<Field id={group.key} label={group.label} error={errors[group.key]}>
								{#snippet control(attrs)}
									<NativeSelect {...attrs} name={group.key} bind:value={values[group.key]}>
										<option value="any">{reminderLabel('any')}</option><option value="unset"
											>{group.key === 'follow_up'
												? reminderLabel('unset')
												: 'Not specified'}</option
										><option value="set"
											>{group.key === 'follow_up' ? 'Scheduled' : 'Specified'}</option
										><option value="overdue">{reminderLabel('overdue')}</option><option
											value="today">{reminderLabel('today')}</option
										><option value="upcoming">{reminderLabel('upcoming')}</option><option
											value="range">{reminderLabel('range')}</option
										>
									</NativeSelect>
								{/snippet}
							</Field>
							{#if showRange(group.key)}<div class="grid grid-cols-2 gap-4">
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
								</div>{/if}
							<p class="text-sm text-muted-foreground">
								{showRange(group.key)
									? 'From and Through apply when Date range is selected. Today uses the local calendar.'
									: 'Choose Date range to set From and Through. Today uses the local calendar.'}
							</p>
						</fieldset>
					{/each}
				</div>
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
									<Field id={key} label={bound === 'from' ? 'From' : 'Through'} error={errors[key]}
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
			</section>
			<section class="space-y-4" aria-labelledby="adv-score">
				<h3 id="adv-score" class="text-base font-semibold">Assistant score</h3>
				<fieldset class="space-y-4">
					<legend class="sr-only">Assistant score</legend>
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
						{#if showBounds}<Field id="score_min" label="Minimum" error={errors.score_min}>
								{#snippet control(attrs)}<Input
										{...attrs}
										name="score_min"
										type="number"
										step="any"
										bind:value={values.score_min}
									/>{/snippet}
							</Field>
							<Field id="score_max" label="Maximum" error={errors.score_max}>
								{#snippet control(attrs)}<Input
										{...attrs}
										name="score_max"
										type="number"
										step="any"
										bind:value={values.score_max}
									/>{/snippet}
							</Field>{/if}
					</div>
					<p class="text-sm text-muted-foreground">
						Scores have no fixed scale.{showBounds
							? ' Bounds match scored jobs only.'
							: ' Choose Scored to set a minimum or maximum.'}
					</p>
				</fieldset>
			</section>
		{/snippet}
	</FilterBar>

	{#if !invalid}
		<div class="space-y-4">
			<p class="text-sm text-muted-foreground" aria-live="polite">{countText}</p>
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
							? noMatchHint.filters
							: 'View all jobs to review closed opportunities.'}
				>
					{#snippet icon()}<Briefcase class="size-5" />{/snippet}
					{#snippet actions()}{#if data.totalJobs === 0}<Button
								href={'/jobs/new?return_to=' +
									encodeURIComponent(page.url.pathname + page.url.search)}
								size="lg"><Plus data-icon="inline-start" />Add job</Button
							>{:else}<Button
								href={data.chips.length ? '/jobs' : allJobsUrl()}
								variant="outline"
								size="lg">{data.chips.length ? 'Clear filters' : 'Show all jobs'}</Button
							>{/if}{/snippet}
				</EmptyState>
			{:else}
				<Card.Root class="gap-0 divide-y divide-border p-0">
					{#each data.jobs as job (job.id)}<JobRow
							tags={job.tags}
							recordNumber={job.id}
							href={jobDetailUrl(job.id, page.url.pathname + page.url.search)}
							title={job.title}
							company={job.company}
							status={job.status}
							latestUpdate={job.latestUpdate}
							nextReminder={job.nextReminder}
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
