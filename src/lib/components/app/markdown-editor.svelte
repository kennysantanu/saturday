<script lang="ts">
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import { Markdown } from '@tiptap/markdown';
	import Bold from '@lucide/svelte/icons/bold';
	import Italic from '@lucide/svelte/icons/italic';
	import Strikethrough from '@lucide/svelte/icons/strikethrough';
	import List from '@lucide/svelte/icons/list';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import Quote from '@lucide/svelte/icons/quote';
	import LinkIcon from '@lucide/svelte/icons/link';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Redo2 from '@lucide/svelte/icons/redo-2';
	import NativeSelect from './native-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	let {
		value = '',
		readonly = false,
		placeholder = 'Start writing…',
		toolbarEnd,
		onchange = (_: string, __: boolean) => {}
	} = $props<{
		value?: string;
		readonly?: boolean;
		placeholder?: string;
		/** Controls shown at the right end of the toolbar, such as a Visual/Markdown switch. */
		toolbarEnd?: Snippet;
		/** Called with the Markdown and whether it differs from what the editor first loaded. */
		onchange?: (value: string, changed: boolean) => void;
	}>();
	let element: HTMLDivElement;
	let editor = $state<Editor | null>(null);
	// Bumped on every editor transaction so pressed and disabled states stay current.
	let version = $state(0);
	const track = () => version;
	// The Markdown the editor produced when it loaded. Loading can reformat a document, so
	// "changed" means different from this, not different from the stored text.
	let baseline = '';
	// The Markdown last loaded into the editor or emitted by it. The text prop is applied to the
	// editor only when it differs from this, never by comparing with getMarkdown() (which drops a
	// trailing newline and so would never match, re-running the effect without end).
	let synced = '';
	let linkOpen = $state(false),
		linkUrl = $state('');
	let linkInput = $state<HTMLInputElement | null>(null);
	let toolbar = $state<HTMLDivElement | null>(null);
	let pasteNote = $state(false);
	let roved = false;
	// Shortcut hints use the platform's modifier key.
	const mod =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
	const toolItems = () =>
		toolbar ? [...toolbar.querySelectorAll<HTMLElement>('button:not(:disabled), select')] : [];
	// The toolbar is one tab stop; arrow keys move between its controls.
	function rove(target: HTMLElement | undefined) {
		for (const el of toolbar?.querySelectorAll<HTMLElement>('button, select') ?? [])
			el.tabIndex = el === target ? 0 : -1;
	}
	function toolbarKeydown(event: KeyboardEvent) {
		const list = toolItems();
		const at = list.indexOf(document.activeElement as HTMLElement);
		if (event.key === 'Escape') {
			editor?.commands.focus();
			return;
		}
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || at < 0) return;
		event.preventDefault();
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? list.length - 1
					: (at + (event.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
		rove(list[next]);
		list[next].focus();
	}
	$effect(() => {
		track();
		if (!toolbar) return;
		const list = toolItems();
		if (!roved || !list.some((el) => el.tabIndex === 0)) {
			rove(list[0]);
			roved = true;
		}
	});
	// Keep the editor's selection and the keyboard when a tool is pressed.
	const keepFocus = (event: MouseEvent) => event.preventDefault();
	// Word and Google Docs paste inline styles and elements the editor cannot show.
	function cleanPaste(html: string) {
		const parsed = new DOMParser().parseFromString(html, 'text/html');
		if (parsed.querySelector('table,img,svg,video,iframe,object,embed')) pasteNote = true;
		parsed.querySelectorAll('style,script,meta,link,title').forEach((node) => node.remove());
		parsed.querySelectorAll('*').forEach((node) => {
			for (const attribute of [...node.attributes])
				if (!(attribute.name === 'href' && node.tagName === 'A'))
					node.removeAttribute(attribute.name);
		});
		return parsed.body.innerHTML;
	}
	const block = () => {
		track();
		for (const level of [1, 2, 3]) if (editor?.isActive('heading', { level })) return `h${level}`;
		return 'p';
	};
	const linkActive = () => (track(), editor?.isActive('link') ?? false);
	const empty = $derived((track(), editor?.isEmpty ?? true));
	function setBlock(kind: string) {
		const chain = editor?.chain().focus();
		if (!chain) return;
		if (kind === 'p') chain.setParagraph().run();
		else chain.setHeading({ level: Number(kind.slice(1)) as 1 | 2 | 3 }).run();
	}
	const marks = [
		{
			label: 'Bold',
			hint: `${mod}B`,
			icon: Bold,
			run: () => editor?.chain().focus().toggleBold().run(),
			active: () => (track(), editor?.isActive('bold') ?? false)
		},
		{
			label: 'Italic',
			hint: `${mod}I`,
			icon: Italic,
			run: () => editor?.chain().focus().toggleItalic().run(),
			active: () => (track(), editor?.isActive('italic') ?? false)
		},
		{
			label: 'Strikethrough',
			hint: `${mod}Shift+S`,
			icon: Strikethrough,
			run: () => editor?.chain().focus().toggleStrike().run(),
			active: () => (track(), editor?.isActive('strike') ?? false)
		}
	];
	const blocks = [
		{
			label: 'Bulleted list',
			hint: `${mod}Shift+8`,
			icon: List,
			run: () => editor?.chain().focus().toggleBulletList().run(),
			active: () => (track(), editor?.isActive('bulletList') ?? false)
		},
		{
			label: 'Numbered list',
			hint: `${mod}Shift+7`,
			icon: ListOrdered,
			run: () => editor?.chain().focus().toggleOrderedList().run(),
			active: () => (track(), editor?.isActive('orderedList') ?? false)
		},
		{
			label: 'Quote',
			hint: `${mod}Shift+B`,
			icon: Quote,
			run: () => editor?.chain().focus().toggleBlockquote().run(),
			active: () => (track(), editor?.isActive('blockquote') ?? false)
		}
	];
	const history = [
		{
			label: 'Undo',
			hint: `${mod}Z`,
			icon: Undo2,
			run: () => editor?.chain().focus().undo().run(),
			disabled: () => (track(), !editor?.can().undo())
		},
		{
			label: 'Redo',
			hint: `${mod}Shift+Z`,
			icon: Redo2,
			run: () => editor?.chain().focus().redo().run(),
			disabled: () => (track(), !editor?.can().redo())
		}
	];
	async function openLink() {
		linkUrl = editor?.getAttributes('link').href ?? '';
		linkOpen = true;
		await tick();
		linkInput?.focus();
	}
	function applyLink() {
		let url = linkUrl.trim();
		if (!url) return removeLink();
		if (!/^(https?:|mailto:|\/[^/]|#)/i.test(url)) url = `https://${url}`;
		editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
		linkOpen = false;
	}
	function removeLink() {
		editor?.chain().focus().extendMarkRange('link').unsetLink().run();
		linkOpen = false;
	}
	onMount(() => {
		editor = new Editor({
			element,
			extensions: [
				StarterKit.configure({
					link: {
						openOnClick: false,
						autolink: false,
						protocols: ['https', 'http', 'mailto'],
						isAllowedUri: (url) => /^(https?:|mailto:|\/[^/]|#)/i.test(url)
					},
					underline: false
				}),
				Markdown
			],
			content: value,
			contentType: 'markdown',
			editable: !readonly,
			editorProps: {
				transformPastedHTML: cleanPaste,
				handleKeyDown: (_view, event) => {
					if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !readonly) {
						event.preventDefault();
						void openLink();
						return true;
					}
					return false;
				},
				attributes: {
					class: 'document-prose',
					role: 'textbox',
					'aria-label': 'Markdown document',
					'aria-multiline': 'true'
				}
			},
			onCreate: ({ editor }) => (baseline = editor.getMarkdown()),
			onUpdate: ({ editor }) => {
				const markdown = editor.getMarkdown();
				synced = markdown;
				onchange(markdown, markdown !== baseline);
			},
			// Bump without letting a running effect depend on the counter it is writing.
			onTransaction: () => untrack(() => version++)
		});
		synced = value;
		baseline = editor.getMarkdown();
		return () => editor?.destroy();
	});
	$effect(() => {
		const next = value;
		const current = editor;
		untrack(() => {
			if (!current || current.isDestroyed || next === synced) return;
			synced = next;
			current.commands.setContent(next, { contentType: 'markdown', emitUpdate: false });
			baseline = current.getMarkdown();
		});
	});
	$effect(() => {
		const current = editor;
		const editable = !readonly;
		untrack(() => current?.setEditable(editable));
	});
</script>

<div class="markdown-editor editor-card">
	{#if !readonly}
		<div class="editor-sticky">
			<div class="editor-bar">
				<div
					bind:this={toolbar}
					class="editor-tools editor-toolbar"
					role="toolbar"
					aria-label="Markdown formatting"
					tabindex="-1"
					onkeydown={toolbarKeydown}
				>
					<div class="w-36">
						<NativeSelect
							aria-label="Text style"
							value={block()}
							onchange={(event) => setBlock(event.currentTarget.value)}
						>
							<option value="p">Paragraph</option>
							<option value="h1">Heading 1</option>
							<option value="h2">Heading 2</option>
							<option value="h3">Heading 3</option>
						</NativeSelect>
					</div>
					<span class="editor-sep" aria-hidden="true"></span>
					{#each [marks, blocks] as group, index (index)}
						{#each group as tool (tool.label)}
							<Button
								type="button"
								variant="ghost"
								size="icon"
								class="size-9"
								aria-label={tool.label}
								title={tool.hint ? `${tool.label} (${tool.hint})` : tool.label}
								aria-pressed={tool.active()}
								onmousedown={keepFocus}
								onclick={tool.run}><tool.icon aria-hidden="true" /></Button
							>
						{/each}
						<span class="editor-sep" aria-hidden="true"></span>
					{/each}
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="size-9"
						aria-label="Link"
						title={`Link (${mod}K)`}
						onmousedown={keepFocus}
						aria-pressed={linkActive()}
						onclick={openLink}><LinkIcon aria-hidden="true" /></Button
					>
					<span class="editor-sep" aria-hidden="true"></span>
					{#each history as tool (tool.label)}
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="size-9"
							aria-label={tool.label}
							title={tool.hint ? `${tool.label} (${tool.hint})` : tool.label}
							disabled={tool.disabled()}
							onmousedown={keepFocus}
							onclick={tool.run}><tool.icon aria-hidden="true" /></Button
						>
					{/each}
				</div>
				{#if toolbarEnd}{@render toolbarEnd()}{/if}
			</div>
			{#if linkOpen}
				<div class="editor-link-row">
					<Input
						bind:ref={linkInput}
						bind:value={linkUrl}
						type="text"
						inputmode="url"
						aria-label="Link address"
						placeholder="https://example.com"
						onkeydown={(event) => {
							if (event.key === 'Enter') {
								event.preventDefault();
								applyLink();
							} else if (event.key === 'Escape') {
								event.preventDefault();
								event.stopPropagation();
								linkOpen = false;
								editor?.commands.focus();
							}
						}}
					/>
					<Button type="button" onclick={applyLink}>Apply</Button>
					{#if editor?.isActive('link')}<Button type="button" variant="ghost" onclick={removeLink}
							>Remove link</Button
						>{/if}
					<Button
						type="button"
						variant="ghost"
						onclick={() => {
							linkOpen = false;
							editor?.commands.focus();
						}}>Cancel</Button
					>
				</div>
			{/if}
			{#if pasteNote}
				<p class="editor-paste-note" role="status">
					Some pasted content (tables, images) can’t be shown in the visual editor and was
					simplified.
					<button type="button" class="link ml-1" onclick={() => (pasteNote = false)}
						>Dismiss</button
					>
				</p>
			{/if}
		</div>
	{/if}
	<div class="editor-surface">
		{#if empty && !readonly}<p class="editor-placeholder" aria-hidden="true">{placeholder}</p>{/if}
		<div bind:this={element}></div>
	</div>
</div>

<style>
	/* Documents use the same solid content surfaces and control radii as job pages. */
	.markdown-editor :global(.document-prose) {
		min-height: 16rem;
		outline: none;
		overflow-wrap: anywhere;
		line-height: 1.7;
	}
	.markdown-editor :global(.document-prose:focus-visible) {
		outline: none;
	}
	.markdown-editor :global(.document-prose h1) {
		font-size: 1.8rem;
		font-weight: 600;
	}
	.markdown-editor :global(.document-prose h2) {
		font-size: 1.4rem;
		font-weight: 600;
	}
	.markdown-editor :global(.document-prose h3) {
		font-size: 1.15rem;
		font-weight: 600;
	}
	.markdown-editor :global(.document-prose p),
	.markdown-editor :global(.document-prose ul),
	.markdown-editor :global(.document-prose ol),
	.markdown-editor :global(.document-prose pre) {
		margin-block: 0.65rem;
	}
	.markdown-editor :global(.document-prose ul) {
		list-style: disc;
		padding-left: 1.5rem;
	}
	.markdown-editor :global(.document-prose ol) {
		list-style: decimal;
		padding-left: 1.5rem;
	}
	.markdown-editor :global(.document-prose blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 1rem;
	}
	.markdown-editor :global(.document-prose pre) {
		white-space: pre-wrap;
	}
	.markdown-editor :global(.document-prose a) {
		text-decoration: underline;
	}
</style>
