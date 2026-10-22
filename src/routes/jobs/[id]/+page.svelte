<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';
	import { networkDetailUrl } from '$lib/network-navigation.js';
	import { tick, onMount } from 'svelte';
	import Bot from '@lucide/svelte/icons/bot';
	import { enhance } from '$app/forms';
	import Plus from '@lucide/svelte/icons/plus';
	import Star from '@lucide/svelte/icons/star';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import FileText from '@lucide/svelte/icons/file-text';
	import Link2 from '@lucide/svelte/icons/link-2';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { jobInfoFields } from '$lib/job-fields.js';
	import DueBadge from '$lib/components/app/due-badge.svelte';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import Field from '$lib/components/app/field.svelte';
	import LinkedItem from '$lib/components/app/linked-item.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import Pagination from '$lib/components/app/pagination.svelte';
	import SectionCard from '$lib/components/app/section-card.svelte';
	import StatusBadge from '$lib/components/app/status-badge.svelte';
	import Timeline from '$lib/components/app/timeline.svelte';
	import ExpandableText from '$lib/components/app/expandable-text.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { focusFirstError, enhanceWithFocus, withPending } from '$lib/forms';
	import { hostOf, formatDate } from '$lib/format';
	import JobUpdateDialog from '$lib/components/app/job-update-dialog.svelte';
	import JobPersonPicker from '$lib/components/app/job-person-picker.svelte';
	import UnsavedDialog from '$lib/components/app/unsaved-dialog.svelte';
	import { UnsavedChanges } from '$lib/unsaved.svelte';

	type JobUpdate = {
		id: number;
		date: string;
		stageId: number | null;
		label: string;
		note: string | null;
		createdVia: 'manual' | 'mcp';
	};

	let { data, form } = $props();
	const job = $derived(data.job);
	const updates = $derived(job.updates as JobUpdate[]);
	const errors = $derived(form?.errors ?? {});
	const values = $derived(form?.values ?? {});
	const pageError = $derived(form?.action === 'star' ? errors.form : undefined);
	let scoreOpen = $state(false);
	let infoOpen = $state(false);
	onMount(() => {
		const desktop = matchMedia('(min-width: 64rem)');
		const sync = () => (infoOpen = desktop.matches);
		sync();
		desktop.addEventListener('change', sync);
		return () => desktop.removeEventListener('change', sync);
	});
	let editor = $state<{ mode: 'move' | 'add' | 'edit' | 'followUp'; entry?: JobUpdate } | null>(
		null
	);
	let editorFailure = $state<{
		action: string;
		values: Record<string, string>;
		errors: Record<string, string>;
		moveFirst?: boolean;
	} | null>(null);
	function openEditor(mode: 'move' | 'add' | 'edit' | 'followUp', entry?: JobUpdate) {
		editorFailure = null;
		editor = { mode, entry };
	}
	$effect(() => {
		if (
			!form?.errors ||
			!['changeStage', 'addHistory', 'editHistory', 'deleteHistory', 'followUp'].includes(
				form.action
			)
		)
			return;
		editorFailure = form;
		editor = {
			mode:
				form.action === 'changeStage'
					? 'move'
					: form.action === 'addHistory'
						? 'add'
						: form.action === 'followUp'
							? 'followUp'
							: 'edit',
			entry: updates.find((entry) => String(entry.id) === form.values?.update_id)
		};
	});
	const upcoming = $derived(
		updates
			.filter((entry) => entry.date > data.today)
			.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
	);
	const history = $derived(updates.filter((entry) => entry.date <= data.today));
	let networkNoteOpen = $state(false);
	const noteGuard = new UnsavedChanges();
	let notePersonId = $state('');
	let notePersonName = $state('');
	let networkNote = $state('');
	const networkErrors = $derived(
		form?.action?.startsWith('network-') ? errors : data.networkErrors
	);
	$effect(() => {
		if (!form?.errors) return;
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
	function formAction(name: string) {
		const query = new URLSearchParams(page.url.searchParams);
		for (const key of [...query.keys()]) if (key.startsWith('/')) query.delete(key);
		return '?/' + name + (query.size ? '&' + query : '');
	}
	const enhanceNetwork: SubmitFunction = withPending(
		({ formElement }) => {
			const guarded = formElement.id === 'job-link-note';
			if (guarded) noteGuard.saving = true;
			return async ({ result, update }) => {
				if (result.type === 'redirect' || result.type === 'success') {
					if (guarded) noteGuard.dirty = false;
					networkNoteOpen = false;
				}
				await update({ reset: false });
				if (guarded) noteGuard.saving = false;
				await tick();
				focusFirstError();
			};
		},
		() => {
			noteGuard.saving = false;
		}
	);
</script>

{#snippet documentRows(documents: typeof data.documents)}
	<ul class="divide-y">
		{#each documents as doc (doc.id)}
			<li class="flex flex-wrap items-center justify-between gap-3 py-3">
				<a class="link min-w-0 break-all" href={`/jobs/${job.id}/documents/${doc.id}`}
					>{doc.filename}</a
				>
				<a class="link text-sm" href={`/api/files/${doc.id}?scope=${job.id}`}
					>Download<span class="sr-only"> {doc.filename}</span></a
				>
			</li>
		{/each}
	</ul>
{/snippet}

{#if job.score !== null && job.score !== undefined}
	<Dialog.Root bind:open={scoreOpen}>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>Assistant assessment</Dialog.Title>
				<Dialog.Description>Score and notes provided by your AI assistant.</Dialog.Description>
			</Dialog.Header>
			<p class="text-2xl font-semibold break-words tabular-nums">{job.score}</p>
			<p class="text-sm break-words whitespace-pre-wrap">
				{job.scoreComment || 'No assessment notes provided.'}
			</p>
			<Dialog.Footer
				><Button variant="ghost" onclick={() => (scoreOpen = false)}>Close</Button></Dialog.Footer
			>
		</Dialog.Content>
	</Dialog.Root>
{/if}

<div>
	<PageShell title={`${job.title} · ${job.company}`}>
		<PageHeader
			recordNumber={job.id}
			back={{
				href: data.returnTo,
				label: data.returnTo.startsWith('/jobs') ? 'Jobs' : 'Dashboard'
			}}
			title={job.title}
			eyebrow={job.company}
		>
			{#snippet meta()}
				<StatusBadge status={job.status} class="h-7 text-sm" />
				{#if job.score !== null && job.score !== undefined}
					<Button
						variant="outline"
						size="sm"
						class="job-score"
						title={`Assistant score: ${job.score}`}
						aria-label={`Assistant score: ${job.score}. View assessment notes`}
						aria-haspopup="dialog"
						onclick={() => (scoreOpen = true)}
					>
						Score <span class="job-score-number font-semibold tabular-nums">{job.score}</span
						><ChevronRight data-icon="inline-end" aria-hidden="true" />
					</Button>
				{/if}
				{#if job.createdVia === 'mcp'}
					<Badge variant="outline" class="gap-1 text-muted-foreground"
						><Bot class="size-3.5" aria-hidden="true" />Added by assistant</Badge
					>
				{/if}
			{/snippet}
			{#snippet actions()}
				<form method="POST" action={formAction('star')} use:enhance={enhanceWithFocus}>
					<input type="hidden" name="is_starred" value={job.isStarred ? '0' : '1'} />
					<Button type="submit" variant="outline" aria-pressed={job.isStarred}>
						<Star
							data-icon="inline-start"
							class={job.isStarred ? 'fill-current text-primary' : ''}
						/>{job.isStarred ? 'Starred' : 'Star'}
					</Button>
				</form>
				<Button
					href={'/jobs/' + job.id + '/edit?return_to=' + encodeURIComponent(data.returnTo)}
					variant="outline"><Pencil data-icon="inline-start" />Edit</Button
				>
				<Button onclick={() => openEditor('add')} variant="outline"
					><Plus data-icon="inline-start" />Add history</Button
				>
				<Button onclick={() => openEditor('move')}>Change stage</Button>
			{/snippet}
		</PageHeader>

		{#if data.outsideResults}<Notice title="This job is outside the original results"
				>Its current details no longer match those filters. <a
					class="link"
					href={'/jobs?view=all&current_stage=' + job.currentStageId}>View current-stage jobs</a
				>, or return using the original results link.</Notice
			>{/if}
		{#if pageError}
			<Notice tone="error" title="The change was not saved">{pageError}</Notice>
		{/if}

		<div class="grid min-w-0 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
			<aside class="min-w-0 space-y-6">
				<SectionCard
					id="job-follow-up"
					title="Follow-up"
					class="compact-card"
					contentClass="space-y-3"
				>
					{#snippet action()}
						<Button variant="ghost" size="sm" onclick={() => openEditor('followUp')}>
							{job.followUpDate ? 'Edit follow-up' : 'Schedule follow-up'}
						</Button>
					{/snippet}
					{#if job.followUpDate}
						<p title={formatDate(job.followUpDate)}>
							<DueBadge date={job.followUpDate} today={data.today} />
						</p>
						{#if job.followUpComment}<div class="text-sm">
								<ExpandableText text={job.followUpComment} limit={160} lines={3} />
							</div>{/if}
					{:else}<p class="text-sm text-muted-foreground">Not scheduled.</p>{/if}
					{#if !job.isActive && job.followUpDate}<p class="text-sm text-muted-foreground">
							Kept here while closed. Changing to an open stage shows this follow-up in Needs
							attention again.
						</p>{/if}
				</SectionCard>
				<details id="job-information" class="disclosure" bind:open={infoOpen}>
					<summary
						><h2 class="text-base font-medium">Job details</h2>
						<ChevronDown class="size-4 shrink-0" aria-hidden="true" /></summary
					>
					<div class="disclosure-body text-sm">
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
									class="link inline-flex items-center gap-1 break-all"
									>{hostOf(job.postingUrl)}<ExternalLink class="size-3.5 shrink-0" /><span
										class="sr-only">(opens in a new tab)</span
									></a
								>
							</div>
						{/if}
						<div class="space-y-1">
							<p class="text-muted-foreground">Job notes</p>
							<ExpandableText text={job.notes ?? 'No notes yet.'} limit={280} lines={4} />
						</div>
					</div>
				</details>
			</aside>
			<div class="min-w-0 space-y-6">
				<SectionCard id="job-history" title="History" count={updates.length}>
					{#if upcoming.length > 0}
						<section aria-labelledby="upcoming-heading" class="space-y-3">
							<h3 id="upcoming-heading" class="text-sm font-medium text-muted-foreground">
								Upcoming
							</h3>
							<Timeline
								onedit={(entry) => openEditor('edit', entry)}
								entries={upcoming.slice(0, 3)}
								scheduled
							/>
							{#if upcoming.length > 3}
								<details class="content-expander" id="more-upcoming-history">
									<summary
										><span class="expand-label">Show more upcoming ({upcoming.length - 3})</span
										><span class="collapse-label">Show less upcoming</span></summary
									>
									<div class="pt-4">
										<Timeline
											onedit={(entry) => openEditor('edit', entry)}
											entries={upcoming.slice(3)}
											scheduled
										/>
									</div>
								</details>
							{/if}
						</section>
					{/if}

					{#if history.length === 0 && upcoming.length === 0}
						<EmptyState
							size="inline"
							title="No updates yet"
							description="Record the first step, like applying, when it happens."
						>
							{#snippet actions()}
								<Button onclick={() => openEditor('add')}
									><Plus data-icon="inline-start" />Add history</Button
								>
							{/snippet}
						</EmptyState>
					{:else if history.length > 0}
						<Timeline onedit={(entry) => openEditor('edit', entry)} entries={history.slice(0, 5)} />
						{#if history.length > 5}
							<details class="content-expander" id="more-job-history">
								<summary
									><span class="expand-label">Show more history ({history.length - 5})</span><span
										class="collapse-label">Show less history</span
									></summary
								>
								<div class="pt-4">
									<Timeline
										onedit={(entry) => openEditor('edit', entry)}
										entries={history.slice(5)}
									/>
								</div>
							</details>
						{/if}
					{/if}
				</SectionCard>

				<SectionCard
					id="job-documents"
					title="Documents"
					count={data.documentCount}
					description="Tailored resumes, cover letters and notes for this job."
				>
					{#snippet action()}
						<Button variant="outline" href={`/jobs/${job.id}/documents`}
							><FileText data-icon="inline-start" />Manage documents</Button
						>
					{/snippet}
					{#if data.documentsError}<Notice tone="error" title="Documents unavailable"
							>{data.documentsError}</Notice
						>{/if}
					{#if data.documents.length}
						{@render documentRows(data.documents.slice(0, 3))}
						{#if data.documents.length > 3}
							<details class="content-expander" id="more-job-documents">
								<summary
									><span class="expand-label"
										>Show more documents ({data.documents.length - 3})</span
									><span class="collapse-label">Show less documents</span></summary
								>
								{@render documentRows(data.documents.slice(3))}
							</details>
						{/if}
						{#if data.documentCount > data.documents.length}<p
								class="text-sm text-muted-foreground"
							>
								Showing {data.documents.length} of {data.documentCount}. Use Manage documents for
								the full list.
							</p>{/if}
					{:else if !data.documentsError}
						<EmptyState
							size="inline"
							title="No documents yet"
							description="Upload a file or create a Markdown document for this job."
						/>
					{/if}
				</SectionCard>

				<SectionCard id="job-network" title="Network" count={data.people.total}>
					{#snippet action()}
						<Button
							variant="outline"
							data-sveltekit-noscroll
							data-sveltekit-keepfocus
							href={networkHref({ link_person: '1', person_page: null })}
							><Link2 data-icon="inline-start" />Link person</Button
						>
					{/snippet}
					{#if form?.action === 'network-unlinked' && networkErrors.form}<Notice
							tone="error"
							title="Could not unlink">{networkErrors.form}</Notice
						>{/if}
					{#if Object.keys(data.networkErrors).length}<Notice
							tone="error"
							title="Check the search or page values"
							>{Object.values(data.networkErrors).join(' ')}</Notice
						>{/if}
					{#if !data.people.networks.length}
						<EmptyState
							size="inline"
							title="No linked people yet"
							description="Link someone who can refer you or tell you more about this job."
						/>
					{/if}
					{#each data.people.networks as person (person.id)}
						<LinkedItem
							recordNumber={person.id}
							href={networkDetailUrl(person.id, page.url.pathname + page.url.search)}
							title={person.name}
							subtitle={[person.role, person.organization].filter(Boolean).join(' · ')}
							note={person.job_link.notes}
						>
							{#snippet actions()}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => {
										notePersonId = person.id;
										notePersonName = person.name;
										networkNote = person.job_link.notes ?? '';
										networkNoteOpen = true;
									}}><Pencil data-icon="inline-start" />Edit link note</Button
								>
								<form
									method="POST"
									action={formAction('networkUnlink')}
									use:enhance={enhanceNetwork}
								>
									<input type="hidden" name="network_id" value={person.id} /><Button
										type="submit"
										size="sm"
										variant="ghost"
										aria-label={`Unlink ${person.name}`}>Unlink</Button
									>
								</form>
							{/snippet}
						</LinkedItem>
					{/each}
					<Pagination
						label="Linked people pages"
						page={data.people.page}
						totalPages={data.people.totalPages}
						previous={networkHref({ network_page: data.people.page - 1 })}
						next={networkHref({ network_page: data.people.page + 1 })}
					/>
				</SectionCard>
				{#if job.description}
					<SectionCard
						id="job-description"
						title="Job description"
						contentClass="text-base leading-relaxed text-muted-foreground"
					>
						<ExpandableText text={job.description} />
					</SectionCard>
				{/if}
			</div>
		</div>
	</PageShell>
</div>

<UnsavedDialog bind:open={networkNoteOpen} guard={noteGuard}>
	{#snippet children(close)}
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Edit link note</Dialog.Title>
				<Dialog.Description>{notePersonName || 'Linked person'} · {job.title}</Dialog.Description>
			</Dialog.Header>
			<form
				id="job-link-note"
				oninput={noteGuard.markDirty}
				method="POST"
				action={formAction('networkNote')}
				use:enhance={enhanceNetwork}
				class="space-y-5"
			>
				<input type="hidden" name="network_id" value={notePersonId} />
				{#if form?.action === 'network-note' && networkErrors.form}<Notice
						tone="error"
						title="Link note not saved">{networkErrors.form}</Notice
					>{/if}
				<Field
					id="network_relationship_note"
					label="Relationship note"
					error={form?.action === 'network-note' ? networkErrors.notes : undefined}
				>
					{#snippet control(attrs)}<Textarea
							{...attrs}
							name="notes"
							maxlength={2000}
							rows={4}
							bind:value={networkNote}
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

{#if data.personPicker}
	{#key job.id}<JobPersonPicker {data} {form} />{/key}
{/if}

{#if editor}
	{#key `${editor.mode}-${editor.entry?.id ?? ''}`}
		<JobUpdateDialog
			{data}
			mode={editor.mode}
			entry={editor.entry}
			form={editorFailure}
			onclose={() => (editor = null)}
		/>
	{/key}
{/if}
