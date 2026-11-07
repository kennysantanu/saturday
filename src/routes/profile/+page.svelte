<script lang="ts">
	import { tick } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { focusFirstError, withPending } from '$lib/forms';
	import { uploadFile } from '$lib/upload';
	import { fileIconFor } from '$lib/file-icons';
	import { documentDesignations, documentDesignationGroups, fileType } from '$lib/file-types';
	import { formatBytes, formatDateTime } from '$lib/format';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import RowActions from '$lib/components/app/row-actions.svelte';
	import ActionMenu from '$lib/components/app/action-menu.svelte';
	import ConfirmDialog from '$lib/components/app/confirm-dialog.svelte';
	import DocumentPicker from '$lib/components/app/document-picker.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import FileUser from '@lucide/svelte/icons/file-user';
	import Compass from '@lucide/svelte/icons/compass';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import LayoutTemplate from '@lucide/svelte/icons/layout-template';
	import Mail from '@lucide/svelte/icons/mail';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Upload from '@lucide/svelte/icons/upload';
	import Plus from '@lucide/svelte/icons/plus';
	import X from '@lucide/svelte/icons/x';
	import { toast } from '$lib/toast.svelte';
	let { data, form } = $props();

	const slotIcons = {
		master_cv: FileUser,
		career_direction: Compass,
		assistant_preferences: Sparkles,
		resume_template: LayoutTemplate,
		cover_letter_template: Mail
	};
	const selected = $derived(data.selected as Record<string, any>);
	const slotErrors = $derived((data.slotErrors ?? {}) as Record<string, string>);
	const slotCount = Object.keys(documentDesignations).length;
	const setCount = $derived(
		Object.keys(documentDesignations).filter((key) => selected[key]).length
	);
	const formatLabel = (key: string) => fileType(`x${documentDesignations[key].extension}`).label;

	let clearing = $state(false),
		clearKey = $state('');
	let uploading = $state(false),
		progress = $state(0),
		uploadKey = $state(''),
		uploadError = $state<{ key: string; message: string } | null>(null);
	let uploadInput: HTMLInputElement;
	// Bound menu triggers must start as null, not undefined.
	let menuRefs = $state<Record<string, HTMLButtonElement | null>>(
		Object.fromEntries(Object.keys(documentDesignations).map((key) => [key, null]))
	);
	const locked = $derived(uploading || !data.catalog_token);

	function chooseUpload(key: string) {
		uploadKey = key;
		void tick().then(() => uploadInput.click());
	}
	function askClear(key: string) {
		clearKey = key;
		clearing = true;
	}
	function returnFocus(key: string) {
		(document.querySelector<HTMLElement>(`[data-select="${key}"]`) ?? menuRefs[key])?.focus();
	}
	async function upload(file: File, key: string) {
		if (uploading) return;
		uploading = true;
		progress = 0;
		uploadError = null;
		try {
			const value = await uploadFile(
				file,
				{
					scope: 'documents',
					designation: key,
					catalog_token: data.catalog_token
				},
				{ onprogress: (percent) => (progress = percent), retry: () => upload(file, key) }
			);
			toast.show(`Uploaded ${value?.filename ?? file.name} as ${documentDesignations[key].label}.`);
			// Close an open picker; the new file is already selected.
			if (data.select) await goto('/profile', { replaceState: true, noScroll: true });
			await invalidateAll();
			await tick();
			returnFocus(key);
		} catch (e) {
			uploadError = { key, message: (e as Error).message };
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
		description="Documents your assistant reads when it tailors your applications."
	>
		{#snippet meta()}
			<Badge variant="secondary">{setCount} of {slotCount} set up</Badge>
		{/snippet}
	</PageHeader>
	{#if data.fileError}<Notice tone="error" title="The Profile could not be loaded"
			>{data.fileError}</Notice
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
			if (file) void upload(file, uploadKey);
		}}
	/>
	{#each documentDesignationGroups as group (group.id)}
		<section class="space-y-3" aria-labelledby={`profile-${group.id}`}>
			<div class="space-y-1">
				<h2 id={`profile-${group.id}`} class="text-base leading-snug font-medium">
					{group.title}
				</h2>
				<p class="text-sm text-muted-foreground">{group.description}</p>
			</div>
			<Card.Root class="gap-0 divide-y divide-border p-0">
				{#each group.keys as key (key)}
					{@const definition = documentDesignations[key]}
					{@const doc = selected[key]}
					{@const Mark = slotIcons[key as keyof typeof slotIcons]}
					{@const DocIcon = doc ? fileIconFor(doc.filename) : null}
					<div class="profile-slot">
						<div class="list-row" data-static>
							<span class="list-row-icon" aria-hidden="true"><Mark class="size-5" /></span>
							<div class="list-row-body">
								<p class="flex flex-wrap items-center gap-2 font-semibold">
									{definition.label}
									<Badge variant="secondary">{formatLabel(key)}</Badge>
									{#if !doc}<Badge variant="outline">Not set</Badge>{/if}
								</p>
								{#if doc && DocIcon}
									<p class="flex min-w-0 items-center gap-2 text-sm">
										<DocIcon class="size-4 shrink-0 text-muted-foreground" />
										<a class="link min-w-0 break-words" href={`/documents/${doc.id}?return=profile`}
											>{doc.filename}</a
										>
									</p>
									<p class="list-row-meta">
										{fileType(doc.filename).label} · {formatBytes(doc.size)} · {formatDateTime(
											doc.updated_at
										)}
									</p>
								{:else}
									<p class="list-row-meta">{definition.description}</p>
								{/if}
								{#if uploading && uploadKey === key}
									<div role="status" class="space-y-1">
										<p class="text-sm text-muted-foreground">Uploading… {progress}%</p>
										<progress class="h-1.5 w-full accent-primary" max="100" value={progress}
										></progress>
									</div>
								{/if}
							</div>
							<div class="list-row-actions">
								{#if doc}
									<RowActions
										label={definition.label}
										editHref={doc.can_edit_text
											? `/documents/${doc.id}?edit=1&return=profile`
											: undefined}
										bind:menuRef={menuRefs[key]}
										menu={[
											{
												label: 'Choose another document',
												icon: Link2,
												href: `/profile?select=${key}`
											},
											{
												label: 'Upload a replacement',
												icon: Upload,
												onselect: () => chooseUpload(key)
											},
											{
												label: 'Create new document',
												icon: Plus,
												href: `/documents/new?designation=${key}`
											},
											{
												label: 'Clear selection',
												icon: X,
												separated: true,
												onselect: () => askClear(key)
											}
										]}
									/>
								{:else}
									<Button
										variant="outline"
										size="sm"
										href={`/profile?select=${key}`}
										data-select={key}
										disabled={locked}
										aria-label={`Select document for ${definition.label}`}
										><Link2 data-icon="inline-start" />Select document</Button
									>
									<ActionMenu
										bind:ref={menuRefs[key]}
										label={`More ways to add ${definition.label}`}
										disabled={locked}
										items={[
											{
												label: 'Upload a file',
												icon: Upload,
												onselect: () => chooseUpload(key)
											},
											{
												label: 'Create new document',
												icon: Plus,
												href: `/documents/new?designation=${key}`
											},
											...(slotErrors[key]
												? [
														{
															label: 'Clear selection',
															icon: X,
															separated: true,
															onselect: () => askClear(key)
														}
													]
												: [])
										]}
									/>
								{/if}
							</div>
						</div>
						{#if slotErrors[key]}
							<div class="profile-slot-notice">
								<Notice tone="error" title={`${definition.label} could not be read`}
									>{slotErrors[key]} Select another document or clear the selection.</Notice
								>
							</div>
						{/if}
						{#if uploadError?.key === key && !data.select}
							<div class="profile-slot-notice">
								<Notice tone="error" title="The upload failed">{uploadError.message}</Notice>
							</div>
						{/if}
					</div>
				{/each}
			</Card.Root>
		</section>
	{/each}
</PageShell>

{#if data.select}
	{@const key = data.select}
	{#key key}
		<DocumentPicker
			designation={key}
			label={documentDesignations[key].label}
			formatLabel={formatLabel(key)}
			choices={data.choices?.documents ?? []}
			page={data.choices?.page ?? 1}
			totalPages={Math.max(1, data.choices?.totalPages ?? 1)}
			total={data.choices?.total ?? 0}
			current={selected[key] ?? null}
			queryValue={data.query}
			catalogToken={data.catalog_token}
			error={form?.fileError ?? (uploadError?.key === key ? uploadError.message : null)}
			uploadLabel={uploading && uploadKey === key ? `Uploading ${progress}%` : 'Upload'}
			busy={locked}
			createHref={`/documents/new?designation=${key}`}
			onupload={() => chooseUpload(key)}
			onclosed={() => returnFocus(key)}
		/>
	{/key}
{/if}
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
