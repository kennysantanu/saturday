<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';
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
	let personPickerOpen = $state(false);
	let networkNoteOpen = $state(false);
	let notePersonId = $state('');
	let notePersonName = $state('');
	let networkNote = $state('');
	const networkErrors = $derived(
		form?.action?.startsWith('network-') ? errors : data.networkErrors
	);
	$effect(() => {
		personPickerOpen = !!data.personPicker;
	});
	$effect(() => {
		if (!form?.errors) return;
		if (form.action === 'network-linked') personPickerOpen = true;
		if (form.action === 'network-note') {
			networkNoteOpen = true;
			notePersonId = values.network_id ?? '';
			networkNote = values.notes ?? '';
		}
	});
	function networkHref(changes: Record<string, string | number | null>) {
		const query = new URLSearchParams(page.url.searchParams);
		for (const key of [...query.keys()])
			if (key.startsWith('/') || key === 'saved') query.delete(key);
		for (const [key, value] of Object.entries(changes)) {
			if (value === null || value === '') query.delete(key);
			else query.set(key, String(value));
		}
		return page.url.pathname + (query.size ? '?' + query : '');
	}
	function networkAction(name: string) {
		const query = new URLSearchParams(page.url.searchParams);
		for (const key of [...query.keys()]) if (key.startsWith('/')) query.delete(key);
		return '?/' + name + (query.size ? '&' + query : '');
	}
	const enhanceNetwork: SubmitFunction =
		() =>
		async ({ result, update }) => {
			if (result.type === 'redirect' || result.type === 'success') {
				networkNoteOpen = false;
			}
			await update();
			await tick();
			focusFirstError();
		};
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

<div class="mt-8">
	<Card.Root
		><Card.Header class="flex flex-row flex-wrap items-center justify-between gap-3"
			><Card.Title
				>Network <span class="text-muted-foreground">({data.people.total})</span></Card.Title
			><Button variant="outline" href={networkHref({ link_person: '1', person_page: null })}
				>Link person</Button
			></Card.Header
		><Card.Content class="space-y-4">
			{#if form?.action === 'network-unlinked' && networkErrors.form}<Notice
					tone="error"
					title="Could not unlink">{networkErrors.form}</Notice
				>{/if}
			{#if Object.keys(data.networkErrors).length}<Notice
					tone="error"
					title="Check the search or page values"
					>{Object.values(data.networkErrors).join(' ')}</Notice
				>{/if}
			{#if !data.people.networks.length}<p class="text-sm text-muted-foreground">
					No linked people yet.
				</p>{/if}
			{#each data.people.networks as person (person.id)}<div
					class="space-y-3 border-b pb-4 last:border-0 last:pb-0"
				>
					<div>
						<a
							class="font-medium break-words text-primary hover:underline"
							href={`/networks/${person.id}`}>{person.name}</a
						>
						<p class="text-sm break-words text-muted-foreground">
							{[person.role, person.organization].filter(Boolean).join(' · ')}
						</p>
					</div>
					{#if person.job_link.notes}<p class="text-sm break-words whitespace-pre-wrap">
							<span class="text-muted-foreground">Relationship note:</span>{' '}{person.job_link
								.notes}
						</p>{/if}
					<div class="flex flex-wrap gap-2">
						<Button
							variant="ghost"
							size="sm"
							onclick={() => {
								notePersonId = person.id;
								notePersonName = person.name;
								networkNote = person.job_link.notes ?? '';
								networkNoteOpen = true;
							}}>Edit link note</Button
						>
						<form
							method="POST"
							action={networkAction('networkUnlink')}
							use:enhance={enhanceNetwork}
						>
							<input type="hidden" name="network_id" value={person.id} /><Button
								type="submit"
								size="sm"
								variant="ghost"
								aria-label={`Unlink ${person.name}`}>Unlink</Button
							>
						</form>
					</div>
				</div>{/each}
			{#if data.people.totalPages > 1}<nav
					aria-label="Linked people pages"
					class="flex flex-wrap items-center justify-between gap-3"
				>
					<Button
						variant="outline"
						href={networkHref({ network_page: data.people.page - 1 })}
						disabled={data.people.page <= 1}>Previous</Button
					><span class="text-sm">Page {data.people.page} of {data.people.totalPages}</span><Button
						variant="outline"
						href={networkHref({ network_page: data.people.page + 1 })}
						disabled={data.people.page >= data.people.totalPages}>Next</Button
					>
				</nav>{/if}
		</Card.Content></Card.Root
	>
</div>
<Dialog.Root bind:open={networkNoteOpen}
	><Dialog.Content
		><Dialog.Header
			><Dialog.Title>Edit link note</Dialog.Title><Dialog.Description
				>{notePersonName || 'Linked person'} · {job.title}</Dialog.Description
			></Dialog.Header
		>
		<form
			method="POST"
			action={networkAction('networkNote')}
			use:enhance={enhanceNetwork}
			class="space-y-5"
		>
			<input
				type="hidden"
				name="network_id"
				value={notePersonId}
			/>{#if form?.action === 'network-note' && networkErrors.form}<Notice
					tone="error"
					title="Link note not saved">{networkErrors.form}</Notice
				>{/if}<Field
				id="network_relationship_note"
				label="Relationship note"
				error={form?.action === 'network-note' ? networkErrors.notes : undefined}
				>{#snippet control(attrs)}<Textarea
						{...attrs}
						name="notes"
						maxlength={2000}
						rows={4}
						bind:value={networkNote}
					/>{/snippet}</Field
			><Dialog.Footer
				><Button variant="ghost" onclick={() => (networkNoteOpen = false)}>Cancel</Button><Button
					type="submit">Save note</Button
				></Dialog.Footer
			>
		</form></Dialog.Content
	></Dialog.Root
>
<Dialog.Root bind:open={personPickerOpen}
	><Dialog.Content class="sm:max-w-2xl"
		><Dialog.Header
			><Dialog.Title>Link person</Dialog.Title><Dialog.Description
				>Select someone for {job.title} at {job.company}.</Dialog.Description
			></Dialog.Header
		>
		<form method="GET" action={`/jobs/${job.id}`} class="space-y-4">
			{#if Object.keys(data.networkErrors).length}<Notice
					tone="error"
					title="Check the search or page values"
					>{Object.values(data.networkErrors).join(' ')}</Notice
				>{/if}<input
				type="hidden"
				name="link_person"
				value="1"
			/>{#if data.networkQuery.network_page}<input
					type="hidden"
					name="network_page"
					value={data.networkQuery.network_page}
				/>{/if}
			<div class="grid gap-4 sm:grid-cols-3">
				<Field id="person_name" label="Name"
					>{#snippet control(attrs)}<Input
							{...attrs}
							name="person_name"
							maxlength={200}
							value={data.networkQuery.person_name ?? ''}
						/>{/snippet}</Field
				><Field id="person_role" label="Role"
					>{#snippet control(attrs)}<Input
							{...attrs}
							name="person_role"
							maxlength={200}
							value={data.networkQuery.person_role ?? ''}
						/>{/snippet}</Field
				><Field id="person_organization" label="Organization"
					>{#snippet control(attrs)}<Input
							{...attrs}
							name="person_organization"
							maxlength={200}
							value={data.networkQuery.person_organization ?? ''}
						/>{/snippet}</Field
				>
			</div>
			<Button type="submit" variant="outline">Search people</Button>
		</form>
		<Button href={`/networks/new?job_id=${job.id}`} variant="ghost">Add person</Button>
		<form
			method="POST"
			action={networkAction('networkLink')}
			use:enhance={enhanceNetwork}
			class="space-y-4"
		>
			{#if form?.action === 'network-linked' && networkErrors.form}<Notice
					tone="error"
					title="Could not link person">{networkErrors.form}</Notice
				>{/if}
			<fieldset class="space-y-2">
				<legend class="mb-2 text-sm font-medium"
					>Choose a person <span class="text-destructive" aria-hidden="true">*</span></legend
				>
				{#if data.selectedPerson && !data.personPicker?.networks.some((person: { id: string }) => person.id === data.selectedPerson.id)}<label
						class="inset-surface flex items-start gap-3 p-3"
						><input
							type="radio"
							name="network_id"
							value={data.selectedPerson.id}
							checked
							required
							disabled={data.linkedPersonIds.includes(data.selectedPerson.id)}
							class="mt-1 size-4 accent-primary"
						/><span class="text-sm break-words">{data.selectedPerson.name}</span></label
					>{/if}
				{#each data.personPicker?.networks ?? [] as person (person.id)}<label
						class="inset-surface flex items-start gap-3 p-3"
						><input
							type="radio"
							name="network_id"
							value={person.id}
							required
							disabled={data.linkedPersonIds.includes(person.id)}
							checked={(values.network_id ?? data.selectedPerson?.id) === person.id}
							class="mt-1 size-4 accent-primary"
						/><span class="min-w-0 text-sm break-words"
							>{person.name}<span class="block text-muted-foreground"
								>{[person.role, person.organization]
									.filter(Boolean)
									.join(' · ')}{data.linkedPersonIds.includes(person.id)
									? ' · Already linked'
									: ''}</span
							></span
						></label
					>{/each}
				{#if !data.personPicker?.networks.length && !data.selectedPerson}<p
						class="text-sm text-muted-foreground"
					>
						No matching people. Add a person or change the search.
					</p>{/if}
			</fieldset>
			{#if networkErrors.network_id}<p class="text-sm text-destructive" role="alert" tabindex="-1">
					{networkErrors.network_id}
				</p>{/if}
			{#if data.personPicker && data.personPicker.totalPages > 1}<nav
					aria-label="Person picker pages"
					class="flex flex-wrap items-center justify-between gap-3"
				>
					<Button
						variant="outline"
						href={networkHref({ person_page: data.personPicker.page - 1 })}
						disabled={data.personPicker.page <= 1}>Previous</Button
					><span class="text-sm"
						>Page {data.personPicker.page} of {data.personPicker.totalPages}</span
					><Button
						variant="outline"
						href={networkHref({ person_page: data.personPicker.page + 1 })}
						disabled={data.personPicker.page >= data.personPicker.totalPages}>Next</Button
					>
				</nav>{/if}
			<Field
				id="new_network_relationship_note"
				label="Relationship note"
				error={form?.action === 'network-linked' ? networkErrors.notes : undefined}
				>{#snippet control(attrs)}<Textarea
						{...attrs}
						name="notes"
						maxlength={2000}
						rows={3}
						value={form?.action === 'network-linked' ? values.notes : ''}
					/>{/snippet}</Field
			>
			<Dialog.Footer
				><Button
					variant="ghost"
					href={networkHref({
						link_person: null,
						person: null,
						person_page: null,
						person_name: null,
						person_role: null,
						person_organization: null
					})}>Cancel</Button
				><Button
					type="submit"
					disabled={!data.personPicker?.networks.length && !data.selectedPerson}>Link person</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content></Dialog.Root
>
