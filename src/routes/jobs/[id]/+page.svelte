<script lang="ts">
	import { tick } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Bot from '@lucide/svelte/icons/bot';
	import { enhance } from '$app/forms';
	import Plus from '@lucide/svelte/icons/plus';
	import Star from '@lucide/svelte/icons/star';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { jobInfoFields } from '$lib/job-fields.js';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import ConfirmDialog from '$lib/components/app/confirm-dialog.svelte';
	import Field from '$lib/components/app/field.svelte';
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import StatusBadge from '$lib/components/app/status-badge.svelte';
	import Timeline from '$lib/components/app/timeline.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { focusFirstError, enhanceWithFocus } from '$lib/forms';
	import { hostOf, formatDate, relativeDay } from '$lib/format';
	import { UPDATE_CHOICES } from '$lib/status';

	type JobUpdate = {
		id: string;
		date: string;
		recordedOrder: number;
		eventType: string | null;
		label: string;
		note: string | null;
		createdVia: 'manual' | 'mcp';
	};

	let { data, form } = $props();
	const job = $derived(data.job);
	const updates = $derived(job.updates as JobUpdate[]);
	const errors = $derived(form?.errors ?? {});
	const values = $derived(form?.values ?? {});
	// Each form shows its own errors: Add update and Edit update in their dialogs, the rest here.
	const addErrors = $derived(form?.action === 'addUpdate' ? errors : {});
	const pageError = $derived(
		['dismiss', 'reopen', 'star'].includes(form?.action ?? '') ? errors.form : undefined
	);
	let open = $state(false);
	let dismissOpen = $state(false);
	let descriptionOpen = $state(false);
	let selectedType = $state('applied');
	const isInterview = $derived(selectedType === 'interview_1' || selectedType === 'interview_2');
	const choices = $derived(
		job.isActive ? UPDATE_CHOICES : UPDATE_CHOICES.filter((item) => item.value === 'note')
	);
	const upcoming = $derived(
		updates
			.filter((entry) => entry.date > data.today)
			.sort((a, b) => a.date.localeCompare(b.date) || a.recordedOrder - b.recordedOrder)
	);
	const history = $derived(updates.filter((entry) => entry.date <= data.today));
	const canReopen = $derived(!job.isActive && job.status.label === 'Dismissed');
	const longDescription = $derived(
		(job.description?.length ?? 0) > 480 || (job.description?.split('\n').length ?? 0) > 8
	);

	$effect(() => {
		if (form?.action === 'addUpdate' && form?.errors) open = true;
	});

	$effect(() => {
		selectedType = values.event_type ?? (job.isActive ? 'applied' : 'note');
	});
</script>

<svelte:head><title>{job.title} · {job.company} · Saturday</title></svelte:head>

<Dialog.Root bind:open>
	<div class="space-y-8">
		<div class="space-y-4">
			<a href="/jobs" class="back-link"><ArrowLeft class="size-4" />Back to Jobs</a>
			<PageHeader title={job.title} eyebrow={job.company}>
				{#snippet meta()}
					<StatusBadge status={job.status} class="h-7 text-sm" />
					{#if job.createdVia === 'mcp'}
						<Badge variant="outline" class="gap-1 text-muted-foreground"
							><Bot class="size-3.5" aria-hidden="true" />Added by assistant</Badge
						>
					{/if}
				{/snippet}
				{#snippet actions()}
					<Button variant="outline" href={`/jobs/${job.id}/documents`}
						>Documents ({data.documentCount})</Button
					>
					<form method="POST" action="?/star" use:enhance={enhanceWithFocus}>
						<input type="hidden" name="is_starred" value={job.isStarred ? '0' : '1'} />
						<Button type="submit" variant="outline" aria-pressed={job.isStarred}>
							<Star
								data-icon="inline-start"
								class={job.isStarred ? 'fill-current text-primary' : ''}
							/>{job.isStarred ? 'Starred' : 'Star'}
						</Button>
					</form>
					<Button href="/jobs/{job.id}/edit" variant="outline"
						><Pencil data-icon="inline-start" />Edit</Button
					>
					<Dialog.Trigger>
						{#snippet child({ props })}
							<Button {...props}><Plus data-icon="inline-start" />Add update</Button>
						{/snippet}
					</Dialog.Trigger>
				{/snippet}
			</PageHeader>
		</div>

		{#if pageError}
			<Notice tone="error" title="The change was not saved">{pageError}</Notice>
		{/if}

		<div class="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
			<div class="min-w-0 space-y-6">
				<Card.Root>
					<Card.Header><Card.Title class="text-base">History</Card.Title></Card.Header>
					<Card.Content>
						{#if upcoming.length > 0}
							<section aria-labelledby="upcoming-heading" class="mb-7 space-y-3">
								<h3 id="upcoming-heading" class="text-sm font-medium text-muted-foreground">
									Upcoming
								</h3>
								<Timeline entries={upcoming} scheduled {errors} {values} />
							</section>
						{/if}

						{#if history.length === 0 && upcoming.length === 0}
							<div class="rounded-[var(--r-group)] bg-muted/60 px-5 py-8 text-center">
								<p class="font-medium">No updates yet</p>
								<p class="mt-1 text-sm text-muted-foreground">
									Record the first step, like applying, when it happens.
								</p>
								<Button class="mt-4" onclick={() => (open = true)}
									><Plus data-icon="inline-start" />Add update</Button
								>
							</div>
						{:else if history.length > 0}
							<Timeline entries={history} {errors} {values} />
						{/if}
					</Card.Content>
				</Card.Root>

				{#if job.description}
					<Card.Root>
						<Card.Header><Card.Title class="text-base">Job description</Card.Title></Card.Header>
						<Card.Content class="space-y-3">
							<p
								id="job-description"
								class="text-base leading-relaxed break-words whitespace-pre-wrap text-muted-foreground {longDescription &&
								!descriptionOpen
									? 'line-clamp-8'
									: ''}"
							>
								{job.description}
							</p>
							{#if longDescription}
								<Button
									variant="ghost"
									size="sm"
									class="-ml-2"
									aria-expanded={descriptionOpen}
									aria-controls="job-description"
									onclick={() => (descriptionOpen = !descriptionOpen)}
									>{descriptionOpen ? 'Show less' : 'Show more'}</Button
								>
							{/if}
						</Card.Content>
					</Card.Root>
				{/if}
			</div>

			<aside class="min-w-0 space-y-6">
				<Card.Root>
					<Card.Header><Card.Title class="text-base">Follow-up</Card.Title></Card.Header>
					<Card.Content class="space-y-4">
						{#if job.followUpDate}
							<p class="text-sm font-medium">
								{job.followUpDate < data.today ? 'Overdue · ' : ''}{relativeDay(
									job.followUpDate,
									data.today
								)}
							</p>
							{#if job.followUpComment}<p class="text-sm break-words whitespace-pre-wrap">
									{job.followUpComment}
								</p>{/if}
						{:else}<p class="text-sm text-muted-foreground">No follow-up scheduled.</p>{/if}
						{#if !job.isActive && job.followUpDate}<p class="text-sm text-muted-foreground">
								Kept here while inactive. Reopening shows it on the Dashboard again.
							</p>{/if}
						<details
							class="disclosure inset-surface group"
							open={form?.action === 'followUp' && Boolean(form?.errors)}
						>
							<summary
								>{job.followUpDate ? 'Reschedule or edit' : 'Schedule follow-up'}<ChevronDown
									class="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
								/></summary
							>
							<form
								method="POST"
								action="?/followUp"
								use:enhance={enhanceWithFocus}
								class="disclosure-body"
							>
								{#if form?.action === 'followUp' && errors.form}<Notice
										tone="error"
										title="Follow-up was not saved">{errors.form}</Notice
									>{/if}
								<Field
									id="follow_up_date"
									label="Follow-up date"
									error={form?.action === 'followUp' ? errors.follow_up_date : undefined}
								>
									{#snippet control(attrs)}<Input
											{...attrs}
											name="follow_up_date"
											type="date"
											value={form?.action === 'followUp'
												? (values.follow_up_date ?? job.followUpDate ?? '')
												: (job.followUpDate ?? '')}
										/>{/snippet}
								</Field>
								<Field
									id="follow_up_comment"
									label="Comment"
									hint="Optional. Set a date to add a comment."
									error={form?.action === 'followUp' ? errors.follow_up_comment : undefined}
								>
									{#snippet control(attrs)}<Textarea
											{...attrs}
											name="follow_up_comment"
											rows={3}
											maxlength={10000}
											value={form?.action === 'followUp'
												? (values.follow_up_comment ?? job.followUpComment ?? '')
												: (job.followUpComment ?? '')}
										/>{/snippet}
								</Field>
								<Button type="submit" variant="outline">Save follow-up</Button>
							</form>
						</details>
						{#if job.followUpDate}<form
								method="POST"
								action="?/clearFollowUp"
								use:enhance={enhanceWithFocus}
							>
								<Button type="submit" variant="ghost" size="sm">Clear follow-up</Button>
							</form>{/if}
					</Card.Content>
				</Card.Root>
				<Card.Root>
					<Card.Header><Card.Title class="text-base">Assistant assessment</Card.Title></Card.Header>
					<Card.Content class="space-y-3">
						<p class="text-2xl font-semibold tabular-nums">{job.score ?? 'Unscored'}</p>
						{#if job.scoreComment}<p class="text-sm break-words whitespace-pre-wrap">
								{job.scoreComment}
							</p>{/if}
						<p class="text-sm text-muted-foreground">
							Your AI assistant manages the score and its explanation.
						</p>
					</Card.Content>
				</Card.Root>
				<Card.Root>
					<Card.Header><Card.Title class="text-base">Job information</Card.Title></Card.Header>
					<Card.Content class="space-y-4 text-sm">
						{#each jobInfoFields as field (field.name)}
							{#if job[field.key]}<div class="space-y-1">
									<p class="text-muted-foreground">{field.label}</p>
									<p class="break-words whitespace-pre-wrap">
										{field.type === 'date' ? formatDate(job[field.key]) : job[field.key]}
									</p>
								</div>{/if}
						{/each}
						{#if job.postingUrl}
							<div class="space-y-1">
								<p class="text-muted-foreground">Job posting link</p>
								<a
									href={job.postingUrl}
									target="_blank"
									rel="noopener noreferrer"
									title={job.postingUrl}
									class="inline-flex items-center gap-1 font-medium break-all text-primary hover:underline"
									>{hostOf(job.postingUrl)}<ExternalLink class="size-3.5 shrink-0" /><span
										class="sr-only">(opens in a new tab)</span
									></a
								>
							</div>
						{/if}
						<div class="space-y-1">
							<p class="text-muted-foreground">Job notes</p>
							<p class="break-words whitespace-pre-wrap">{job.notes ?? 'No notes yet.'}</p>
						</div>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header
						><Card.Title class="text-base">Stop pursuing this job?</Card.Title></Card.Header
					>
					<Card.Content class="space-y-3 text-sm text-muted-foreground">
						<p>
							<span class="font-medium text-foreground">Dismiss</span> means you stopped pursuing
							it. <span class="font-medium text-foreground">Rejected</span> means the employer declined.
							You can reopen a dismissed job.
						</p>
						{#if job.isActive}
							<form
								id="dismiss-form"
								method="POST"
								action="?/dismiss"
								use:enhance={() =>
									async ({ update }) => {
										await update();
										dismissOpen = false;
										await tick();
										focusFirstError();
									}}
							>
								<input type="hidden" name="event_date" value={data.today} />
								<Button
									type="button"
									variant="outline"
									class="w-full"
									onclick={() => (dismissOpen = true)}>Dismiss job</Button
								>
							</form>
						{:else if canReopen}
							<form method="POST" action="?/reopen" use:enhance>
								<input type="hidden" name="event_date" value={data.today} /><Button
									type="submit"
									variant="outline"
									class="w-full">Reopen job</Button
								>
							</form>
						{:else}
							<p class="rounded-[var(--r-group)] bg-muted px-3 py-2">
								This job is inactive after an outcome. Correct that update if it was recorded by
								mistake.
							</p>
						{/if}
					</Card.Content>
				</Card.Root>
			</aside>
		</div>
	</div>

	<Dialog.Content class="sm:max-w-md">
		<form
			method="POST"
			action="?/addUpdate"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					if (result.type === 'redirect') {
						open = false;
						return;
					}
					await tick();
					focusFirstError();
				}}
			class="grid gap-5"
		>
			<Dialog.Header>
				<Dialog.Title>Add update</Dialog.Title>
				<Dialog.Description>Record what happened on this job.</Dialog.Description>
			</Dialog.Header>
			{#if addErrors.form}
				<Notice tone="error" title="The update was not saved">{addErrors.form}</Notice>
			{/if}
			<Field id="event_type" label="What happened?" error={addErrors.event_type}>
				{#snippet control(attrs)}
					<NativeSelect {...attrs} name="event_type" bind:value={selectedType}>
						{#each choices as option (option.value)}<option value={option.value}
								>{option.label}</option
							>{/each}
					</NativeSelect>
				{/snippet}
			</Field>
			<Field
				id="event_date"
				label={isInterview ? 'Interview date' : 'Date'}
				hint={isInterview
					? 'A confirmed future interview counts as reaching that step.'
					: undefined}
				error={addErrors.event_date}
			>
				{#snippet control(attrs)}<Input
						{...attrs}
						name="event_date"
						type="date"
						value={values.event_date ?? data.today}
					/>{/snippet}
			</Field>
			<Field id="note" label="Note" required={selectedType === 'note'} error={addErrors.note}>
				{#snippet control(attrs)}<Textarea
						{...attrs}
						name="note"
						rows={3}
						value={values.note ?? ''}
					/>{/snippet}
			</Field>
			<Dialog.Footer>
				<Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit">Save update</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<ConfirmDialog
	bind:open={dismissOpen}
	title="Dismiss this job?"
	description="Saturday will stop counting it as active. You can reopen it later from this page."
	confirmLabel="Dismiss job"
	formId="dismiss-form"
	destructive
/>

<div class="mt-8">
	<Card.Root
		><Card.Header
			><Card.Title>Job documents</Card.Title><Card.Description
				>{data.documentCount} attachments for this job.</Card.Description
			></Card.Header
		><Card.Content class="space-y-4"
			>{#if data.documentsError}<Notice tone="error">{data.documentsError}</Notice
				>{/if}{#if data.documents.length}<ul class="divide-y">
					{#each data.documents.slice(0, 5) as doc}<li
							class="flex flex-wrap items-center justify-between gap-3 py-3"
						>
							<a class="min-w-0 break-all underline" href={`/jobs/${job.id}/documents/${doc.id}`}
								>{doc.filename}</a
							><a class="text-sm underline" href={`/api/files/${doc.id}?scope=${job.id}`}
								>Download<span class="sr-only"> {doc.filename}</span></a
							>
						</li>{/each}
				</ul>{:else}<p class="text-sm text-muted-foreground">
					Add a tailored resume, cover letter or notes for this job.
				</p>{/if}<Button variant="outline" href={`/jobs/${job.id}/documents`}
				>Manage job documents</Button
			></Card.Content
		></Card.Root
	>
</div>
