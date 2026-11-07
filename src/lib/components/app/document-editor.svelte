<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { enhance, applyAction } from '$app/forms';
	import { goto } from '$app/navigation';
	import Download from '@lucide/svelte/icons/download';
	import Pencil from '@lucide/svelte/icons/pencil';
	import FileOutput from '@lucide/svelte/icons/file-output';
	import FilePen from '@lucide/svelte/icons/file-pen';
	import Copy from '@lucide/svelte/icons/copy';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { withPending, focusFirstError } from '$lib/forms';
	import { formatBytes, formatDateTime } from '$lib/format';
	import { toast } from '$lib/toast.svelte';
	import { UnsavedChanges } from '$lib/unsaved.svelte';
	import { visualMarkdownSupported, documentDesignations, fileType } from '$lib/file-types';
	import PageHeader from './page-header.svelte';
	import PageShell from './page-shell.svelte';
	import Notice from './notice.svelte';
	import Field from './field.svelte';
	import UnsavedGuard from './unsaved-guard.svelte';
	import ActionMenu from './action-menu.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	let { data, form } = $props();
	const guard = new UnsavedChanges();
	// Start from the loaded document so the first render is already correct; the effect below
	// keeps them in step when navigation brings new data.
	let content = $state(untrack(() => form?.values?.content ?? data.content ?? '')),
		name = $state(
			untrack(
				() => form?.values?.filename ?? (data.suggestedName || (data.document ? '' : 'Untitled'))
			)
		),
		source = $state(false),
		pdfBusy = $state(false),
		renameOpen = $state(false),
		deleteOpen = $state(false),
		renameTo = $state('');
	let nameInput = $state<HTMLInputElement | null>(null);
	let MarkdownEditor = $state<any>(null);
	const doc = $derived(data.document);
	const isMarkdown = $derived((doc?.format ?? data.format ?? 'markdown') === 'markdown');
	const supported = $derived(visualMarkdownSupported(content));
	const editing = $derived(Boolean(data.edit && (!doc || doc.can_edit_text) && !data.textError));
	const meta = $derived(
		doc
			? `${fileType(doc.filename).label} · ${formatBytes(doc.size)} · Updated ${formatDateTime(doc.updated_at)}`
			: ''
	);
	$effect(() => {
		content = form?.values?.content ?? data.content;
		name = form?.values?.filename ?? (data.suggestedName || (data.document ? '' : 'Untitled'));
		guard.dirty = !!form?.values && Object.hasOwn(form.values, 'content');
	});
	onMount(async () => {
		MarkdownEditor = (await import('./markdown-editor.svelte')).default;
		// A new document starts on its name, selected, so typing replaces "Untitled".
		if (!data.document && data.edit) {
			await tick();
			nameInput?.focus();
			nameInput?.select();
		}
	});
	// ----- Drafts: kept in this browser so a refresh, crash or swipe-back does not lose work.
	type Draft = { content: string; name: string; updatedAt: string | null; savedAt: number };
	const draftKey = $derived(
		`saturday-draft:${data.scope}:${doc?.id ?? `new:${data.designation ?? ''}`}`
	);
	let draft = $state<Draft | null>(null);
	let draftTimer: ReturnType<typeof setTimeout> | undefined;
	let wasDirty = false;
	const readDraft = (): Draft | null => {
		try {
			const raw = localStorage.getItem(draftKey);
			return raw ? (JSON.parse(raw) as Draft) : null;
		} catch {
			return null;
		}
	};
	const clearDraft = () => {
		clearTimeout(draftTimer);
		try {
			localStorage.removeItem(draftKey);
		} catch {
			/* Drafts are a convenience; storage may be unavailable. */
		}
	};
	const writeDraft = () => {
		try {
			const value: Draft = {
				content,
				name,
				updatedAt: doc?.updated_at ?? null,
				savedAt: Date.now()
			};
			localStorage.setItem(draftKey, JSON.stringify(value));
		} catch {
			/* Quota or privacy mode: skip silently. */
		}
	};
	// Offer a saved draft when editing starts, unless the file changed since (then it is stale).
	$effect(() => {
		if (!editing || form?.values) return;
		const saved = readDraft();
		const stale =
			!saved ||
			saved.updatedAt !== (doc?.updated_at ?? null) ||
			Date.now() - saved.savedAt > 14 * 24 * 3600 * 1000 ||
			saved.content === (data.content ?? '');
		if (stale) {
			if (saved) clearDraft();
			draft = null;
		} else draft = saved;
	});
	$effect(() => {
		if (!editing) return;
		if (guard.dirty) {
			wasDirty = true;
			content;
			name;
			clearTimeout(draftTimer);
			draftTimer = setTimeout(writeDraft, 600);
		} else if (wasDirty) {
			// A successful save cleans the form: the draft has served its purpose.
			wasDirty = false;
			clearDraft();
		}
	});
	function restoreDraft() {
		if (!draft) return;
		content = draft.content;
		if (!doc) name = draft.name;
		guard.markDirty();
		draft = null;
	}
	function discardDraft() {
		clearDraft();
		draft = null;
	}
	// ----- Keep the action bar above a soft keyboard (iOS does not resize the layout). Only the
	// viewport's resize is followed, once per frame and only when the value changes, so the page
	// is left alone while text is being selected or scrolled.
	$effect(() => {
		if (!editing || !window.visualViewport) return;
		const viewport = window.visualViewport;
		let frame = 0,
			last = 0;
		const update = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const raw = window.innerHeight - viewport.height - viewport.offsetTop;
				// Small differences are browser chrome, not a keyboard.
				const inset = raw > 120 ? Math.round(raw) : 0;
				if (inset === last) return;
				last = inset;
				document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
			});
		};
		update();
		viewport.addEventListener('resize', update);
		return () => {
			cancelAnimationFrame(frame);
			viewport.removeEventListener('resize', update);
			document.documentElement.style.removeProperty('--keyboard-inset');
		};
	});
	// Dropping a file on the page would navigate away from the draft.
	const blockFileDrop = (event: DragEvent) => {
		if (editing && Array.from(event.dataTransfer?.types ?? []).includes('Files'))
			event.preventDefault();
	};
	const flushDraft = () => {
		if (editing && guard.dirty) writeDraft();
	};
	const conflict = $derived(Boolean(form?.fileError?.includes('changed')));
	const saveShortcut = (event: KeyboardEvent) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && editing) {
			event.preventDefault();
			(document.getElementById('document-form') as HTMLFormElement | null)?.requestSubmit();
		}
	};
	const renameSubmit =
		() =>
		async ({ result }: any) => {
			if (result.type === 'redirect' && doc) {
				renameOpen = false;
				await goto(`${data.base}/${doc.id}`, { invalidateAll: true });
				toast.show('Document saved.');
			} else {
				await applyAction(result);
				await tick();
				focusFirstError();
			}
		};
	// Parse a detached document solely for preview; remove navigation and embedded resources.
	// Derived (not an effect) so it is always current whenever the page reads it.
	const htmlPreview = $derived.by(() => {
		if (doc?.format !== 'html' || typeof document === 'undefined') return '';
		const template = document.createElement('template');
		template.innerHTML = content;
		const parsed = template.content;
		parsed
			.querySelectorAll('script,meta,base,iframe,frame,object,embed,link,form')
			.forEach((n) => n.remove());
		parsed.querySelectorAll('*').forEach((n) => {
			for (const a of [...n.attributes])
				if (/^(on|href$|xlink:href$|src$|srcset$|action$|formaction$|target$)/i.test(a.name))
					n.removeAttribute(a.name);
		});
		return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'">${template.innerHTML}`;
	});
</script>

<svelte:window
	onkeydown={saveShortcut}
	ondragover={blockFileDrop}
	ondrop={blockFileDrop}
	onpagehide={flushDraft}
/>

{#snippet badges()}
	{#if meta}<span class="text-sm text-muted-foreground">{meta}</span>{/if}
	{#each doc?.designations ?? [] as key}<Badge variant="secondary"
			>{documentDesignations[key].label}</Badge
		>{/each}
{/snippet}

{#snippet barActions()}
	<div class="editor-bar-actions">
		<span class="editor-status" role="status"
			>{guard.dirty ? 'Unsaved changes' : doc ? 'No changes yet' : 'Not saved yet'}</span
		>
		<Button href={data.returnTo ?? (doc ? `${data.base}/${doc.id}` : data.base)} variant="ghost"
			>Cancel</Button
		>
		<Button type="submit" disabled={guard.saving} title="Save (Ctrl or ⌘ + S)"
			>{guard.saving ? 'Saving…' : data.designation ? 'Save and select' : 'Save'}</Button
		>
	</div>
{/snippet}

{#snippet barEnd()}
	<div class="editor-bar-end">
		{#if isMarkdown}{@render modeSwitch()}{/if}
		{@render barActions()}
	</div>
{/snippet}

{#snippet modeSwitch()}
	<div class="segmented" role="group" aria-label="Editing mode">
		<button
			type="button"
			aria-pressed={!source && supported}
			disabled={!supported}
			title={supported ? undefined : 'This document uses formatting the visual editor cannot keep.'}
			onclick={() => (source = false)}>Visual</button
		>
		<button type="button" aria-pressed={source || !supported} onclick={() => (source = true)}
			>Markdown</button
		>
	</div>
{/snippet}

<PageShell title={`${doc?.filename ?? 'New document'} · Documents`}>
	<PageHeader
		back={{ href: data.returnTo ?? data.base, label: data.returnTo ? 'profile' : 'documents' }}
		title={doc?.filename ?? 'New document'}
		titleClass="page-title-compact"
		meta={doc?.designations?.length || (doc && meta) ? badges : undefined}
	>
		{#snippet actions()}{#if doc && !editing}<Button
					variant="outline"
					href={`/api/files/${doc.id}?scope=${data.scope}`}
					><Download data-icon="inline-start" />Download</Button
				>{#if doc.format === 'html' && !data.textError && doc.can_read_text}<form
						method="POST"
						action="?/pdf"
						use:enhance={withPending(
							() => {
								pdfBusy = true;
								return async ({ update }) => {
									await update();
									pdfBusy = false;
								};
							},
							() => {
								pdfBusy = false;
							}
						)}
					>
						<input type="hidden" name="token" value={doc.token} /><Button
							type="submit"
							variant="outline"
							disabled={pdfBusy}
							><FileOutput data-icon="inline-start" />{pdfBusy
								? 'Generating PDF…'
								: 'Generate PDF'}</Button
						>
					</form>{/if}{#if doc.can_edit_text}<Button
						href={data.returnTo ? '?edit=1&return=profile' : '?edit=1'}
						><Pencil data-icon="inline-start" />Edit</Button
					>{/if}<ActionMenu
					label={`More actions for ${doc.filename}`}
					items={[
						{
							label: 'Rename',
							icon: FilePen,
							onselect: () => {
								renameTo = doc.filename;
								renameOpen = true;
							}
						},
						{
							label: 'Duplicate',
							icon: Copy,
							onselect: () =>
								(
									document.getElementById('duplicate-document') as HTMLFormElement | null
								)?.requestSubmit()
						},
						{
							label: 'Delete',
							icon: Trash2,
							destructive: true,
							separated: true,
							onselect: () => (deleteOpen = true)
						}
					]}
				/>{/if}{/snippet}
	</PageHeader>
	{#if form?.fileError}<Notice tone="error" title="The document action failed"
			>{form.fileError}</Notice
		>{/if}
	{#if data.textError}<Notice tone="error" title="The document could not be read"
			>{data.textError}</Notice
		>{/if}
	{#if editing && draft}
		<Notice title="Restore your unsaved draft?">
			<div class="draft-notice">
				<span
					>This browser kept edits from {formatDateTime(new Date(draft.savedAt).toISOString())} that were
					never saved.</span
				>
				<span class="flex gap-2">
					<Button type="button" variant="outline" onclick={restoreDraft}>Restore draft</Button>
					<Button type="button" variant="ghost" onclick={discardDraft}>Discard</Button>
				</span>
			</div>
		</Notice>
	{/if}
	{#if editing && conflict}
		<Notice tone="error" title="This document changed elsewhere">
			Another tab or your assistant saved a newer version. Your edits are still here: copy them, or
			use “Save draft as a copy” below, then reload to see the latest version.
		</Notice>
	{/if}
	{#if editing}
		<form
			id="document-form"
			method="POST"
			action="?/save"
			use:enhance={guard.enhance}
			class="space-y-5"
		>
			<input type="hidden" name="designation" value={data.designation ?? ''} />
			<input type="hidden" name="returnTo" value={data.returnTo ?? ''} />
			<input type="hidden" name="token" value={doc?.token ?? ''} /><input
				type="hidden"
				name="catalog_token"
				value={data.catalog_token ?? ''}
			/>
			{#if !doc}
				<Field id="document_name" label="Document name" required>
					{#snippet control(attrs)}
						<div class="input-affix">
							<Input
								{...attrs}
								bind:ref={nameInput}
								name="filename"
								oninput={guard.markDirty}
								bind:value={name}
								placeholder="Untitled"
								required
							/><span class="affix" aria-hidden="true">{isMarkdown ? '.md' : '.html'}</span>
						</div>
					{/snippet}
				</Field>
			{/if}
			{#if isMarkdown && supported && !source && MarkdownEditor}
				<MarkdownEditor
					value={content}
					toolbarEnd={barEnd}
					onchange={(value: string, changed: boolean) => {
						content = value;
						if (changed) guard.markDirty();
					}}
				/><input type="hidden" name="content" value={content} />
			{:else}
				{#if isMarkdown && !supported}<p class="text-sm text-muted-foreground">
						This document uses formatting outside the basic visual editor. Edit its Markdown source
						to preserve it.
					</p>{/if}
				<div class="editor-card">
					<div class="editor-sticky">
						<div class="editor-bar">
							<span class="px-2 text-sm font-medium"
								>{isMarkdown
									? 'Markdown source'
									: (doc?.format ?? data.format) === 'html'
										? 'HTML source'
										: 'Text'}</span
							>
							{@render barEnd()}
						</div>
					</div>
					<Label for="document_content" class="sr-only"
						>{isMarkdown
							? 'Markdown source'
							: (doc?.format ?? data.format) === 'html'
								? 'HTML source'
								: 'Text'}</Label
					>
					<Textarea
						id="document_content"
						name="content"
						bind:value={content}
						oninput={guard.markDirty}
						class="min-h-96 rounded-t-none border-0 font-mono shadow-none focus-visible:ring-0"
					/>
				</div>
			{/if}
			<div class="editor-actionbar">
				<p class="text-sm text-muted-foreground" role="status">
					{guard.dirty ? 'Unsaved changes' : doc ? 'No changes yet' : 'Not saved yet'}
				</p>
				<div class="flex items-center gap-2">
					<Button
						href={data.returnTo ?? (doc ? `${data.base}/${doc.id}` : data.base)}
						variant="ghost">Cancel</Button
					>
					<Button type="submit" disabled={guard.saving} title="Save (Ctrl or ⌘ + S)"
						>{guard.saving ? 'Saving…' : data.designation ? 'Save and select' : 'Save'}</Button
					>
				</div>
			</div>
		</form>
		{#if form?.fileError}
			<details class="disclosure disclosure-quiet" open={conflict}>
				<summary>Save draft as a copy</summary>
				<form
					class="disclosure-body space-y-3"
					method="POST"
					action="?/saveCopy"
					use:enhance={withPending(undefined, () => {
						guard.saving = false;
					})}
				>
					<input type="hidden" name="content" value={content} />
					<Field id="copy_filename" label="New filename" required>
						{#snippet control(attrs)}<Input
								{...attrs}
								name="filename"
								required
								value={doc ? `copy-${doc.filename}` : 'draft.md'}
							/>{/snippet}
					</Field>
					<Button type="submit" variant="outline" onclick={() => (guard.saving = true)}
						>Save as copy</Button
					>
				</form>
			</details>
		{/if}
	{:else if doc?.format === 'pdf' && doc.can_preview}<iframe
			title={`Preview of ${doc.filename}`}
			class="h-[70vh] w-full rounded-[var(--r-group)] border"
			src={`/api/files/${doc.id}?scope=${data.scope}&preview=1`}
		></iframe>
	{:else if doc?.format === 'html' && !data.textError && doc.can_read_text}<iframe
			title={`Preview of ${doc.filename}`}
			class="h-[55vh] min-h-72 w-full rounded-[var(--r-group)] border bg-white"
			sandbox=""
			referrerpolicy="no-referrer"
			srcdoc={htmlPreview}
		></iframe>
		<details class="disclosure disclosure-quiet">
			<summary>HTML source</summary>
			<pre class="disclosure-body overflow-auto whitespace-pre-wrap">{content}</pre>
		</details>
	{:else if isMarkdown && doc?.can_read_text && !data.textError}{#if supported && MarkdownEditor}<MarkdownEditor
				value={content}
				readonly
			/>{:else}<pre class="inset-surface overflow-auto p-4 whitespace-pre-wrap">{content}</pre>{/if}
	{:else if doc?.format === 'text' && doc.can_read_text && !data.textError}<pre
			class="inset-surface overflow-auto p-4 whitespace-pre-wrap">{content}</pre>
	{:else}<Notice
			>Preview and editing are unavailable for this file. Download it to view its contents.</Notice
		>{/if}
</PageShell>

{#if doc && !editing}
	<Dialog.Root bind:open={renameOpen}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Rename document</Dialog.Title>
				<Dialog.Description>The document keeps its contents and location.</Dialog.Description>
			</Dialog.Header>
			{#if form?.fileError}<Notice tone="error" title="The document was not renamed"
					>{form.fileError}</Notice
				>{/if}
			<form
				method="POST"
				action={`${data.base}?/rename`}
				use:enhance={withPending(renameSubmit)}
				class="space-y-5"
			>
				<input type="hidden" name="id" value={doc.id} /><input
					type="hidden"
					name="token"
					value={doc.token}
				/>
				<Field id="rename_filename" label="Filename" required>
					{#snippet control(attrs)}<Input
							{...attrs}
							name="filename"
							bind:value={renameTo}
							required
						/>{/snippet}
				</Field>
				<Dialog.Footer>
					<Button type="button" variant="ghost" onclick={() => (renameOpen = false)}>Cancel</Button>
					<Button type="submit">Save name</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>
	<form
		id="duplicate-document"
		class="hidden"
		method="POST"
		action={`${data.base}?/duplicate`}
		use:enhance={withPending()}
	>
		<input type="hidden" name="id" value={doc.id} /><input
			type="hidden"
			name="token"
			value={doc.token}
		/>
	</form>
	<form
		id="delete-document"
		class="hidden"
		method="POST"
		action={`${data.base}?/delete`}
		use:enhance={withPending()}
	>
		<input type="hidden" name="id" value={doc.id} /><input
			type="hidden"
			name="token"
			value={doc.token}
		/><input type="hidden" name="catalog_token" value={doc.catalog_token ?? ''} /><input
			type="hidden"
			name="clear_designations"
			value="true"
		/><input type="hidden" name="confirm" value="true" />
	</form>
	<ConfirmDialog
		bind:open={deleteOpen}
		title="Delete document?"
		description={`Permanently delete ${doc.filename}? There is no Trash.${doc.designations?.length ? ` This also clears ${doc.designations.map((key: string) => documentDesignations[key].label).join(', ')}.` : ''}`}
		confirmLabel="Delete document"
		formId="delete-document"
		destructive
	/>
{/if}
<UnsavedGuard {guard} />
