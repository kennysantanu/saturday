<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { focusFirstError } from '$lib/forms';
	import { visualMarkdownSupported } from '$lib/file-types';
	import PageHeader from './page-header.svelte';
	import Notice from './notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Dialog from '$lib/components/ui/dialog';
	let { data, form } = $props();
	let content = $state(''),
		name = $state(''),
		source = $state(false),
		dirty = $state(false),
		saving = $state(false),
		leave = $state(false),
		leaveTo = $state(''),
		pdfBusy = $state(false);
	let MarkdownEditor = $state<any>(null),
		htmlPreview = $state('');
	const doc = $derived(data.document);
	const isMarkdown = $derived(!doc || doc.format === 'markdown');
	const supported = $derived(visualMarkdownSupported(content));
	$effect(() => {
		content = form?.values?.content ?? data.content;
		name = form?.values?.filename ?? '';
		dirty = !!form?.values && Object.hasOwn(form.values, 'content');
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
	beforeNavigate((n) => {
		if (dirty && !saving) {
			n.cancel();
			if (n.to) {
				leaveTo = n.to.url.href;
				leave = true;
			}
		}
	});
	function unload(e: BeforeUnloadEvent) {
		if (dirty) {
			e.preventDefault();
			e.returnValue = '';
		}
	}
</script>

<svelte:window onbeforeunload={unload} />
<svelte:head><title>{doc?.filename ?? 'New document'} · Saturday</title></svelte:head>
<div class="space-y-6">
	<a class="back-link" href={data.base}>Back to documents</a><PageHeader
		title={doc?.filename ?? 'New document'}
		description={doc?.designation ? 'Master CV' : undefined}
	>
		{#snippet actions()}{#if doc}<Button
					variant="outline"
					href={`/api/files/${doc.id}?scope=${data.scope}`}>Download</Button
				>{#if doc.can_edit_text && !data.edit}<Button href={`?edit=1`}>Edit</Button
					>{/if}{/if}{/snippet}
	</PageHeader>
	{#if form?.fileError}<Notice tone="error">{form.fileError}</Notice
		>{/if}{#if data.textError}<Notice tone="error">{data.textError}</Notice>{/if}
	{#if data.edit && (!doc || doc.can_edit_text) && !data.textError}
		<form
			method="POST"
			action="?/save"
			use:enhance={() => {
				saving = true;
				return async ({ update }) => {
					await update({ reset: false });
					await tick();
					focusFirstError();
					saving = false;
				};
			}}
			class="space-y-5"
		>
			<p class="text-sm text-muted-foreground">{dirty ? 'Unsaved changes' : '* Required'}</p>
			<input type="hidden" name="token" value={doc?.token ?? ''} />
			{#if !doc}<label class="block space-y-2 text-sm"
					><span>Document name *</span>
					<div class="flex items-center gap-2">
						<Input
							name="filename"
							oninput={() => (dirty = true)}
							bind:value={name}
							placeholder="Untitled"
							required
						/><span>.md</span>
					</div></label
				>{/if}
			{#if isMarkdown}<Button
					type="button"
					variant="outline"
					size="sm"
					onclick={() => (source = !source)}>{source ? 'Visual editor' : 'Markdown source'}</Button
				>{#if !supported}<p class="text-sm text-muted-foreground">
						This document uses formatting outside the basic visual editor. Edit its Markdown source
						to preserve it.
					</p>{/if}{/if}
			{#if isMarkdown && supported && !source && MarkdownEditor}<MarkdownEditor
					value={content}
					onchange={(value: string) => {
						content = value;
						dirty = true;
					}}
				/><input type="hidden" name="content" value={content} />{:else}<label
					class="block space-y-2 text-sm"
					><span
						>{isMarkdown
							? 'Markdown source'
							: doc?.format === 'html'
								? 'HTML source'
								: 'Text'}</span
					><Textarea
						name="content"
						bind:value={content}
						oninput={() => (dirty = true)}
						class="min-h-96 font-mono"
					/></label
				>{/if}
			<div class="form-actions">
				<Button href={doc ? `${data.base}/${doc.id}` : data.base} variant="ghost">Cancel</Button
				><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
			</div>
		</form>
		{#if form?.fileError}<details class="disclosure">
				<summary>Save draft as a copy</summary>
				<form class="disclosure-body space-y-3" method="POST" action="?/saveCopy">
					<input type="hidden" name="content" value={content} /><label
						class="block space-y-2 text-sm"
						><span>New filename *</span><Input
							name="filename"
							required
							value={doc ? `copy-${doc.filename}` : 'draft.md'}
						/></label
					><Button type="submit" variant="outline" onclick={() => (saving = true)}
						>Save as copy</Button
					>
				</form>
			</details>{/if}
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
			use:enhance={() => {
				pdfBusy = true;
				return async ({ update }) => {
					await update();
					pdfBusy = false;
				};
			}}
		>
			<input type="hidden" name="token" value={doc.token} /><Button
				type="submit"
				variant="outline"
				disabled={pdfBusy}>{pdfBusy ? 'Generating PDF…' : 'Generate PDF'}</Button
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
</div>
<Dialog.Root bind:open={leave}
	><Dialog.Content
		><Dialog.Header
			><Dialog.Title>Discard unsaved changes?</Dialog.Title><Dialog.Description
				>Your latest edits have not been saved.</Dialog.Description
			></Dialog.Header
		><Dialog.Footer
			><Button variant="ghost" onclick={() => (leave = false)}>Keep editing</Button><Button
				variant="destructive"
				onclick={() => {
					dirty = false;
					window.location.href = leaveTo;
				}}>Discard changes</Button
			></Dialog.Footer
		></Dialog.Content
	></Dialog.Root
>
