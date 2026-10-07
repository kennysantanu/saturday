<script lang="ts">
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { focusFirstError } from '$lib/forms';
	import PageHeader from './page-header.svelte';
	import Notice from './notice.svelte';
	import EmptyState from './empty-state.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { DropdownMenu } from 'bits-ui';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import X from '@lucide/svelte/icons/x';
	import * as Dialog from '$lib/components/ui/dialog';
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
	import { toast } from '$lib/toast.svelte';
	let { data, form } = $props();
	let uploading = $state(false),
		progress = $state(0),
		uploadError = $state('');
	let uploadInput: HTMLInputElement;
	let picker = $state(false),
		copyPicker = $state(false),
		pickerQuery = $state(''),
		pickerPage = $state(1),
		pickerTotal = $state(0),
		candidates = $state<any[]>([]),
		picked = $state(''),
		pickedToken = $state(''),
		catalog = $state(''),
		pickerError = $state('');
	let selected = $state<any>(null),
		remove = $state(false),
		removeMaster = $state(false),
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
	function finishDialog() {
		return async ({ result, update }: any) => {
			await update();
			if (result.type === 'redirect' || result.type === 'success') {
				picker = false;
				rename = false;
				removeMaster = false;
			} else {
				await tick();
				focusFirstError();
			}
		};
	}
	async function choices(page = 1) {
		pickerPage = page;
		pickerError = '';
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
</script>

<svelte:head><title>Documents · Saturday</title></svelte:head>
<div class="space-y-6">
	{#if data.scope !== 'documents'}<a class="back-link" href={`/jobs/${data.scope}`}>Back to job</a
		>{/if}
	<PageHeader
		title={data.scope === 'documents' ? 'Documents' : 'Job documents'}
		description={`${data.total} ${data.total === 1 ? 'document' : 'documents'}`}
	>
		{#snippet actions()}<Button
				onclick={() => uploadInput.click()}
				disabled={uploading}
				title="Upload a document (up to 25 MiB)"
				>{uploading ? `Uploading ${progress}%` : 'Upload'}</Button
			><Button variant="outline" href={`${data.base}/new`}>New document</Button
			>{#if data.scope === 'documents'}<Button variant="outline" onclick={selectMaster}
					>Select Master CV</Button
				>{:else}<Button variant="outline" onclick={copyToJob}>Copy to this job</Button
				>{/if}{/snippet}
	</PageHeader>
	{#if form?.fileError || data.fileError || uploadError}<Notice tone="error"
			>{form?.fileError || data.fileError || uploadError}</Notice
		>{/if}
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
	{#if uploading}<p role="status" class="text-sm text-muted-foreground">
			Uploading document… {progress}%
		</p>{/if}
	<form method="GET" class="flex flex-wrap items-end gap-3">
		<label class="min-w-48 flex-1 space-y-2 text-sm"
			><span>Search filenames</span><Input name="query" value={data.query} /></label
		><Button type="submit" variant="outline">Search</Button>{#if data.query}<Button
				href={data.base}
				variant="ghost">Clear search</Button
			>{/if}
	</form>
	{#if !data.documents.length}<EmptyState
			title={data.query ? 'No matching documents' : 'No documents yet'}
			description="Upload a file or create a Markdown document."
		/>{:else}
		<ul class="divide-y rounded-[var(--r-card)] border bg-card px-4">
			{#each data.documents as doc (doc.id)}{@const Icon = iconFor(doc.filename)}
				<li
					class="flex flex-col items-stretch justify-between gap-3 py-4 sm:flex-row sm:items-center"
				>
					<div class="flex min-w-0 flex-1 items-start gap-3">
						<Icon class="mt-1 size-5 shrink-0" />
						<div class="min-w-0">
							<a
								class="font-medium break-all underline-offset-4 hover:underline"
								href={`${data.base}/${doc.id}`}>{doc.filename}</a
							>{#if doc.designation}<form
									id="clear-master-cv"
									class="ml-2 inline-block"
									method="POST"
									action="?/master"
									use:enhance={finishDialog}
								>
									<input type="hidden" name="id" value="" />
									<input type="hidden" name="catalog_token" value={data.catalog_token} />
									<button
										type="button"
										onclick={() => {
											selected = doc;
											removeMaster = true;
										}}
										class="inline-flex items-center gap-1 rounded-[var(--r-control)] px-2 py-1 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
										title="Remove Master CV designation; keep the file"
										aria-label={`Remove Master CV designation from ${doc.filename}`}
										>Master CV<X class="size-3" /></button
									>
								</form>{/if}
							<p class="text-sm text-muted-foreground">
								{fileType(doc.filename).label} · {(doc.size / 1024).toFixed(1)} KiB · {new Date(
									doc.updated_at
								).toLocaleDateString()}
							</p>
						</div>
					</div>
					<div class="flex flex-wrap items-center gap-2 self-end sm:self-auto">
						{#if fileType(doc.filename).preview}<Button
								variant="ghost"
								size="sm"
								href={`${data.base}/${doc.id}`}>Preview</Button
							>{/if}{#if doc.can_edit_text}<Button
								variant="ghost"
								size="sm"
								href={`${data.base}/${doc.id}?edit=1`}>Edit</Button
							>{/if}<Button
							variant="ghost"
							size="sm"
							href={`/api/files/${doc.id}?scope=${data.scope}`}>Download</Button
						>
						<form
							id={`duplicate-${doc.id}`}
							class="hidden"
							method="POST"
							action="?/duplicate"
							use:enhance={finishDialog}
						>
							<input type="hidden" name="id" value={doc.id} />
							<input type="hidden" name="token" value={doc.token} />
						</form>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}<Button
										{...props}
										variant="ghost"
										size="icon"
										aria-label={`More actions for ${doc.filename}`}
										title={`More actions for ${doc.filename}`}><EllipsisVertical /></Button
									>{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content
									align="end"
									sideOffset={4}
									class="z-50 min-w-40 rounded-[var(--r-group)] border bg-card p-1 shadow-md"
								>
									<DropdownMenu.Item
										class="cursor-pointer rounded-[var(--r-control)] px-3 py-2 text-sm outline-none data-highlighted:bg-muted"
										onSelect={async () => {
											selected = doc;
											newName = doc.filename;
											await tick();
											rename = true;
										}}>Rename</DropdownMenu.Item
									>
									<DropdownMenu.Item
										class="cursor-pointer rounded-[var(--r-control)] px-3 py-2 text-sm outline-none data-highlighted:bg-muted"
										onSelect={() =>
											(
												document.getElementById(`duplicate-${doc.id}`) as HTMLFormElement
											)?.requestSubmit()}>Duplicate</DropdownMenu.Item
									>
									<DropdownMenu.Item
										class="cursor-pointer rounded-[var(--r-control)] px-3 py-2 text-sm outline-none data-highlighted:bg-muted"
										onSelect={async () => {
											selected = doc;
											await tick();
											remove = true;
										}}>Delete</DropdownMenu.Item
									>
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
					</div>
				</li>{/each}
		</ul>{/if}
	<nav aria-label="Document pages" class="flex items-center justify-between">
		{#if data.page > 1}<Button
				variant="outline"
				href={`?${new URLSearchParams({ query: data.query, page: String(data.page - 1) })}`}
				>Previous</Button
			>{:else}<span></span>{/if}<span class="text-sm"
			>Page {data.page} of {Math.max(1, data.totalPages)}</span
		>{#if data.page < data.totalPages}<Button
				variant="outline"
				href={`?${new URLSearchParams({ query: data.query, page: String(data.page + 1) })}`}
				>Next</Button
			>{/if}
	</nav>
</div>
<Dialog.Root bind:open={picker}
	><Dialog.Content
		><Dialog.Header
			><Dialog.Title>{copyPicker ? 'Copy to this job' : 'Select Master CV'}</Dialog.Title
			><Dialog.Description
				>{copyPicker
					? 'Choose a user document to copy. The original is kept.'
					: data.master
						? 'Choose an existing Markdown file. The previous document stays in Documents.'
						: 'Choose an existing Markdown document.'}</Dialog.Description
			></Dialog.Header
		>{#if pickerError}<Notice tone="error">{pickerError}</Notice>{/if}{#if form?.fileError}<Notice
				tone="error">{form.fileError}</Notice
			>{/if}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				choices();
			}}
			class="flex gap-2"
		>
			<Input aria-label="Search available documents" bind:value={pickerQuery} /><Button
				variant="outline"
				type="submit">Search</Button
			>
		</form>
		<form
			method="POST"
			action={copyPicker ? '?/copy' : '?/master'}
			use:enhance={finishDialog}
			class="space-y-4"
		>
			<input type="hidden" name="id" value={picked} /><input
				type="hidden"
				name="token"
				value={pickedToken}
			/><input type="hidden" name="catalog_token" value={catalog} />
			<fieldset class="max-h-64 space-y-3 overflow-auto">
				<legend class="sr-only">Available documents</legend>{#each candidates as doc (doc.id)}<label
						class="flex items-start gap-3 text-sm"
						><input
							type="radio"
							name="choice"
							value={doc.id}
							checked={picked === doc.id}
							onchange={() => {
								picked = doc.id;
								pickedToken = doc.token;
								newName = doc.filename;
							}}
						/><span class="break-all">{doc.filename}</span></label
					>{/each}{#if !candidates.length}<p class="text-sm">
						{copyPicker
							? 'No matching documents.'
							: 'No eligible files on this page. Search another page, or create or upload a Markdown document first.'}
					</p>{/if}
			</fieldset>
			{#if copyPicker}<label class="block space-y-2 text-sm"
					><span>Destination filename</span><Input
						name="filename"
						bind:value={newName}
						required
					/></label
				>{/if}
			<div class="flex justify-between">
				<Button
					type="button"
					variant="ghost"
					disabled={pickerPage <= 1}
					onclick={() => choices(pickerPage - 1)}>Previous</Button
				><span class="text-sm">Page {pickerPage}</span><Button
					type="button"
					variant="ghost"
					disabled={pickerPage >= pickerTotal}
					onclick={() => choices(pickerPage + 1)}>Next</Button
				>
			</div>
			<Dialog.Footer
				><Button type="button" variant="ghost" onclick={() => (picker = false)}>Cancel</Button
				><Button type="submit" disabled={!picked}
					>{copyPicker ? 'Copy document' : 'Use selected file'}</Button
				></Dialog.Footer
			>
		</form></Dialog.Content
	></Dialog.Root
>
<Dialog.Root bind:open={rename}
	><Dialog.Content
		><Dialog.Header
			><Dialog.Title>Rename document</Dialog.Title><Dialog.Description
				>The document stays in its current folder.</Dialog.Description
			></Dialog.Header
		>{#if form?.fileError}<Notice tone="error">{form.fileError}</Notice>{/if}
		<form method="POST" action="?/rename" use:enhance={finishDialog} class="space-y-4">
			<input type="hidden" name="id" value={selected?.id} /><input
				type="hidden"
				name="token"
				value={selected?.token}
			/><label class="block space-y-2 text-sm"
				><span>Filename *</span><Input name="filename" bind:value={newName} required /></label
			><Dialog.Footer
				><Button variant="ghost" onclick={() => (rename = false)}>Cancel</Button><Button
					type="submit">Save name</Button
				></Dialog.Footer
			>
		</form></Dialog.Content
	></Dialog.Root
>
<form id="delete-document" method="POST" action="?/delete">
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
	bind:open={removeMaster}
	title="Remove Master CV designation?"
	description={`${selected?.filename ?? 'This document'} will stay in Documents. You can select it as Master CV again later.`}
	confirmLabel="Remove designation"
	formId="clear-master-cv"
>
	{#if form?.fileError}<Notice tone="error">{form.fileError}</Notice>{/if}
</ConfirmDialog>
<ConfirmDialog
	bind:open={remove}
	title="Delete document?"
	description={`Permanently delete ${selected?.filename ?? 'this file'}? There is no Trash.${selected?.designation ? ' This also clears Master CV.' : ''}`}
	confirmLabel="Delete document"
	formId="delete-document"
	destructive
/>
