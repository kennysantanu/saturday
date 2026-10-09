<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import Download from '@lucide/svelte/icons/download';
	import Pencil from '@lucide/svelte/icons/pencil';
	import FileOutput from '@lucide/svelte/icons/file-output';
	import { withPending } from '$lib/forms';
	import { UnsavedChanges } from '$lib/unsaved.svelte';
	import { visualMarkdownSupported, documentDesignations } from '$lib/file-types';
	import PageHeader from './page-header.svelte';
	import PageShell from './page-shell.svelte';
	import Notice from './notice.svelte';
	import Field from './field.svelte';
	import UnsavedGuard from './unsaved-guard.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	let { data, form } = $props();
	const guard = new UnsavedChanges();
	let content = $state(''),
		name = $state(''),
		source = $state(false),
		pdfBusy = $state(false);
	let MarkdownEditor = $state<any>(null),
		htmlPreview = $state('');
	const doc = $derived(data.document);
	const isMarkdown = $derived((doc?.format ?? data.format ?? 'markdown') === 'markdown');
	const supported = $derived(visualMarkdownSupported(content));
	$effect(() => {
		content = form?.values?.content ?? data.content;
		name = form?.values?.filename ?? data.suggestedName ?? '';
		guard.dirty = !!form?.values && Object.hasOwn(form.values, 'content');
	});
	onMount(async () => {
		MarkdownEditor = (await import('./markdown-editor.svelte')).default;
	});
	// Parse a detached document solely for preview; remove navigation and embedded resources.
	$effect(() => {
		if (doc?.format !== 'html' || typeof document === 'undefined') return;
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
		htmlPreview = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'">${template.innerHTML}`;
	});
</script>

{#snippet badges()}
	{#each doc?.designations ?? [] as key}<Badge variant="secondary"
			>{documentDesignations[key].label}</Badge
		>{/each}
	{#if guard.dirty}<Badge variant="outline">Unsaved changes</Badge>{/if}
{/snippet}

<PageShell title={`${doc?.filename ?? 'New document'} · Documents`}>
	<PageHeader
		back={{ href: data.returnTo ?? data.base, label: data.returnTo ? 'profile' : 'documents' }}
		title={doc?.filename ?? 'New document'}
		meta={doc?.designation || guard.dirty ? badges : undefined}
	>
		{#snippet actions()}{#if doc}<Button
					variant="outline"
					href={`/api/files/${doc.id}?scope=${data.scope}`}
					><Download data-icon="inline-start" />Download</Button
				>{#if doc.can_edit_text && !data.edit}<Button
						href={data.returnTo ? '?edit=1&return=profile' : '?edit=1'}
						><Pencil data-icon="inline-start" />Edit</Button
					>{/if}{/if}{/snippet}
	</PageHeader>
	{#if form?.fileError}<Notice tone="error" title="The document was not saved"
			>{form.fileError}</Notice
		>{/if}
	{#if data.textError}<Notice tone="error" title="The document could not be read"
			>{data.textError}</Notice
		>{/if}
	{#if data.edit && (!doc || doc.can_edit_text) && !data.textError}
		<form method="POST" action="?/save" use:enhance={guard.enhance} class="space-y-5">
			<input type="hidden" name="designation" value={data.designation ?? ''} />
			<input type="hidden" name="returnTo" value={data.returnTo ?? ''} />
			{#if !doc}
				<p class="text-sm text-muted-foreground">
					<span class="text-destructive" aria-hidden="true">*</span> Required
				</p>
			{/if}
			<input type="hidden" name="token" value={doc?.token ?? ''} /><input
				type="hidden"
				name="catalog_token"
				value={data.catalog_token ?? ''}
			/>
			{#if !doc}
				<Field id="document_name" label="Document name" required>
					{#snippet control(attrs)}
						<div class="flex items-center gap-2">
							<Input
								{...attrs}
								name="filename"
								oninput={guard.markDirty}
								bind:value={name}
								placeholder="Untitled"
								required
							/><span class="shrink-0">{isMarkdown ? '.md' : '.html'}</span>
						</div>
					{/snippet}
				</Field>
			{/if}
			{#if isMarkdown}
				<Button type="button" variant="outline" size="sm" onclick={() => (source = !source)}
					>{source ? 'Visual editor' : 'Markdown source'}</Button
				>{#if !supported}<p class="text-sm text-muted-foreground">
						This document uses formatting outside the basic visual editor. Edit its Markdown source
						to preserve it.
					</p>{/if}
			{/if}
			{#if isMarkdown && supported && !source && MarkdownEditor}
				<MarkdownEditor
					value={content}
					onchange={(value: string) => {
						content = value;
						guard.markDirty();
					}}
				/><input type="hidden" name="content" value={content} />
			{:else}
				<Field
					id="document_content"
					label={isMarkdown
						? 'Markdown source'
						: (doc?.format ?? data.format) === 'html'
							? 'HTML source'
							: 'Text'}
				>
					{#snippet control(attrs)}<Textarea
							{...attrs}
							name="content"
							bind:value={content}
							oninput={guard.markDirty}
							class="min-h-96 font-mono"
						/>{/snippet}
				</Field>
			{/if}
			<div class="form-actions justify-end">
				<Button href={data.returnTo ?? (doc ? `${data.base}/${doc.id}` : data.base)} variant="ghost"
					>Cancel</Button
				>
				<Button type="submit" disabled={guard.saving}
					>{guard.saving ? 'Saving…' : data.designation ? 'Save and select' : 'Save'}</Button
				>
			</div>
		</form>
		{#if form?.fileError}
			<details class="disclosure">
				<summary>Save draft as a copy</summary>
				<form
					class="disclosure-body space-y-3"
					method="POST"
					action="?/saveCopy"
					use:enhance={withPending()}
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
			class="h-[70vh] w-full rounded-[var(--r-group)] border bg-white"
			sandbox=""
			referrerpolicy="no-referrer"
			srcdoc={htmlPreview}
		></iframe>
		<details class="disclosure">
			<summary>HTML source</summary>
			<pre class="disclosure-body overflow-auto whitespace-pre-wrap">{content}</pre>
		</details>
		<form
			method="POST"
			action="?/pdf"
			use:enhance={withPending(() => {
				pdfBusy = true;
				return async ({ update }) => {
					await update();
					pdfBusy = false;
				};
			})}
		>
			<input type="hidden" name="token" value={doc.token} /><Button
				type="submit"
				variant="outline"
				disabled={pdfBusy}
				><FileOutput data-icon="inline-start" />{pdfBusy
					? 'Generating PDF…'
					: 'Generate PDF'}</Button
			>
		</form>
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
<UnsavedGuard {guard} />
