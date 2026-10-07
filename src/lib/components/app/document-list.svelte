<script lang="ts">
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
	import FilterBar from './filter-bar.svelte';
	import FilterChips from './filter-chips.svelte';
	import Field from './field.svelte';
	import Pagination from './pagination.svelte';
	import RadioOption from './radio-option.svelte';
	import RowActions from './row-actions.svelte';
	import Skeleton from './skeleton.svelte';
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
	import StarOff from '@lucide/svelte/icons/star-off';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import BadgeCheck from '@lucide/svelte/icons/badge-check';
	import FileAudio from '@lucide/svelte/icons/file-audio';
	import FileVideo from '@lucide/svelte/icons/file-video';
	import FileChartColumn from '@lucide/svelte/icons/file-chart-column';
	import FileText from '@lucide/svelte/icons/file-text';
	import FileCode from '@lucide/svelte/icons/file-code';
	import FileImage from '@lucide/svelte/icons/file-image';
	import FileArchive from '@lucide/svelte/icons/file-archive';
	import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
	import FileIcon from '@lucide/svelte/icons/file';
	import { fileType } from '$lib/file-types';
	import { formatBytes, formatDateTime } from '$lib/format';
	import { toast } from '$lib/toast.svelte';
	let { data, form } = $props();
	const isUserScope = $derived(data.scope === 'documents');
	let uploading = $state(false),
		progress = $state(0),
		uploadError = $state('');
	let uploadInput: HTMLInputElement;
	let picker = $state(false),
		copyPicker = $state(false),
		pickerQuery = $state(''),
		pickerPage = $state(1),
		pickerTotal = $state(0),
		pickerLoading = $state(false),
		candidates = $state<any[]>([]),
		picked = $state(''),
		pickedToken = $state(''),
		catalog = $state(''),
		pickerError = $state('');
	let selected = $state<any>(null),
		remove = $state(false),
		rename = $state(false),
		newName = $state('');
	const icons: Record<string, typeof FileIcon> = {
		markdown: FileText,
		text: FileText,
		pdf: FileText,
		html: FileCode,
		image: FileImage,
		sheet: FileSpreadsheet,
		archive: FileArchive,
		document: FileText,
		audio: FileAudio,
		video: FileVideo,
		presentation: FileChartColumn
	};
	const iconFor = (name: string) => icons[fileType(name).icon] ?? FileIcon;
	const chips = $derived(
		data.query ? [{ key: 'query', label: `Filename contains: ${data.query}`, href: data.base }] : []
	);
	const pageHref = (page: number) =>
		`?${new URLSearchParams({ query: data.query, page: String(page) })}`;
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
			const r = await fetch(
				`/api/documents?${new URLSearchParams({ query: pickerQuery, page: String(page), ...(copyPicker ? {} : { markdown: '1' }) })}`
			);
			const value = await r.json();
			if (!r.ok) throw new Error(value.error);
			candidates = value.documents;
			const current = candidates.find((d) => d.id === picked);
			if (current) pickedToken = current.token;
			pickerTotal = value.totalPages;
			catalog = value.catalog_token;
		} catch (e) {
			pickerError = (e as Error).message;
		} finally {
			pickerLoading = false;
		}
	}
	async function selectMaster() {
		copyPicker = false;
		picked = data.master?.id ?? '';
		pickedToken = data.master?.token ?? '';
		picker = true;
		await choices();
	}
	async function copyToJob() {
		copyPicker = true;
		picked = '';
		pickedToken = '';
		newName = '';
		picker = true;
		await choices();
	}
	async function upload(file: File) {
		if (uploading) return;
		uploadError = '';
		uploading = true;
		progress = 0;
		const xhr = new XMLHttpRequest();
		xhr.open(
			'POST',
			`/api/files/upload?${new URLSearchParams({ scope: data.scope, filename: file.name })}`
		);
		xhr.setRequestHeader('Content-Type', 'application/octet-stream');
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) progress = Math.round((100 * e.loaded) / e.total);
		};
		xhr.onerror = () => {
			uploadError = 'Upload interrupted. Inspect the list before retrying.';
			uploading = false;
		};
		xhr.onload = async () => {
			uploading = false;
			if (xhr.status < 300) {
				toast.show('Document uploaded.');
				await invalidateAll();
			} else {
				try {
					uploadError = JSON.parse(xhr.responseText).error;
				} catch {
					uploadError = 'Upload failed.';
				}
			}
		};
		xhr.send(file);
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
				<Button variant="outline" onclick={selectMaster} size="lg"
					><BadgeCheck data-icon="inline-start" />Select Master CV</Button
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
		label="Search documents"
		action={data.base}
		clearHref={data.base}
		applyLabel="Search"
		clearLabel="Clear search"
		showClear={Boolean(data.query)}
	>
		<Field id="query" label="Search filenames">
			{#snippet control(attrs)}<Input {...attrs} name="query" value={data.query} />{/snippet}
		</Field>
	</FilterBar>
	<FilterChips {chips} />

	<div class="space-y-4">
		<p class="text-sm text-muted-foreground" aria-live="polite">
			{data.total}
			{data.total === 1 ? 'document' : 'documents'}{data.query ? ' matching search' : ''}
		</p>
		{#if !data.documents.length}
			<EmptyState
				title={data.query ? 'No matching documents' : 'No documents yet'}
				description={data.query
					? 'Try a different search, or clear it to see every document.'
					: 'Upload a file or create a Markdown document.'}
			>
				{#snippet icon()}<FileText class="size-5" />{/snippet}
				{#snippet actions()}
					{#if data.query}
						<Button href={data.base} variant="outline" size="lg">Clear search</Button>
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
					{@const Icon = iconFor(doc.filename)}
					<DocumentRow>
						{#snippet icon()}<Icon class="size-5" />{/snippet}
						{#snippet title()}
							<p class="flex flex-wrap items-center gap-2 font-semibold">
								<a class="link break-all" href={`${data.base}/${doc.id}`}>{doc.filename}</a
								>{#if doc.designation}<Badge variant="secondary">Master CV</Badge>{/if}
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

<Dialog.Root bind:open={picker}>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{copyPicker ? 'Copy to this job' : 'Select Master CV'}</Dialog.Title>
			<Dialog.Description
				>{copyPicker
					? 'Choose a user document to copy. The original is kept.'
					: 'Choose an existing Markdown document, or No Master CV to clear the selection. Files always stay in Documents.'}</Dialog.Description
			>
		</Dialog.Header>
		{#if pickerError}<Notice tone="error" title="Documents could not be loaded"
				>{pickerError}</Notice
			>{/if}
		{#if form?.fileError}<Notice tone="error" title="The document action failed"
				>{form.fileError}</Notice
			>{/if}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				choices();
			}}
			class="flex flex-wrap items-end gap-2"
		>
			<div class="min-w-48 flex-1">
				<Field id="picker_query" label="Search documents">
					{#snippet control(attrs)}<Input {...attrs} bind:value={pickerQuery} />{/snippet}
				</Field>
			</div>
			<Button variant="outline" type="submit">Search</Button>
		</form>
		<form
			method="POST"
			action={copyPicker ? '?/copy' : '?/master'}
			use:enhance={withPending(finishDialog)}
			class="space-y-4"
		>
			<input type="hidden" name="id" value={picked} /><input
				type="hidden"
				name="token"
				value={pickedToken}
			/><input type="hidden" name="catalog_token" value={catalog} />
			<fieldset class="max-h-64 space-y-2 overflow-auto" aria-busy={pickerLoading}>
				<legend class="sr-only">Available documents</legend>
				{#if pickerLoading}
					<Skeleton class="h-12 w-full" /><Skeleton class="h-12 w-full" /><Skeleton
						class="h-12 w-full"
					/>
				{:else}
					{#if !copyPicker}
						<RadioOption
							name="choice"
							value=""
							checked={picked === ''}
							label="No Master CV"
							onchange={() => {
								picked = '';
								pickedToken = '';
							}}
						/>
					{/if}
					{#each candidates as doc (doc.id)}
						<RadioOption
							name="choice"
							value={doc.id}
							checked={picked === doc.id}
							label={doc.filename}
							onchange={() => {
								picked = doc.id;
								pickedToken = doc.token;
								newName = doc.filename;
							}}
						/>
					{/each}
					{#if !candidates.length}<p class="text-sm text-muted-foreground">
							{copyPicker
								? 'No matching documents.'
								: 'No eligible files on this page. Search another page, or create or upload a Markdown document first.'}
						</p>{/if}
				{/if}
			</fieldset>
			{#if copyPicker}
				<Field id="copy_filename" label="Destination filename" required>
					{#snippet control(attrs)}<Input
							{...attrs}
							name="filename"
							bind:value={newName}
							required
						/>{/snippet}
				</Field>
			{/if}
			<Pagination
				label="Available document pages"
				page={pickerPage}
				totalPages={pickerTotal}
				previous={() => choices(pickerPage - 1)}
				next={() => choices(pickerPage + 1)}
			/>
			<Dialog.Footer>
				<Button type="button" variant="ghost" onclick={() => (picker = false)}>Cancel</Button>
				<Button type="submit" disabled={copyPicker ? !picked : picked === (data.master?.id ?? '')}
					>{copyPicker ? 'Copy document' : picked ? 'Use selected file' : 'Clear Master CV'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

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
		name="clear_master"
		value="true"
	/><input type="hidden" name="confirm" value="true" />
</form>
<ConfirmDialog
	bind:open={remove}
	title="Delete document?"
	description={`Permanently delete ${selected?.filename ?? 'this file'}? There is no Trash.${selected?.designation ? ' This also clears Master CV.' : ''}`}
	confirmLabel="Delete document"
	formId="delete-document"
	destructive
/>
