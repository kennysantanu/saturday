<script lang="ts">
	import { checkAuthResponse } from '$lib/auth-notice.svelte';
	import { uploadFile } from '$lib/upload';
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { focusFirstError, withPending } from '$lib/forms';
	import PageHeader from './page-header.svelte';
	import PageShell from './page-shell.svelte';
	import Notice from './notice.svelte';
	import EmptyState from './empty-state.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import DocumentRow from './document-row.svelte';
	import DocumentPickerDialog, { type DocumentChoice } from './document-picker-dialog.svelte';
	import FilterBar from './filter-bar.svelte';
	import SearchField from './search-field.svelte';
	import { filterLabels, resultCount, noMatchHint } from '$lib/filter-labels.js';
	import { buildChips } from '$lib/filter-chips.js';
	import { page } from '$app/state';
	import Field from './field.svelte';
	import NativeSelect from './native-select.svelte';
	import Pagination from './pagination.svelte';
	import RowActions from './row-actions.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Upload from '@lucide/svelte/icons/upload';
	import FilePlus from '@lucide/svelte/icons/file-plus';
	import FilePen from '@lucide/svelte/icons/file-pen';
	import Eye from '@lucide/svelte/icons/eye';
	import Download from '@lucide/svelte/icons/download';
	import Copy from '@lucide/svelte/icons/copy';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserRound from '@lucide/svelte/icons/user-round';
	import FileText from '@lucide/svelte/icons/file-text';
	import { fileIconFor } from '$lib/file-icons';
	import { fileType, documentDesignations, documentKinds, documentSorts } from '$lib/file-types';
	import { formatBytes, formatDateTime } from '$lib/format';
	import { toast } from '$lib/toast.svelte';
	let { data, form } = $props();
	const isUserScope = $derived(data.scope === 'documents');
	let uploading = $state(false),
		progress = $state(0),
		uploadError = $state('');
	let uploadInput: HTMLInputElement;
	let picker = $state(false),
		pickerQuery = $state(''),
		pickerApplied = $state(''),
		pickerPage = $state(1),
		pickerTotal = $state(0),
		pickerCount = $state(0),
		pickerLoading = $state(false),
		candidates = $state<DocumentChoice[]>([]),
		pickedDoc = $state<DocumentChoice | null>(null),
		catalog = $state(''),
		pickerError = $state('');
	let selected = $state<any>(null),
		remove = $state(false),
		rename = $state(false),
		newName = $state('');
	const chips = $derived([
		...buildChips(data.base, page.url.searchParams, data, [
			['query', 'Filename contains'],
			['type', 'Type', { format: (value: string) => kindLabel(value) }]
		])
	]);
	const kindLabel = (value: string) =>
		documentKinds.find((kind) => kind.value === value)?.label ?? value;
	const filtered = $derived(Boolean(data.query || data.type));
	const pageHref = (target: number) =>
		`?${new URLSearchParams({
			...(data.query ? { query: data.query } : {}),
			...(data.type ? { type: data.type } : {}),
			...(data.sort !== 'name' ? { sort: data.sort } : {}),
			page: String(target)
		})}`;
	function finishDialog() {
		return async ({ result, update }: any) => {
			await update();
			if (result.type === 'redirect' || result.type === 'success') {
				picker = false;
				rename = false;
				remove = false;
			} else {
				await tick();
				focusFirstError();
			}
		};
	}
	async function choices(page = 1) {
		pickerPage = page;
		pickerError = '';
		pickerLoading = true;
		try {
			const query = pickerQuery.trim();
			const r = await fetch(
				`/api/documents?${new URLSearchParams({ query, page: String(page), limit: '5' })}`
			);
			checkAuthResponse(r);
			const value = await r.json();
			if (!r.ok) throw new Error(value.error);
			candidates = value.documents;
			pickerApplied = query;
			pickerTotal = value.totalPages;
			pickerCount = value.total;
			catalog = value.catalog_token;
			// A chosen file keeps a fresh token after the catalog changes.
			const same = candidates.find((d) => d.id === pickedDoc?.id);
			if (same) pickedDoc = same;
		} catch (e) {
			pickerError = (e as Error).message;
		} finally {
			pickerLoading = false;
		}
	}
	// Choosing a file proposes its name for the copy.
	$effect(() => {
		if (pickedDoc) newName = pickedDoc.filename;
	});

	async function copyToJob() {
		pickedDoc = null;
		pickerQuery = '';
		newName = '';
		picker = true;
		await choices();
	}
	async function upload(file: File) {
		if (uploading) return;
		uploadError = '';
		uploading = true;
		progress = 0;
		try {
			await uploadFile(
				file,
				{ scope: data.scope },
				{ onprogress: (percent) => (progress = percent), retry: () => upload(file) }
			);
			toast.show('Document uploaded.');
			await invalidateAll();
		} catch (e) {
			uploadError = (e as Error).message;
		} finally {
			uploading = false;
		}
	}
	async function afterMenu(doc: any, step: () => void) {
		selected = doc;
		await tick();
		step();
	}
	const menuFor = (doc: any) => [
		...(fileType(doc.filename).preview
			? [{ label: 'Preview', icon: Eye, href: `${data.base}/${doc.id}` }]
			: []),
		{
			label: 'Download',
			icon: Download,
			onselect: () => window.location.assign(`/api/files/${doc.id}?scope=${data.scope}`)
		},
		{
			label: 'Rename',
			icon: FilePen,
			onselect: () =>
				afterMenu(doc, () => {
					newName = doc.filename;
					rename = true;
				})
		},
		{
			label: 'Duplicate',
			icon: Copy,
			onselect: () =>
				afterMenu(doc, () =>
					(document.getElementById('duplicate-document') as HTMLFormElement | null)?.requestSubmit()
				)
		},
		{
			label: 'Delete',
			icon: Trash2,
			destructive: true,
			separated: true,
			onselect: () => afterMenu(doc, () => (remove = true))
		}
	];
</script>

<PageShell title={isUserScope ? 'Documents' : 'Job documents'}>
	<PageHeader
		back={isUserScope ? undefined : { href: `/jobs/${data.scope}`, label: 'job' }}
		title={isUserScope ? 'Documents' : 'Job documents'}
		description={isUserScope
			? 'Your resumes, cover letters and notes.'
			: 'Files kept with this job, separate from your own documents.'}
	>
		{#snippet actions()}
			<Button
				onclick={() => uploadInput.click()}
				disabled={uploading}
				title="Upload a document (up to 25 MiB)"
				size="lg"
				><Upload data-icon="inline-start" />{uploading
					? `Uploading ${progress}%`
					: 'Upload'}</Button
			>
			<Button variant="outline" href={`${data.base}/new`} size="lg"
				><FilePlus data-icon="inline-start" />New document</Button
			>
			{#if isUserScope}
				<Button variant="outline" href="/profile" size="lg"
					><UserRound data-icon="inline-start" />Profile</Button
				>
			{:else}
				<Button variant="outline" onclick={copyToJob} size="lg"
					><Copy data-icon="inline-start" />Copy to this job</Button
				>
			{/if}
		{/snippet}
	</PageHeader>

	{#if form?.fileError || data.fileError || uploadError}
		<Notice tone="error" title="The document action failed"
			>{form?.fileError || data.fileError || uploadError}</Notice
		>
	{/if}
	<input
		type="file"
		class="hidden"
		aria-label="Upload a document"
		bind:this={uploadInput}
		onchange={(e) => {
			const file = e.currentTarget.files?.[0];
			e.currentTarget.value = '';
			if (file) upload(file);
		}}
	/>
	{#if uploading}
		<div role="status" class="space-y-2">
			<p class="text-sm text-muted-foreground">Uploading document… {progress}%</p>
			<progress class="h-2 w-full accent-primary" max="100" value={progress}></progress>
		</div>
	{/if}

	<FilterBar
		label="Filter documents"
		action={data.base}
		clearHref={data.base}
		applyLabel={filterLabels.search}
		clearLabel={filterLabels.clear}
		showClear={filtered || data.sort !== 'name'}
		instant
		{chips}
	>
		<div class="filter-row filter-row-no-toggle">
			<div class="filter-row-search">
				<SearchField id="query" label="Search filenames" value={data.query} />
			</div>
			<div class="filter-row-one">
				<Field id="type" label="Type">
					{#snippet control(attrs)}<NativeSelect
							{...attrs}
							name="type"
							value={data.type}
							data-instant
						>
							<option value="">{filterLabels.any}</option>
							{#each documentKinds as kind (kind.value)}<option value={kind.value}
									>{kind.label}</option
								>{/each}
						</NativeSelect>{/snippet}
				</Field>
			</div>
			<div class="filter-row-two">
				<Field id="sort" label="Sort by">
					{#snippet control(attrs)}<NativeSelect
							{...attrs}
							name="sort"
							value={data.sort}
							data-instant
						>
							{#each documentSorts as option (option.value)}<option value={option.value}
									>{option.label}</option
								>{/each}
						</NativeSelect>{/snippet}
				</Field>
			</div>
		</div>
	</FilterBar>

	<div class="space-y-4">
		<p class="text-sm text-muted-foreground" aria-live="polite">
			{resultCount(data.total, {
				one: 'document',
				many: 'documents',
				filtered,
				qualifier: 'matching filters'
			})}
		</p>
		{#if !data.documents.length}
			<EmptyState
				title={filtered ? 'No matching documents' : 'No documents yet'}
				description={filtered
					? noMatchHint.filters
					: 'Upload a file or create a Markdown document.'}
			>
				{#snippet icon()}<FileText class="size-5" />{/snippet}
				{#snippet actions()}
					{#if filtered}
						<Button href={data.base} variant="outline" size="lg">Clear filters</Button>
					{:else}
						<Button size="lg" onclick={() => uploadInput.click()} disabled={uploading}
							><Upload data-icon="inline-start" />Upload</Button
						>
						<Button variant="outline" size="lg" href={`${data.base}/new`}
							><FilePlus data-icon="inline-start" />New document</Button
						>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<Card.Root class="gap-0 divide-y divide-border p-0">
				{#each data.documents as doc (doc.id)}
					{@const Icon = fileIconFor(doc.filename)}
					<DocumentRow>
						{#snippet icon()}<Icon class="size-5" />{/snippet}
						{#snippet title()}
							<p class="flex flex-wrap items-center gap-2 font-semibold">
								<a class="link break-all" href={`${data.base}/${doc.id}`}>{doc.filename}</a
								>{#each doc.designations ?? [] as key}<Badge variant="secondary"
										>{documentDesignations[key].label}</Badge
									>{/each}
							</p>
						{/snippet}
						{#snippet meta()}
							{fileType(doc.filename).label} · {formatBytes(doc.size)} · {formatDateTime(
								doc.updated_at
							)}
						{/snippet}
						{#snippet actions()}
							<RowActions
								label={doc.filename}
								editHref={doc.can_edit_text ? `${data.base}/${doc.id}?edit=1` : undefined}
								menu={menuFor(doc)}
							/>
						{/snippet}
					</DocumentRow>
				{/each}
			</Card.Root>
		{/if}
		<Pagination
			label="Document pages"
			page={data.page}
			totalPages={Math.max(1, data.totalPages)}
			previous={pageHref(data.page - 1)}
			next={pageHref(data.page + 1)}
		/>
	</div>
</PageShell>

{#if picker}
	<DocumentPickerDialog
		bind:open={picker}
		bind:selected={pickedDoc}
		bind:query={pickerQuery}
		title="Copy to this job"
		description="Choose one of your documents to copy. The original is kept."
		choices={candidates}
		page={pickerPage}
		totalPages={Math.max(1, pickerTotal)}
		total={pickerCount}
		queryValue={pickerApplied}
		loading={pickerLoading}
		error={pickerError || form?.fileError || null}
		errorTitle="The document could not be copied"
		formId="copy-document"
		formAction="?/copy"
		hidden={{ catalog_token: catalog }}
		submit={finishDialog}
		submitLabel={(chosen) => (chosen ? `Copy ${chosen.filename}` : 'Copy document')}
		emptyText="You have no documents to copy yet. Upload a file or create a document first."
		pagerLabel="Available document pages"
		onsearch={() => choices(1)}
		onpage={(target) => choices(target)}
	>
		{#snippet extra()}
			<Field id="copy_filename" label="Destination filename" required>
				{#snippet control(attrs)}<Input
						{...attrs}
						name="filename"
						bind:value={newName}
						required
					/>{/snippet}
			</Field>
		{/snippet}
	</DocumentPickerDialog>
{/if}

<Dialog.Root bind:open={rename}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Rename document</Dialog.Title>
			<Dialog.Description>The document stays in its current folder.</Dialog.Description>
		</Dialog.Header>
		{#if form?.fileError}<Notice tone="error" title="The document was not renamed"
				>{form.fileError}</Notice
			>{/if}
		<form method="POST" action="?/rename" use:enhance={withPending(finishDialog)} class="space-y-5">
			<p class="text-sm text-muted-foreground">
				<span class="text-destructive" aria-hidden="true">*</span> Required
			</p>
			<input type="hidden" name="id" value={selected?.id} /><input
				type="hidden"
				name="token"
				value={selected?.token}
			/>
			<Field id="rename_filename" label="Filename" required>
				{#snippet control(attrs)}<Input
						{...attrs}
						name="filename"
						bind:value={newName}
						required
					/>{/snippet}
			</Field>
			<Dialog.Footer>
				<Button type="button" variant="ghost" onclick={() => (rename = false)}>Cancel</Button>
				<Button type="submit">Save name</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<form
	id="duplicate-document"
	class="hidden"
	method="POST"
	action="?/duplicate"
	use:enhance={withPending(finishDialog)}
>
	<input type="hidden" name="id" value={selected?.id} />
	<input type="hidden" name="token" value={selected?.token} />
</form>
<form id="delete-document" method="POST" action="?/delete" use:enhance={withPending(finishDialog)}>
	<input type="hidden" name="id" value={selected?.id} /><input
		type="hidden"
		name="token"
		value={selected?.token}
	/><input type="hidden" name="catalog_token" value={data.catalog_token} /><input
		type="hidden"
		name="clear_designations"
		value="true"
	/><input type="hidden" name="confirm" value="true" />
</form>
<ConfirmDialog
	bind:open={remove}
	title="Delete document?"
	description={`Permanently delete ${selected?.filename ?? 'this file'}? There is no Trash.${selected?.designations?.length ? ` This also clears ${selected.designations.map((key: string) => documentDesignations[key].label).join(', ')}.` : ''}`}
	confirmLabel="Delete document"
	formId="delete-document"
	destructive
/>
