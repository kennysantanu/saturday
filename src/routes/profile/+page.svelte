<script lang="ts">
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { enhanceWithFocus, withPending, focusFirstError } from '$lib/forms';
	import { documentDesignations } from '$lib/file-types';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import SectionCard from '$lib/components/app/section-card.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import Field from '$lib/components/app/field.svelte';
	import FilterBar from '$lib/components/app/filter-bar.svelte';
	import Pagination from '$lib/components/app/pagination.svelte';
	import RadioOption from '$lib/components/app/radio-option.svelte';
	import ActionMenu from '$lib/components/app/action-menu.svelte';
	import ConfirmDialog from '$lib/components/app/confirm-dialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Dialog from '$lib/components/ui/dialog';
	import Upload from '@lucide/svelte/icons/upload';
	import Plus from '@lucide/svelte/icons/plus';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Pencil from '@lucide/svelte/icons/pencil';
	import X from '@lucide/svelte/icons/x';
	import { toast } from '$lib/toast.svelte';
	let { data, form } = $props();
	let picker = $state(false),
		picked = $state(''),
		pickedToken = $state('');
	let clearing = $state(false),
		clearKey = $state('');
	let uploading = $state(false),
		uploadKey = $state(''),
		uploadError = $state('');
	let uploadInput: HTMLInputElement;
	$effect(() => {
		picker = Boolean(data.select);
		picked = data.select ? (selected[data.select]?.id ?? '') : '';
		pickedToken = data.select ? (selected[data.select]?.token ?? '') : '';
	});
	$effect(() => {
		if (!picker && data.select) {
			const key = data.select;
			tick().then(() =>
				document.querySelector<HTMLAnchorElement>(`a[href="/profile?select=${key}"]`)?.focus()
			);
		}
	});

	const selected = $derived(data.selected as Record<string, any>);
	const choiceHref = (page: number) =>
		`?${new URLSearchParams({ select: data.select ?? '', query: data.query, page: String(page) })}`;
	async function upload(file: File) {
		if (uploading) return;
		uploading = true;
		uploadError = '';
		try {
			const r = await fetch(
				`/api/files/upload?${new URLSearchParams({ scope: 'documents', filename: file.name, designation: uploadKey, catalog_token: data.catalog_token })}`,
				{ method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }
			);
			const value = await r.json();
			if (!r.ok) throw new Error(value.error);
			toast.show('Document uploaded and selected.');
			await invalidateAll();
		} catch (e) {
			uploadError = (e as Error).message;
			await tick();
			focusFirstError();
		} finally {
			uploading = false;
		}
	}
</script>

<PageShell title="Profile">
	<PageHeader
		title="Profile"
		back={{ href: '/documents', label: 'documents' }}
		description="Documents your assistant can use for your applications."
	/>
	{#if data.fileError || form?.fileError || uploadError}<Notice
			tone="error"
			title="The Profile action failed">{data.fileError || form?.fileError || uploadError}</Notice
		>{/if}
	<input
		type="file"
		class="hidden"
		aria-label="Upload a Profile document"
		bind:this={uploadInput}
		accept={uploadKey ? documentDesignations[uploadKey].extension : undefined}
		onchange={(e) => {
			const file = e.currentTarget.files?.[0];
			e.currentTarget.value = '';
			if (file) upload(file);
		}}
	/>
	{#each Object.entries(documentDesignations) as [key, definition] (key)}
		{@const doc = selected[key]}
		<SectionCard title={definition.label} description={definition.description}>
			<div class="flex flex-wrap items-center justify-between gap-3">
				{#if doc}<a class="link min-w-0 break-all" href={`/documents/${doc.id}?return=profile`}
						>{doc.filename}</a
					>{:else}<p class="text-sm text-muted-foreground">No document selected.</p>{/if}
				{#if doc}<div class="flex items-center gap-2">
						<Button variant="outline" size="sm" href={`/documents/${doc.id}?edit=1&return=profile`}
							><Pencil data-icon="inline-start" />Edit</Button
						><ActionMenu
							label={`More actions for ${definition.label}`}
							items={[
								{
									label: 'Clear selection',
									icon: X,
									onselect: () => {
										clearKey = key;
										clearing = true;
									}
								}
							]}
						/>
					</div>{/if}
			</div>
			<div class="flex flex-wrap gap-2">
				<Button
					variant="outline"
					href={`/profile?select=${key}`}
					disabled={uploading || !data.catalog_token}
					><Link2 data-icon="inline-start" />Select document</Button
				>
				<Button
					variant="outline"
					disabled={uploading || !data.catalog_token}
					onclick={async () => {
						uploadKey = key;
						await tick();
						uploadInput.click();
					}}
					><Upload data-icon="inline-start" />{uploading && uploadKey === key
						? 'Uploading…'
						: 'Upload'}</Button
				>
				<Button
					variant="outline"
					href={`/documents/new?designation=${key}`}
					disabled={uploading || !data.catalog_token}
					><Plus data-icon="inline-start" />Create new</Button
				>
			</div>
		</SectionCard>
	{/each}
</PageShell>

<Dialog.Root bind:open={picker}>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header
			><Dialog.Title
				>Select {data.select ? documentDesignations[data.select].label : 'document'}</Dialog.Title
			><Dialog.Description
				>Choose an existing compatible file from Documents. The previous file is kept.</Dialog.Description
			></Dialog.Header
		>
		{#if form?.fileError}<Notice tone="error" title="The selection was not saved"
				>{form.fileError}</Notice
			>{/if}
		<FilterBar
			label="Search eligible documents"
			action="/profile"
			clearHref={`/profile?select=${data.select}`}
			applyLabel="Search"
			clearLabel="Clear search"
			showClear={Boolean(data.query)}
		>
			<input type="hidden" name="select" value={data.select ?? ''} />
			<Field id="profile_query" label="Search filenames"
				>{#snippet control(attrs)}<Input
						{...attrs}
						name="query"
						value={data.query}
					/>{/snippet}</Field
			>
		</FilterBar>
		<form method="POST" action="?/select" use:enhance={enhanceWithFocus} class="space-y-4">
			<input type="hidden" name="designation" value={data.select ?? ''} /><input
				type="hidden"
				name="id"
				value={picked}
			/><input type="hidden" name="token" value={pickedToken} /><input
				type="hidden"
				name="catalog_token"
				value={data.catalog_token}
			/>
			<fieldset class="max-h-64 space-y-2 overflow-auto">
				<legend class="sr-only">Eligible documents</legend>
				{#each data.choices?.documents ?? [] as doc (doc.id)}<RadioOption
						name="choice"
						value={doc.id}
						label={doc.filename}
						checked={picked === doc.id}
						onchange={() => {
							picked = doc.id;
							pickedToken = doc.token;
						}}
					/>{/each}
				{#if !data.choices?.documents.length}<p class="text-sm text-muted-foreground">
						No matching files. Upload or create a document from Profile.
					</p>{/if}
			</fieldset>
			<Pagination
				label="Eligible document pages"
				page={data.choices?.page ?? 1}
				totalPages={Math.max(1, data.choices?.totalPages ?? 1)}
				previous={choiceHref((data.choices?.page ?? 1) - 1)}
				next={choiceHref((data.choices?.page ?? 1) + 1)}
			/>
			<Dialog.Footer
				><Button variant="ghost" href="/profile">Cancel</Button><Button
					type="submit"
					disabled={!picked || picked === selected[data.select ?? '']?.id}>Use selected file</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>
<form
	id="clear-profile-selection"
	method="POST"
	action="?/select"
	use:enhance={withPending(() => async ({ result, update }) => {
		await update();
		if (result.type === 'redirect') clearing = false;
		else {
			await tick();
			focusFirstError();
		}
	})}
>
	<input type="hidden" name="designation" value={clearKey} /><input
		type="hidden"
		name="id"
		value=""
	/><input type="hidden" name="catalog_token" value={data.catalog_token} />
</form>
<ConfirmDialog
	bind:open={clearing}
	title={`Clear ${clearKey ? documentDesignations[clearKey].label : 'selection'}?`}
	description="The document stays in Documents. Your assistant will no longer find it through this designation."
	confirmLabel="Clear selection"
	formId="clear-profile-selection"
	>{#if form?.fileError}<Notice tone="error" title="The selection was not cleared"
			>{form.fileError}</Notice
		>{/if}</ConfirmDialog
>
