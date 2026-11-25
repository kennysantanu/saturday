<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { enhance, applyAction } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
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
	import { documentDesignations, fileType } from '$lib/file-types';
	import { HTML_BLOCKER, visualMarkdownBlocker } from '$lib/markdown-visual';
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
	// Deciding whether the visual editor can hold a document means a full read-and-write round trip, so it
	// runs once per revision: when a document opens, and (debounced) while the user types in the source
	// view. Edits made in the visual editor never re-run it; that would be per keystroke and could eject the
	// user from the editor mid-edit. The save below checks once more instead.
	let gatedText = untrack(() => content);
	let blocker = $state<string | null>(untrack(() => visualMarkdownBlocker(content)));
	let saveBlocked = $state<string | null>(null);
	let saveBlockedNote = $state<HTMLElement | null>(null);
	let noticeKind = $state<'save' | 'copy' | 'switch'>('save');
	// The visual editor, asked at save time whether the Markdown it writes would lose anything it shows.
	let visualEditor = $state<{
		saveBlocker(): string | null;
		liveDoc(): object | null;
		restoreDoc(json: unknown): boolean;
	} | null>(null);
	function regate() {
		if (content === gatedText) return;
		gatedText = content;
		blocker = visualMarkdownBlocker(content);
	}
	const supported = $derived(blocker === null);
	const blockedNote = $derived(
		blocker
			? blocker === HTML_BLOCKER
				? `The visual editor can’t keep ${blocker}, so this document opens as Markdown source. Wrap the HTML in code to use Visual, or edit in the source view.`
				: `The visual editor can’t keep ${blocker}, so this document opens as Markdown source. Edit the source, or remove that formatting to use Visual.`
			: ''
	);
	const status = $derived(
		saveBlocked && noticeKind !== 'switch'
			? 'Not saved yet'
			: guard.dirty
				? 'Unsaved changes'
				: doc
					? 'No changes yet'
					: 'Not saved yet'
	);
	const editing = $derived(Boolean(data.edit && (!doc || doc.can_edit_text) && !data.textError));
	const meta = $derived(
		doc
			? `${fileType(doc.filename).label} · ${formatBytes(doc.size)} · Updated ${formatDateTime(doc.updated_at)}`
			: ''
	);
	$effect(() => {
		content = form?.values?.content ?? data.content;
		untrack(regate);
		name = form?.values?.filename ?? (data.suggestedName || (data.document ? '' : 'Untitled'));
		guard.dirty = !!form?.values && Object.hasOwn(form.values, 'content');
	});
	$effect(() => {
		// In the source view, follow what is typed once the user pauses.
		if (!source && supported) return;
		const typed = content;
		const timer = setTimeout(() => untrack(() => content === typed && regate()), 400);
		return () => clearTimeout(timer);
	});
	// The visual editor writes Markdown back out. If that output is something it could not read again,
	// keep the edits and move to the source view rather than save text that would not reopen as shown.
	// What the live visual editor holds right now that its Markdown could not carry, or null when there is
	// no live visual editor (source view, other formats) or nothing would be lost.
	function liveLoss(): string | null {
		return isMarkdown && supported && !source ? (visualEditor?.saveBlocker() ?? null) : null;
	}
	// Refuse an action that would commit or discard lossy visual edits, and say so while the edits are
	// still live. 'save' and 'copy' report "Not saved yet"; 'switch' explains why Markdown is not shown.
	function refuse(problem: string, kind: 'save' | 'copy' | 'switch') {
		saveBlocked = problem;
		noticeKind = kind;
		void tick().then(() => saveBlockedNote?.querySelector<HTMLElement>('[role="alert"]')?.focus());
	}
	const guardedCopy: SubmitFunction = (input) => {
		const problem = liveLoss();
		if (problem) {
			input.cancel();
			refuse(problem, 'copy');
			return;
		}
		saveBlocked = null;
	};
	function showMarkdown() {
		const problem = liveLoss();
		if (problem) return refuse(problem, 'switch');
		saveBlocked = null;
		source = true;
	}
	function showVisual() {
		if (!source) return;
		// The debounced gate may be behind what was just typed: decide on the text as it is now.
		gatedText = content;
		blocker = visualMarkdownBlocker(content);
		if (blocker) return;
		saveBlocked = null;
		source = false;
		void applyHeldDoc();
	}
	async function applyHeldDoc() {
		const held = heldDoc;
		heldDoc = null;
		if (!held || held.content !== content) return;
		await tick();
		if (!visualEditor?.restoreDoc(held.doc)) heldDoc = held;
	}
	const guardedSave: SubmitFunction = (input) => {
		if (isMarkdown && supported && !source) {
			// First what the editor holds right now against what it would write for it (the written text
			// alone cannot show what writing already changed), then the written text against the gate.
			gatedText = content;
			const problem = visualEditor?.saveBlocker() ?? visualMarkdownBlocker(content);
			if (problem) {
				input.cancel();
				// Keep the visual editor mounted (and its undo history): the live document may be the only
				// intact copy of what was typed. Nothing was saved: move to the notice that says why.
				refuse(problem, 'save');
				return;
			}
			blocker = null;
		}
		saveBlocked = null;
	};
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
	// `doc` is the visual editor's live document, kept only while it holds something its Markdown cannot
	// carry (so `content` alone would restore a lossy copy). Older drafts have none and restore from `content`.
	type Draft = {
		content: string;
		name: string;
		updatedAt: string | null;
		savedAt: number;
		doc?: object;
	};
	const draftKey = $derived(
		`saturday-draft:${data.scope}:${doc?.id ?? `new:${data.designation ?? ''}`}`
	);
	let draft = $state<Draft | null>(null);
	let draftTimer: ReturnType<typeof setTimeout> | undefined;
	let wasDirty = false;
	// Bumped on every change to the live visual document, including ones that serialize to identical Markdown
	// (which leave `content` and `dirty` untouched), so the draft is rewritten for them too.
	let docRev = $state(0);
	// A draft's live document restored while the source view was showing (the visual editor was not there to
	// take it). Kept, with the Markdown it belongs to, so drafts keep carrying it and Visual applies it when the
	// user returns, as long as the Markdown was not edited in the meantime (then the source edits win).
	let heldDoc: { doc: object; content: string } | null = null;
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
			if (liveLoss()) value.doc = visualEditor?.liveDoc() ?? undefined;
			else if (heldDoc && heldDoc.content === content) value.doc = heldDoc.doc;
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
			(saved.content === (data.content ?? '') && !saved.doc);
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
			docRev;
			clearTimeout(draftTimer);
			draftTimer = setTimeout(writeDraft, 600);
		} else if (wasDirty) {
			// A successful save cleans the form: the draft has served its purpose.
			wasDirty = false;
			heldDoc = null;
			clearDraft();
		}
	});
	async function restoreDraft() {
		if (!draft) return;
		const live = draft.doc;
		content = draft.content;
		// Re-gate on the restored text now, not on the debounce: while Visual is active the cached gate
		// still describes the old text, and the visual parser would silently drop what it cannot hold.
		gatedText = content;
		blocker = visualMarkdownBlocker(content);
		if (blocker) {
			source = true;
			saveBlocked = null;
		}
		if (!doc) name = draft.name;
		guard.markDirty();
		draft = null;
		// Put the exact live document back when the visual editor is showing; otherwise the Markdown stands.
		if (live && !source && supported && isMarkdown) {
			await tick();
			visualEditor?.restoreDoc(live);
		} else if (live && isMarkdown) {
			// Source view (or not yet visual-safe): hold the JSON; see heldDoc.
			heldDoc = { doc: live, content };
		}
	}
	function discardDraft() {
		clearDraft();
		draft = null;
	}
	// The soft keyboard offset (`--keyboard-inset`) is tracked once for the whole app in +layout.
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
		<span class="editor-status" role="status">{status}</span>
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
			title={supported ? undefined : blockedNote}
			onclick={showVisual}>Visual</button
		>
		<button type="button" aria-pressed={source || !supported} onclick={showMarkdown}
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
		{#if saveBlocked}
			<div bind:this={saveBlockedNote}>
				{#if noticeKind === 'switch'}
					<Notice tone="error" title="Can’t show Markdown yet">
						Your edits can’t be written as Markdown exactly as they appear ({saveBlocked}), so the
						visual editor stays open and nothing was changed. Undo the last edit, then switch.
					</Notice>
				{:else if noticeKind === 'copy'}
					<Notice tone="error" title="Not saved yet">
						The visual editor can’t write this document back exactly as it appears ({saveBlocked}),
						so no copy was saved. Undo the last edit, then save the copy again.
					</Notice>
				{:else}
					<Notice tone="error" title="Not saved yet">
						The visual editor can’t write this document back exactly as it appears ({saveBlocked}),
						so nothing was saved. Your edits are still in the editor: undo the last edit, then save
						again.
					</Notice>
				{/if}
			</div>
		{/if}
		<form
			id="document-form"
			method="POST"
			action="?/save"
			use:enhance={guard.enhanceAfter(guardedSave)}
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
					bind:this={visualEditor}
					value={content}
					toolbarEnd={barEnd}
					onchange={(value: string, changed: boolean) => {
						content = value;
						docRev++;
						if (changed) guard.markDirty();
					}}
				/><input type="hidden" name="content" value={content} />
			{:else}
				{#if isMarkdown && !supported}<p class="text-sm text-muted-foreground" role="status">
						{blockedNote}
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
					{status}
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
					use:enhance={guard.enhanceAfter(guardedCopy)}
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
					<Button type="submit" variant="outline">Save as copy</Button>
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
			/>{:else}{#if blocker}<p class="mb-2 text-sm text-muted-foreground" role="status">
					Shown as source: {blockedNote}
				</p>{/if}
			<pre class="inset-surface overflow-auto p-4 whitespace-pre-wrap">{content}</pre>{/if}
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
