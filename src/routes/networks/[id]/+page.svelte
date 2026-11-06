<script lang="ts">
	import RecordTags from '$lib/components/app/record-tags.svelte';
	import RemindersSection from '$lib/components/app/reminders-section.svelte';
	import ActivityReminderFields from '$lib/components/app/activity-reminder-fields.svelte';
	import type { ReminderDraft } from '$lib/reminders';
	import RecordDeleteAction from '$lib/components/app/record-delete-action.svelte';
	import { tick, untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { focusFirstError, withPending } from '$lib/forms';
	import { networkDetailUrl } from '$lib/network-navigation.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Link2 from '@lucide/svelte/icons/link-2';
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import Field from '$lib/components/app/field.svelte';
	import SearchField from '$lib/components/app/search-field.svelte';
	import SearchEmpty from '$lib/components/app/search-empty.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import ConfirmDialog from '$lib/components/app/confirm-dialog.svelte';
	import UnsavedDialog from '$lib/components/app/unsaved-dialog.svelte';
	import { UnsavedChanges } from '$lib/unsaved.svelte';
	import DueBadge from '$lib/components/app/due-badge.svelte';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import LinkedItem from '$lib/components/app/linked-item.svelte';
	import Pagination from '$lib/components/app/pagination.svelte';
	import RadioOption from '$lib/components/app/radio-option.svelte';
	import SectionCard from '$lib/components/app/section-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { formatDate, hostOf } from '$lib/format';
	let { data, form } = $props();
	const person = $derived(data.person);
	const errors = $derived(form?.errors ?? data.errors ?? {});
	const values = $derived(form?.values ?? {});
	const interactionGuard = new UnsavedChanges();
	const noteGuard = new UnsavedChanges();
	const dialogGuards: Record<string, UnsavedChanges> = {
		'network-interaction': interactionGuard,
		'network-link-note': noteGuard
	};
	let interactionOpen = $state(false);
	let interactionId = $state('');
	let interactionDate = $state('');
	let interactionNote = $state('');
	let addReminder = $state(false);
	let interactionReminder = $state<ReminderDraft>({
		reminder_date: untrack(() => data.today),
		reminder_time: '00:00',
		reminder_note: ''
	});
	let deleteOpen = $state(false);
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
		if (
			['addInteraction', 'editInteraction', 'deleteInteraction', 'interaction-deleted'].includes(
				form.action
			)
		) {
			interactionOpen = true;
			interactionId = values.update_id ?? '';
			interactionDate = values.interaction_date ?? data.today;
			interactionNote = values.note ?? '';
			addReminder = values.add_reminder === 'on';
			interactionReminder = {
				reminder_date: values.reminder_date ?? data.today,
				reminder_time: values.reminder_time ?? '00:00',
				reminder_note: values.reminder_note ?? ''
			};
			deleteOpen = false;
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
	function formAction(name: string) {
		const params = new URLSearchParams(page.url.searchParams);
		for (const key of [...params.keys()]) if (key.startsWith('/')) params.delete(key);
		return '?/' + name + (params.size ? '&' + params : '');
	}
	function addInteraction() {
		addReminder = false;
		interactionReminder = { reminder_date: data.today, reminder_time: '00:00', reminder_note: '' };
		interactionId = '';
		interactionDate = data.today;
		interactionNote = '';
		interactionOpen = true;
	}
	const enhanceNetwork: SubmitFunction = withPending(
		({ formElement }) => {
			const guard = dialogGuards[formElement.id];
			if (guard) guard.saving = true;
			return async ({ result, update }) => {
				if (result.type === 'redirect' || result.type === 'success') {
					if (guard) guard.dirty = false;
					interactionOpen = false;
					deleteOpen = false;
					noteOpen = false;
				}
				await update({ reset: false });
				if (guard) guard.saving = false;
				await tick();
				focusFirstError();
			};
		},
		() => {
			for (const guard of Object.values(dialogGuards)) guard.saving = false;
			deleteOpen = false;
		}
	);
</script>

<PageShell title={`${person.name} · Network`}>
	<PageHeader
		recordNumber={person.id}
		back={{
			href: data.returnTo,
			label: data.returnTo.startsWith('/jobs/')
				? 'Job'
				: data.returnTo.split('?')[0] === '/'
					? 'Dashboard'
					: 'Network'
		}}
		title={person.name}
		description={[person.role, person.organization].filter(Boolean).join(' · ')}
	>
		{#snippet actions()}<Button
				href={`/networks/${person.id}/edit?${new URLSearchParams({ return_to: networkDetailUrl(person.id, data.returnTo, page.url.searchParams) })}`}
				variant="outline"><Pencil data-icon="inline-start" />Edit details</Button
			>
			{#key person.id + person.dataset_id}
				<RecordDeleteAction
					kind="person"
					id={person.id}
					datasetId={person.dataset_id}
					name={person.name}
					counts={{ history: data.history.total, relationships: data.linkedJobs.total }}
					action={formAction('deletePerson')}
					disabled={interactionOpen || noteOpen || pickerOpen}
				/>
			{/key}
		{/snippet}
	</PageHeader>
	<RecordTags collection="person" ownerId={person.id} initial={data.tagOptions} />
	{#if data.missingJob}<Notice title="Person saved"
			>The originating job is no longer available. This person is saved in Network.</Notice
		>{/if}
	{#if Object.keys(data.errors).length}<Notice tone="error" title="Check the page or search values"
			>{Object.values(data.errors).join(' ')}</Notice
		>{/if}
	{#if form?.action === 'network-unlinked' && errors.form}<Notice
			tone="error"
			title="Could not save change">{errors.form}</Notice
		>{/if}
	<div class="grid gap-6 lg:grid-cols-2">
		<SectionCard title="Details">
			<dl class="space-y-4 text-sm">
				<div>
					<dt class="text-muted-foreground">Phone</dt>
					<dd class="break-words">
						{#if person.phone}<a class="link" href={`tel:${encodeURIComponent(person.phone)}`}
								>{person.phone}</a
							>{:else}Not specified{/if}
					</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Email</dt>
					<dd class="break-words">
						{#if person.email}<a class="link" href={`mailto:${encodeURIComponent(person.email)}`}
								>{person.email}</a
							>{:else}Not specified{/if}
					</dd>
				</div>
				<div>
					<dt class="text-muted-foreground">Profile or website</dt>
					<dd class="break-words">
						{#if person.link}<a
								class="link"
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
		</SectionCard>
		<RemindersSection data={data.reminderData} {form} today={data.today} />
	</div>

	<SectionCard title="Linked jobs" count={data.linkedJobs.total}>
		{#snippet action()}
			<Button href={href({ link_job: '1', picker_page: null, job_query: null })} variant="outline"
				><Link2 data-icon="inline-start" />Link to job</Button
			>
		{/snippet}
		{#if !data.linkedJobs.jobs.length}
			<EmptyState
				size="inline"
				title="No linked jobs yet"
				description="Link this person to a job to see how they can help."
			/>
		{/if}
		{#each data.linkedJobs.jobs as job (job.id)}
			<LinkedItem
				recordNumber={job.id}
				href={`/jobs/${job.id}`}
				title={job.job_title}
				subtitle={`${job.company_name}${!job.is_active ? ' · Closed' : ''}`}
				note={job.job_link.notes}
			>
				{#snippet actions()}
					<Button
						variant="ghost"
						size="sm"
						onclick={() => {
							noteJob = job.id;
							noteJobTitle = job.job_title;
							noteText = job.job_link.notes ?? '';
							noteOpen = true;
						}}><Pencil data-icon="inline-start" />Edit link note</Button
					>
					<form method="POST" action={formAction('unlink')} use:enhance={enhanceNetwork}>
						<input type="hidden" name="job_id" value={job.id} /><Button
							type="submit"
							variant="ghost"
							size="sm"
							aria-label={`Unlink ${job.job_title}`}>Unlink</Button
						>
					</form>
				{/snippet}
			</LinkedItem>
		{/each}
		<Pagination
			label="Linked job pages"
			page={data.linkedJobs.page}
			totalPages={data.linkedJobs.totalPages}
			previous={href({ jobs_page: data.linkedJobs.page - 1 })}
			next={href({ jobs_page: data.linkedJobs.page + 1 })}
		/>
	</SectionCard>

	<SectionCard
		title="Interactions"
		description={person.latest_interaction_date
			? `Last recorded: ${formatDate(person.latest_interaction_date)} · ${person.interaction_count} recorded`
			: 'No interactions recorded'}
	>
		{#snippet action()}
			<Button variant="outline" onclick={addInteraction}
				><Plus data-icon="inline-start" />Add interaction</Button
			>
		{/snippet}
		{#each data.history.updates as entry (entry.id)}
			<div class="space-y-2 border-b pb-4 last:border-0 last:pb-0">
				<div class="flex items-start justify-between gap-3">
					<p class="text-sm font-medium">{formatDate(entry.interaction_date)}</p>
					<Button
						variant="ghost"
						size="sm"
						onclick={() => {
							interactionId = entry.id;
							interactionDate = entry.interaction_date;
							interactionNote = entry.note;
							interactionOpen = true;
						}}><Pencil data-icon="inline-start" />Edit interaction</Button
					>
				</div>
				<p class="text-sm break-words whitespace-pre-wrap text-muted-foreground">{entry.note}</p>
			</div>
		{/each}
		<Pagination
			label="Interaction pages"
			page={data.history.page}
			totalPages={data.history.totalPages}
			previous={href({ updates_page: data.history.page - 1 })}
			next={href({ updates_page: data.history.page + 1 })}
		/>
	</SectionCard>
</PageShell>

<UnsavedDialog bind:open={interactionOpen} guard={interactionGuard}>
	{#snippet children(close)}
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>{interactionId ? 'Edit interaction' : 'Add interaction'}</Dialog.Title>
				<Dialog.Description
					>Record what happened with {person.name}. Add a reminder for future contact.</Dialog.Description
				>
			</Dialog.Header>
			<form
				id="network-interaction"
				oninput={interactionGuard.markDirty}
				method="POST"
				action={formAction(interactionId ? 'editInteraction' : 'addInteraction')}
				use:enhance={enhanceNetwork}
				class="space-y-5"
			>
				<p class="text-sm text-muted-foreground">
					<span class="text-destructive" aria-hidden="true">*</span> Required
				</p>
				{#if ['addInteraction', 'editInteraction', 'deleteInteraction', 'interaction-deleted'].includes(form?.action ?? '') && (errors.form || errors.confirm)}<Notice
						tone="error"
						title="Interaction not saved">{errors.form || errors.confirm}</Notice
					>{/if}
				{#if interactionId}<input type="hidden" name="update_id" value={interactionId} /><input
						type="hidden"
						name="confirm"
						value="true"
					/>{/if}
				<Field
					id="interaction_date"
					label="Interaction date"
					required
					error={errors.interaction_date}
				>
					{#snippet control(attrs)}<Input
							{...attrs}
							type="date"
							name="interaction_date"
							max={data.today}
							bind:value={interactionDate}
						/>{/snippet}
				</Field>
				<Field id="interaction_note" label="Interaction note" required error={errors.note}>
					{#snippet control(attrs)}<Textarea
							{...attrs}
							name="note"
							rows={3}
							maxlength={20000}
							bind:value={interactionNote}
						/>{/snippet}
				</Field>
				<!-- Reminders are created only with new activity, never while correcting existing history. -->
				{#if !interactionId}<ActivityReminderFields
						bind:enabled={addReminder}
						bind:values={interactionReminder}
						{errors}
						note={interactionNote}
						prefix="interaction-reminder"
					/>{/if}
				<Dialog.Footer class={interactionId ? 'dialog-edit-actions' : undefined}>
					{#if interactionId}<Button
							type="button"
							variant="destructive"
							onclick={() => (deleteOpen = true)}>Delete interaction</Button
						>{/if}
					<Button type="button" variant="ghost" onclick={close}>Cancel</Button>
					<Button type="submit">Save interaction</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
		<ConfirmDialog
			bind:open={deleteOpen}
			title="Delete interaction?"
			description={`This permanently removes this recorded interaction with ${person.name}. Their details, reminders and job links are kept.`}
			confirmLabel="Delete interaction"
			formId="network-interaction"
			formAction={formAction('deleteInteraction')}
			formNoValidate
			destructive
		/>
	{/snippet}
</UnsavedDialog>

<UnsavedDialog bind:open={noteOpen} guard={noteGuard}>
	{#snippet children(close)}
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Edit link note</Dialog.Title>
				<Dialog.Description>{person.name} · {noteJobTitle || 'Linked job'}</Dialog.Description>
			</Dialog.Header>
			<form
				id="network-link-note"
				oninput={noteGuard.markDirty}
				method="POST"
				action={formAction('note')}
				use:enhance={enhanceNetwork}
				class="space-y-5"
			>
				<input type="hidden" name="job_id" value={noteJob} />
				{#if form?.action === 'network-note' && errors.form}<Notice
						tone="error"
						title="Link note not saved">{errors.form}</Notice
					>{/if}
				<Field
					id="relationship_notes"
					label="Relationship note"
					error={form?.action === 'network-note' ? errors.notes : undefined}
				>
					{#snippet control(attrs)}<Textarea
							{...attrs}
							name="notes"
							maxlength={2000}
							rows={4}
							bind:value={noteText}
						/>{/snippet}
				</Field>
				<Dialog.Footer>
					<Button type="button" variant="ghost" onclick={close}>Cancel</Button>
					<Button type="submit">Save note</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	{/snippet}
</UnsavedDialog>

<Dialog.Root bind:open={pickerOpen}>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Link to job</Dialog.Title>
			<Dialog.Description
				>Select an existing job for {person.name}. Inactive jobs are included.</Dialog.Description
			>
		</Dialog.Header>
		<form method="GET" action={`/networks/${person.id}`} class="space-y-3">
			<input type="hidden" name="return_to" value={data.returnTo} />
			{#if Object.keys(data.errors).length}<Notice
					tone="error"
					title="Check the search or page values">{Object.values(data.errors).join(' ')}</Notice
				>{/if}
			<input type="hidden" name="link_job" value="1" />
			{#if data.query.jobs_page}<input
					type="hidden"
					name="jobs_page"
					value={data.query.jobs_page}
				/>{/if}
			{#if data.query.updates_page}<input
					type="hidden"
					name="updates_page"
					value={data.query.updates_page}
				/>{/if}
			<SearchField
				id="job_query"
				label="Search jobs"
				name="job_query"
				value={data.query.job_query ?? ''}
				maxlength={200}
				placeholder="Title or company"
			/>
			<Button type="submit" variant="outline">Search jobs</Button>
		</form>
		<form method="POST" action={formAction('link')} use:enhance={enhanceNetwork} class="space-y-4">
			{#if form?.action === 'network-linked' && errors.form}<Notice
					tone="error"
					title="Could not link job">{errors.form}</Notice
				>{/if}
			<fieldset class="space-y-2">
				<legend class="mb-2 text-sm font-medium"
					>Choose a job <span class="text-destructive" aria-hidden="true">*</span></legend
				>
				{#each data.picker?.jobs ?? [] as job (job.id)}
					<RadioOption
						name="job_id"
						value={job.id}
						required
						disabled={data.linkedIds.includes(job.id)}
						checked={values.job_id === String(job.id)}
						label={`${job.title} #${job.id}`}
						description={`${job.company}${!job.isActive ? ' · Closed' : ''}${data.linkedIds.includes(job.id) ? ' · Already linked' : ''}`}
					/>
				{/each}
				{#if !data.picker?.jobs.length}<SearchEmpty noun="jobs"
						><a href="/jobs/new" class="link">Add a job</a></SearchEmpty
					>{/if}
			</fieldset>
			{#if errors.job_id}<p class="text-sm text-destructive" role="alert" tabindex="-1">
					{errors.job_id}
				</p>{/if}
			{#if data.picker}
				<Pagination
					label="Job picker pages"
					page={data.picker.page}
					totalPages={data.picker.totalPages}
					previous={href({ picker_page: data.picker.page - 1 })}
					next={href({ picker_page: data.picker.page + 1 })}
				/>
			{/if}
			<Field
				id="link_notes"
				label="Relationship note"
				error={form?.action === 'network-linked' ? errors.notes : undefined}
			>
				{#snippet control(attrs)}<Textarea
						{...attrs}
						name="notes"
						maxlength={2000}
						rows={3}
						value={form?.action === 'network-linked' ? values.notes : ''}
					/>{/snippet}
			</Field>
			<Dialog.Footer>
				<Button variant="ghost" href={href({ link_job: null, job_query: null, picker_page: null })}
					>Cancel</Button
				>
				<Button type="submit" disabled={!data.picker?.jobs.length}>Link job</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
