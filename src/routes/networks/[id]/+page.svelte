<script lang="ts">
	import { tick } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { focusFirstError } from '$lib/forms';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import Field from '$lib/components/app/field.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import ConfirmDialog from '$lib/components/app/confirm-dialog.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { formatDate, hostOf } from '$lib/format';
	let { data, form } = $props();
	const person = $derived(data.person);
	const errors = $derived(form?.errors ?? data.errors ?? {});
	const values = $derived(form?.values ?? {});
	let followOpen = $state(false);
	let interactionOpen = $state(false);
	let interactionId = $state('');
	let interactionDate = $state('');
	let interactionNote = $state('');
	let deleteOpen = $state(false);
	let deleteId = $state('');
	let noteOpen = $state(false);
	let noteJob = $state('');
	let noteJobTitle = $state('');
	let noteText = $state('');
	let pickerOpen = $state(false);
	$effect(() => {
		pickerOpen = !!data.picker;
	});
	$effect(() => {
		if (!form?.errors) return;
		if (form.action === 'follow-up') followOpen = true;
		if (form.action === 'addInteraction' || form.action === 'editInteraction') {
			interactionOpen = true;
			interactionId = values.update_id ?? '';
			interactionDate = values.interaction_date ?? data.today;
			interactionNote = values.note ?? '';
		}
		if (form.action === 'interaction-deleted' || form.action === 'deleteInteraction') {
			deleteId = values.update_id ?? '';
			deleteOpen = true;
		}
		if (form.action === 'network-note') {
			noteOpen = true;
			noteJob = values.job_id ?? '';
			noteText = values.notes ?? '';
		}
		if (form.action === 'network-linked') pickerOpen = true;
	});
	function href(changes: Record<string, string | number | null>) {
		const params = new URLSearchParams(page.url.searchParams);
		for (const key of [...params.keys()])
			if (key.startsWith('/') || key === 'saved') params.delete(key);
		for (const [key, value] of Object.entries(changes)) {
			if (value === null || value === '') params.delete(key);
			else params.set(key, String(value));
		}
		return page.url.pathname + (params.size ? '?' + params : '');
	}
	function action(name: string) {
		const params = new URLSearchParams(page.url.searchParams);
		for (const key of [...params.keys()]) if (key.startsWith('/')) params.delete(key);
		return '?/' + name + (params.size ? '&' + params : '');
	}
	function addInteraction() {
		interactionId = '';
		interactionDate = data.today;
		interactionNote = '';
		interactionOpen = true;
	}
	const enhanceNetwork: SubmitFunction =
		() =>
		async ({ result, update }) => {
			if (result.type === 'redirect' || result.type === 'success') {
				followOpen = false;
				interactionOpen = false;
				deleteOpen = false;
				noteOpen = false;
			}
			await update();
			await tick();
			focusFirstError();
		};
</script>

<svelte:head><title>{person.name} · Network · Saturday</title></svelte:head>
<div class="space-y-8">
	<div class="space-y-4">
		<a href="/networks" class="back-link"><ArrowLeft class="size-4" />Back to Network</a><PageHeader
			title={person.name}
			description={[person.role, person.organization].filter(Boolean).join(' · ')}
			>{#snippet actions()}<Button href={`/networks/${person.id}/edit`} variant="outline"
					><Pencil data-icon="inline-start" />Edit details</Button
				>{/snippet}</PageHeader
		>
	</div>
	{#if data.missingJob}<Notice title="Person saved"
			>The originating job is no longer available. This person is saved in Network.</Notice
		>{/if}
	{#if Object.keys(data.errors).length}<Notice tone="error" title="Check the page or search values"
			>{Object.values(data.errors).join(' ')}</Notice
		>{/if}
	{#if ['network-unlinked', 'follow-up-cleared'].includes(form?.action ?? '') && errors.form}<Notice
			tone="error"
			title="Could not save change">{errors.form}</Notice
		>{/if}
	<div class="grid gap-6 lg:grid-cols-2">
		<Card.Root
			><Card.Header><Card.Title>Details</Card.Title></Card.Header><Card.Content class="space-y-5">
				<dl class="space-y-4 text-sm">
					<div>
						<dt class="text-muted-foreground">Phone</dt>
						<dd class="break-words">
							{#if person.phone}<a
									class="text-primary hover:underline"
									href={`tel:${encodeURIComponent(person.phone)}`}>{person.phone}</a
								>{:else}Not specified{/if}
						</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Email</dt>
						<dd class="break-words">
							{#if person.email}<a
									class="text-primary hover:underline"
									href={`mailto:${encodeURIComponent(person.email)}`}>{person.email}</a
								>{:else}Not specified{/if}
						</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Profile or website</dt>
						<dd class="break-words">
							{#if person.link}<a
									class="text-primary hover:underline"
									href={person.link}
									target="_blank"
									rel="noopener noreferrer"
									title={person.link}
									>{hostOf(person.link)}<span class="sr-only"> (opens in a new tab)</span></a
								>{:else}Not specified{/if}
						</dd>
					</div>
					<div>
						<dt class="text-muted-foreground">Notes</dt>
						<dd class="break-words whitespace-pre-wrap">{person.notes ?? 'No notes yet'}</dd>
					</div>
				</dl>
			</Card.Content></Card.Root
		>
		<Card.Root
			><Card.Header><Card.Title>Follow-up</Card.Title></Card.Header><Card.Content class="space-y-4">
				<p class:text-destructive={person.follow_up_date && person.follow_up_date < data.today}>
					{person.follow_up_date
						? formatDate(person.follow_up_date)
						: 'Not scheduled'}{person.follow_up_date && person.follow_up_date < data.today
						? ' · Overdue'
						: person.follow_up_date === data.today
							? ' · Today'
							: ''}
				</p>
				{#if person.follow_up_comment}<p class="text-sm break-words whitespace-pre-wrap">
						{person.follow_up_comment}
					</p>{/if}
				<div class="flex flex-wrap gap-3">
					<Button variant="outline" onclick={() => (followOpen = true)}
						>{person.follow_up_date ? 'Reschedule' : 'Schedule follow-up'}</Button
					>{#if person.follow_up_date}<form
							method="POST"
							action={action('clearFollowUp')}
							use:enhance={enhanceNetwork}
						>
							<Button type="submit" variant="ghost">Clear follow-up</Button>
						</form>{/if}
				</div>
			</Card.Content></Card.Root
		>
	</div>
	<Card.Root
		><Card.Header class="flex flex-row flex-wrap items-center justify-between gap-3"
			><Card.Title
				>Linked jobs <span class="text-muted-foreground">({data.linkedJobs.total})</span
				></Card.Title
			><Button href={href({ link_job: '1', picker_page: null, job_query: null })} variant="outline"
				>Link to job</Button
			></Card.Header
		><Card.Content class="space-y-4">
			{#if !data.linkedJobs.jobs.length}<p class="text-sm text-muted-foreground">
					No linked jobs yet.
				</p>{/if}
			{#each data.linkedJobs.jobs as job (job.id)}
				<div class="space-y-3 border-b pb-4 last:border-0 last:pb-0">
					<div class="min-w-0">
						<a class="font-medium break-words text-primary hover:underline" href={`/jobs/${job.id}`}
							>{job.job_title}</a
						>
						<p class="text-sm break-words text-muted-foreground">
							{job.company_name}{!job.is_active ? ' · Inactive' : ''}
						</p>
					</div>
					{#if job.job_link.notes}<p class="text-sm break-words whitespace-pre-wrap">
							<span class="text-muted-foreground">Relationship note:</span>{' '}{job.job_link.notes}
						</p>{/if}
					<div class="flex flex-wrap gap-2">
						<Button
							variant="ghost"
							size="sm"
							onclick={() => {
								noteJob = job.id;
								noteJobTitle = job.job_title;
								noteText = job.job_link.notes ?? '';
								noteOpen = true;
							}}>Edit link note</Button
						>
						<form method="POST" action={action('unlink')} use:enhance={enhanceNetwork}>
							<input type="hidden" name="job_id" value={job.id} /><Button
								type="submit"
								variant="ghost"
								size="sm"
								aria-label={`Unlink ${job.job_title}`}>Unlink</Button
							>
						</form>
					</div>
				</div>
			{/each}
			{#if data.linkedJobs.totalPages > 1}<nav
					aria-label="Linked job pages"
					class="flex flex-wrap items-center justify-between gap-3"
				>
					<Button
						variant="outline"
						href={href({ jobs_page: data.linkedJobs.page - 1 })}
						disabled={data.linkedJobs.page <= 1}>Previous</Button
					><span class="text-sm">Page {data.linkedJobs.page} of {data.linkedJobs.totalPages}</span
					><Button
						variant="outline"
						href={href({ jobs_page: data.linkedJobs.page + 1 })}
						disabled={data.linkedJobs.page >= data.linkedJobs.totalPages}>Next</Button
					>
				</nav>{/if}
		</Card.Content></Card.Root
	>
	<Card.Root
		><Card.Header class="flex flex-row flex-wrap items-center justify-between gap-3"
			><div class="space-y-2">
				<Card.Title>Interactions</Card.Title>
				<p class="text-sm text-muted-foreground">
					{person.latest_interaction_date
						? `Last recorded: ${formatDate(person.latest_interaction_date)} · ${person.interaction_count} recorded`
						: 'No interactions recorded'}
				</p>
			</div>
			<Button variant="outline" onclick={addInteraction}
				><Plus data-icon="inline-start" />Add interaction</Button
			></Card.Header
		><Card.Content class="space-y-5">
			{#each data.history.updates as entry (entry.id)}
				<div class="space-y-3 border-b pb-5 last:border-0 last:pb-0">
					<p class="text-sm text-muted-foreground">{formatDate(entry.interaction_date)}</p>
					<p class="text-sm break-words whitespace-pre-wrap">{entry.note}</p>
					<div class="flex gap-2">
						<Button
							size="sm"
							variant="ghost"
							onclick={() => {
								interactionId = entry.id;
								interactionDate = entry.interaction_date;
								interactionNote = entry.note;
								interactionOpen = true;
							}}
							aria-label={`Edit interaction on ${formatDate(entry.interaction_date)}`}>Edit</Button
						><Button
							size="sm"
							variant="ghost"
							onclick={() => {
								deleteId = entry.id;
								deleteOpen = true;
							}}
							aria-label={`Delete interaction on ${formatDate(entry.interaction_date)}`}
							>Delete</Button
						>
					</div>
				</div>
			{/each}
			{#if data.history.totalPages > 1}<nav
					aria-label="Interaction pages"
					class="flex flex-wrap items-center justify-between gap-3"
				>
					<Button
						variant="outline"
						href={href({ updates_page: data.history.page - 1 })}
						disabled={data.history.page <= 1}>Previous</Button
					><span class="text-sm">Page {data.history.page} of {data.history.totalPages}</span><Button
						variant="outline"
						href={href({ updates_page: data.history.page + 1 })}
						disabled={data.history.page >= data.history.totalPages}>Next</Button
					>
				</nav>{/if}
		</Card.Content></Card.Root
	>
</div>
<Dialog.Root bind:open={followOpen}
	><Dialog.Content
		><Dialog.Header
			><Dialog.Title
				>{person.follow_up_date ? 'Reschedule follow-up' : 'Schedule follow-up'}</Dialog.Title
			><Dialog.Description
				>Plan your next contact with {person.name}. Recording an interaction keeps this reminder.</Dialog.Description
			></Dialog.Header
		>
		<form method="POST" action={action('followUp')} use:enhance={enhanceNetwork} class="space-y-5">
			{#if form?.action === 'follow-up' && errors.form}<Notice
					tone="error"
					title="Follow-up not saved">{errors.form}</Notice
				>{/if}
			<Field
				id="follow_up_date"
				label="Follow-up date"
				error={form?.action === 'follow-up' ? errors.follow_up_date : undefined}
				>{#snippet control(attrs)}<Input
						{...attrs}
						type="date"
						name="follow_up_date"
						value={form?.action === 'follow-up'
							? values.follow_up_date
							: (person.follow_up_date ?? '')}
					/>{/snippet}</Field
			>
			<Field
				id="follow_up_comment"
				label="Follow-up comment"
				hint="Clearing the date also clears the comment."
				error={form?.action === 'follow-up' ? errors.follow_up_comment : undefined}
				>{#snippet control(attrs)}<Textarea
						{...attrs}
						name="follow_up_comment"
						maxlength={2000}
						value={form?.action === 'follow-up'
							? values.follow_up_comment
							: (person.follow_up_comment ?? '')}
					/>{/snippet}</Field
			>
			<Dialog.Footer
				><Button variant="ghost" onclick={() => (followOpen = false)}>Cancel</Button><Button
					type="submit">Save follow-up</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content></Dialog.Root
>
<Dialog.Root bind:open={interactionOpen}
	><Dialog.Content
		><Dialog.Header
			><Dialog.Title>{interactionId ? 'Edit interaction' : 'Add interaction'}</Dialog.Title
			><Dialog.Description
				>Record what happened with {person.name}. Future contact belongs in Follow-up.</Dialog.Description
			></Dialog.Header
		>
		<form
			method="POST"
			action={action(interactionId ? 'editInteraction' : 'addInteraction')}
			use:enhance={enhanceNetwork}
			class="space-y-5"
		>
			<p class="text-sm text-muted-foreground">
				<span class="text-destructive" aria-hidden="true">*</span> Required
			</p>
			{#if (form?.action === 'addInteraction' || form?.action === 'editInteraction') && errors.form}<Notice
					tone="error"
					title="Interaction not saved">{errors.form}</Notice
				>{/if}
			{#if interactionId}<input type="hidden" name="update_id" value={interactionId} />{/if}
			<Field id="interaction_date" label="Interaction date" required error={errors.interaction_date}
				>{#snippet control(attrs)}<Input
						{...attrs}
						type="date"
						name="interaction_date"
						max={data.today}
						bind:value={interactionDate}
					/>{/snippet}</Field
			>
			<Field id="interaction_note" label="Interaction note" required error={errors.note}
				>{#snippet control(attrs)}<Textarea
						{...attrs}
						name="note"
						rows={6}
						maxlength={20000}
						bind:value={interactionNote}
					/>{/snippet}</Field
			>
			<Dialog.Footer
				><Button variant="ghost" onclick={() => (interactionOpen = false)}>Cancel</Button><Button
					type="submit">Save interaction</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content></Dialog.Root
>
<form
	id="delete-interaction"
	method="POST"
	action={action('deleteInteraction')}
	use:enhance={enhanceNetwork}
>
	<input type="hidden" name="update_id" value={deleteId} /><input
		type="hidden"
		name="confirm"
		value="true"
	/>
</form>
<ConfirmDialog
	bind:open={deleteOpen}
	title="Delete interaction?"
	description={`This permanently removes this recorded interaction with ${person.name}. Their details, follow-up and job links are kept.`}
	confirmLabel="Delete interaction"
	formId="delete-interaction"
	destructive
	>{#if errors.form && (form?.action === 'deleteInteraction' || form?.action === 'interaction-deleted')}<Notice
			tone="error"
			title="Could not delete interaction">{errors.form}</Notice
		>{/if}</ConfirmDialog
>
<Dialog.Root bind:open={noteOpen}
	><Dialog.Content
		><Dialog.Header
			><Dialog.Title>Edit link note</Dialog.Title><Dialog.Description
				>{person.name} · {noteJobTitle || 'Linked job'}</Dialog.Description
			></Dialog.Header
		>
		<form method="POST" action={action('note')} use:enhance={enhanceNetwork} class="space-y-5">
			<input
				type="hidden"
				name="job_id"
				value={noteJob}
			/>{#if form?.action === 'network-note' && errors.form}<Notice
					tone="error"
					title="Link note not saved">{errors.form}</Notice
				>{/if}<Field
				id="relationship_notes"
				label="Relationship note"
				error={form?.action === 'network-note' ? errors.notes : undefined}
				>{#snippet control(attrs)}<Textarea
						{...attrs}
						name="notes"
						maxlength={2000}
						rows={4}
						bind:value={noteText}
					/>{/snippet}</Field
			><Dialog.Footer
				><Button variant="ghost" onclick={() => (noteOpen = false)}>Cancel</Button><Button
					type="submit">Save note</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content></Dialog.Root
>
<Dialog.Root bind:open={pickerOpen}
	><Dialog.Content class="sm:max-w-2xl"
		><Dialog.Header
			><Dialog.Title>Link to job</Dialog.Title><Dialog.Description
				>Select an existing job for {person.name}. Inactive jobs are included.</Dialog.Description
			></Dialog.Header
		>
		<form method="GET" action={`/networks/${person.id}`} class="space-y-3">
			{#if Object.keys(data.errors).length}<Notice
					tone="error"
					title="Check the search or page values">{Object.values(data.errors).join(' ')}</Notice
				>{/if}<input type="hidden" name="link_job" value="1" />{#if data.query.jobs_page}<input
					type="hidden"
					name="jobs_page"
					value={data.query.jobs_page}
				/>{/if}{#if data.query.updates_page}<input
					type="hidden"
					name="updates_page"
					value={data.query.updates_page}
				/>{/if}<Field id="job_query" label="Job title or company"
				>{#snippet control(attrs)}<Input
						{...attrs}
						name="job_query"
						value={data.query.job_query ?? ''}
						maxlength={200}
					/>{/snippet}</Field
			><Button type="submit" variant="outline">Search jobs</Button>
		</form>
		<form method="POST" action={action('link')} use:enhance={enhanceNetwork} class="space-y-4">
			{#if form?.action === 'network-linked' && errors.form}<Notice
					tone="error"
					title="Could not link job">{errors.form}</Notice
				>{/if}
			<fieldset class="space-y-2">
				<legend class="mb-2 text-sm font-medium"
					>Choose a job <span class="text-destructive" aria-hidden="true">*</span></legend
				>
				{#each data.picker?.jobs ?? [] as job (job.id)}<label
						class="inset-surface flex items-start gap-3 p-3"
						><input
							type="radio"
							name="job_id"
							value={job.id}
							required
							disabled={data.linkedIds.includes(job.id)}
							checked={values.job_id === job.id}
							class="mt-1 size-4 accent-primary"
						/><span class="min-w-0 text-sm break-words"
							>{job.title}<span class="block text-muted-foreground"
								>{job.company}{!job.isActive ? ' · Inactive' : ''}{data.linkedIds.includes(job.id)
									? ' · Already linked'
									: ''}</span
							></span
						></label
					>{/each}
				{#if !data.picker?.jobs.length}<p class="text-sm text-muted-foreground">
						No matching jobs. <a href="/jobs/new" class="text-primary hover:underline">Add a job</a>
					</p>{/if}
			</fieldset>
			{#if errors.job_id}<p class="text-sm text-destructive" role="alert" tabindex="-1">
					{errors.job_id}
				</p>{/if}
			{#if data.picker && data.picker.totalPages > 1}<nav
					aria-label="Job picker pages"
					class="flex flex-wrap items-center justify-between gap-3"
				>
					<Button
						variant="outline"
						href={href({ picker_page: data.picker.page - 1 })}
						disabled={data.picker.page <= 1}>Previous</Button
					><span class="text-sm">Page {data.picker.page} of {data.picker.totalPages}</span><Button
						variant="outline"
						href={href({ picker_page: data.picker.page + 1 })}
						disabled={data.picker.page >= data.picker.totalPages}>Next</Button
					>
				</nav>{/if}
			<Field
				id="link_notes"
				label="Relationship note"
				error={form?.action === 'network-linked' ? errors.notes : undefined}
				>{#snippet control(attrs)}<Textarea
						{...attrs}
						name="notes"
						maxlength={2000}
						rows={3}
						value={form?.action === 'network-linked' ? values.notes : ''}
					/>{/snippet}</Field
			>
			<Dialog.Footer
				><Button variant="ghost" href={href({ link_job: null, job_query: null, picker_page: null })}
					>Cancel</Button
				><Button type="submit" disabled={!data.picker?.jobs.length}>Link job</Button></Dialog.Footer
			>
		</form>
	</Dialog.Content></Dialog.Root
>
