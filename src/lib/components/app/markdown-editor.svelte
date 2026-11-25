<script lang="ts">
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import { Editor } from '@tiptap/core';
	import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
	import { TextSelection } from '@tiptap/pm/state';
	import type { EditorView } from '@tiptap/pm/view';
	import { markdownExtensions, privateMarkdown } from '$lib/markdown-extensions';
	import { visualEditorLoss } from '$lib/markdown-visual';
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
	// The document the editor first held. A change that leaves the Markdown identical (a lossy serializer
	// can do that) is still a change, so edits are judged against this as well.
	let baselineDoc: any = null;
	// The Markdown last loaded into the editor or emitted by it. The text prop is applied to the
	// editor only when it genuinely differs from what the editor holds, never on trailing-newline or
	// serializer-formatting differences that represent the same document.
	let synced = '';
	// An external value that arrived while the editor was focused and could not be applied without
	// losing the user's selection; parked here and applied once the editor blurs.
	let pendingValue: string | null = null;
	const CONTEXT_RADIUS = 16;
	const normalizeEnd = (text: string) => text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
	function parseMarkdownDoc(current: Editor, markdown: string): ProseMirrorNode | null {
		try {
			const parsed = current.markdown?.parse(markdown);
			return parsed ? current.schema.nodeFromJSON(parsed) : null;
		} catch {
			return null;
		}
	}
	function matchesCurrentText(current: Editor, next: string): boolean {
		return (
			next === synced ||
			normalizeEnd(next) === normalizeEnd(synced) ||
			normalizeEnd(next) === normalizeEnd(current.getMarkdown())
		);
	}
	/**
	 * Finds the equivalent TextSelection range in `nextDoc` when the selected text and its immediate
	 * surroundings within the enclosing textblock(s) are unchanged. Returns null when mapping is
	 * unsafe or ambiguous so a focused editor is never clobbered.
	 */
	function findEquivalentSelection(
		prevDoc: ProseMirrorNode,
		nextDoc: ProseMirrorNode,
		selection: Editor['state']['selection']
	): { anchor: number; head: number } | null {
		if (!(selection instanceof TextSelection)) return null;
		const { from, to, anchor, head } = selection;
		const fromPos = selection.$from;
		const toPos = selection.$to;
		const reversed = anchor > head;
		const blockStart = fromPos.start();
		const blockEnd = toPos.end();
		const beforeStart = Math.max(blockStart, from - CONTEXT_RADIUS);
		const afterEnd = Math.min(blockEnd, to + CONTEXT_RADIUS);
		const before = prevDoc.textBetween(beforeStart, from, '\n', '\0');
		const selected = prevDoc.textBetween(from, to, '\n', '\0');
		const after = prevDoc.textBetween(to, afterEnd, '\n', '\0');
		const touchesStart = beforeStart === blockStart;
		const touchesEnd = afterEnd === blockEnd;
		const snippet = before + selected + after;
		if (!snippet.length) return null;
		const matchesAt = (candFrom: number, candTo: number): boolean => {
			if (candFrom < 0 || candTo > nextDoc.content.size || candFrom > candTo) return false;
			try {
				const candFromPos = nextDoc.resolve(candFrom);
				const candToPos = nextDoc.resolve(candTo);
				if (!candFromPos.parent.isTextblock || !candToPos.parent.isTextblock) return false;
				const cBlockStart = candFromPos.start();
				const cBlockEnd = candToPos.end();
				const cBeforeStart = candFrom - before.length;
				const cAfterEnd = candTo + after.length;
				if (cBeforeStart < cBlockStart || cAfterEnd > cBlockEnd) return false;
				if (touchesStart && cBeforeStart !== cBlockStart) return false;
				if (touchesEnd && cAfterEnd !== cBlockEnd) return false;
				const cBefore = nextDoc.textBetween(cBeforeStart, candFrom, '\n', '\0');
				const cSelected = nextDoc.textBetween(candFrom, candTo, '\n', '\0');
				const cAfter = nextDoc.textBetween(candTo, cAfterEnd, '\n', '\0');
				return cBefore === before && cSelected === selected && cAfter === after;
			} catch {
				return false;
			}
		};
		if (matchesAt(from, to)) {
			return reversed ? { anchor: to, head: from } : { anchor: from, head: to };
		}
		if (fromPos.sameParent(toPos)) {
			const matches: Array<{ from: number; to: number }> = [];
			nextDoc.descendants((node, pos) => {
				if (!node.isTextblock) return true;
				const start = pos + 1;
				const blockText = node.textBetween(0, node.content.size, '\n', '\0');
				let searchFrom = 0;
				while (searchFrom <= blockText.length) {
					const idx = blockText.indexOf(snippet, searchFrom);
					if (idx < 0) break;
					const candFrom = start + idx + before.length;
					const candTo = candFrom + selected.length;
					if (matchesAt(candFrom, candTo)) matches.push({ from: candFrom, to: candTo });
					searchFrom = idx + 1;
				}
				return false;
			});
			if (matches.length === 1) {
				const hit = matches[0];
				return reversed ? { anchor: hit.to, head: hit.from } : { anchor: hit.from, head: hit.to };
			}
		}
		return null;
	}
	function applyExternal(
		current: Editor,
		next: string,
		selection: { anchor: number; head: number } | null = null
	) {
		pendingValue = null;
		synced = next;
		current.commands.setContent(next, { contentType: 'markdown', emitUpdate: false });
		if (selection) {
			const size = current.state.doc.content.size;
			const anchor = Math.max(0, Math.min(selection.anchor, size));
			const head = Math.max(0, Math.min(selection.head, size));
			current.view.dispatch(
				current.state.tr.setSelection(TextSelection.create(current.state.doc, anchor, head))
			);
		}
		baseline = current.getMarkdown();
		baselineDoc = current.state.doc;
	}
	// ProseMirror's focus handler schedules a 20 ms timer that resets the DOM selection from
	// state.selection if domObserver.currentSelection lags behind the browser. Syncing pointer
	// selections in a microtask after mouseup/dblclick keeps ProseMirror aligned before that
	// timer can collapse a fresh word or drag selection.
	function syncPointerSelection(view: EditorView) {
		queueMicrotask(() => {
			if (view.isDestroyed || !view.hasFocus()) return;
			if (!(view.state.selection instanceof TextSelection)) return;
			const domSel = view.dom.ownerDocument.getSelection();
			if (
				!domSel ||
				!domSel.anchorNode ||
				!domSel.focusNode ||
				!view.dom.contains(domSel.anchorNode) ||
				!view.dom.contains(domSel.focusNode)
			)
				return;
			try {
				const anchor = view.posAtDOM(domSel.anchorNode, domSel.anchorOffset);
				const head = view.posAtDOM(domSel.focusNode, domSel.focusOffset);
				const next = TextSelection.between(
					view.state.doc.resolve(anchor),
					view.state.doc.resolve(head)
				);
				if (!next.eq(view.state.selection)) {
					view.dispatch(view.state.tr.setSelection(next).setMeta('pointer', true));
				}
			} catch {
				/* Ignore transient DOM positions outside editable content. */
			}
		});
	}
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
	function inTableCell($pos: {
		depth: number;
		node: (depth: number) => { type: { name: string } };
	}) {
		for (let depth = $pos.depth; depth > 0; depth--)
			if (['tableCell', 'tableHeader'].includes($pos.node(depth).type.name)) return true;
		return false;
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
	/**
	 * Names what saving would lose, or returns null. The Markdown written for the document on screen is read
	 * back and compared with that document itself, so loss inside the writer cannot go unseen.
	 */
	export function saveBlocker(): string | null {
		return editor ? visualEditorLoss(editor.getJSON()) : null;
	}
	/** The live document, for a draft: the Markdown alone cannot carry what the serializer would change. */
	export function liveDoc(): object | null {
		return editor ? editor.getJSON() : null;
	}
	/** Load a live document saved by liveDoc(). Returns false (leaving the editor untouched) if it is not valid. */
	export function restoreDoc(json: unknown): boolean {
		if (!editor || editor.isDestroyed || !json || typeof json !== 'object') return false;
		try {
			editor.schema.nodeFromJSON(json).check();
			pendingValue = null;
			return editor.commands.setContent(json as any, { emitUpdate: true });
		} catch {
			return false;
		}
	}
	onMount(() => {
		editor = new Editor({
			element,
			extensions: [...markdownExtensions(), privateMarkdown()],
			content: value,
			contentType: 'markdown',
			editable: !readonly,
			editorProps: {
				transformPastedHTML: cleanPaste,
				handleDOMEvents: {
					mouseup: (view, event) => {
						if (!(event.target instanceof HTMLInputElement)) syncPointerSelection(view);
						return false;
					},
					dblclick: (view, event) => {
						if (!(event.target instanceof HTMLInputElement)) syncPointerSelection(view);
						return false;
					}
				},
				handleKeyDown: (view, event) => {
					// A table cell is one line of Markdown. A line break there would be written as <br>, which
					// the editor cannot read back, so Enter (and Shift+Enter) does nothing inside a cell.
					if (event.key === 'Enter' && inTableCell(view.state.selection.$from)) {
						event.preventDefault();
						return true;
					}
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
			onCreate: ({ editor }) => {
				baseline = editor.getMarkdown();
				baselineDoc = editor.state.doc;
			},
			onUpdate: ({ editor, transaction }) => {
				const markdown = editor.getMarkdown();
				synced = markdown;
				// TrailingNode appends an empty paragraph on the first non-editing transaction (such as
				// focus) when a document ends with a list or table. Absorb that scaffolding into the
				// baseline so focusing or selecting text never marks an untouched document dirty.
				if (
					!transaction.docChanged &&
					baselineDoc &&
					transaction.doc.eq(baselineDoc) &&
					normalizeEnd(markdown) === normalizeEnd(baseline)
				) {
					baseline = markdown;
					baselineDoc = editor.state.doc;
					onchange(markdown, false);
					return;
				}
				// User edits supersede any parked external value so blur does not overwrite newer typing.
				pendingValue = null;
				onchange(markdown, markdown !== baseline || !editor.state.doc.eq(baselineDoc));
			},
			onBlur: ({ editor: current }) => {
				if (pendingValue === null || current.isDestroyed) return;
				const next = pendingValue;
				pendingValue = null;
				if (matchesCurrentText(current, next)) {
					synced = next;
					return;
				}
				const nextDoc = parseMarkdownDoc(current, next);
				if (nextDoc && nextDoc.eq(current.state.doc)) {
					synced = next;
					return;
				}
				applyExternal(current, next);
			},
			// Bump without letting a running effect depend on the counter it is writing.
			onTransaction: () => untrack(() => version++)
		});
		synced = value;
		baseline = editor.getMarkdown();
		baselineDoc = editor.state.doc;
		return () => editor?.destroy();
	});
	$effect(() => {
		const next = value;
		const current = editor;
		untrack(() => {
			if (!current || current.isDestroyed) return;
			if (matchesCurrentText(current, next)) {
				synced = next;
				pendingValue = null;
				return;
			}
			const nextDoc = parseMarkdownDoc(current, next);
			if (nextDoc && nextDoc.eq(current.state.doc)) {
				synced = next;
				pendingValue = null;
				return;
			}
			if (current.isFocused) {
				const mapped = nextDoc
					? findEquivalentSelection(current.state.doc, nextDoc, current.state.selection)
					: null;
				if (!mapped) {
					// Incoming content changes the text around the active selection or cannot be mapped
					// safely: park it and apply on blur instead of clobbering a focused editor.
					pendingValue = next;
					return;
				}
				applyExternal(current, next, mapped);
				return;
			}
			applyExternal(current, next);
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
	.markdown-editor :global(.document-prose table) {
		width: 100%;
		margin-block: 0.65rem;
		border-collapse: collapse;
		table-layout: fixed;
	}
	.markdown-editor :global(.document-prose th),
	.markdown-editor :global(.document-prose td) {
		border: 1px solid var(--border);
		padding: 0.4rem 0.6rem;
		text-align: left;
		vertical-align: top;
	}
	.markdown-editor :global(.document-prose th) {
		font-weight: 600;
	}
	.markdown-editor :global(.document-prose th > p),
	.markdown-editor :global(.document-prose td > p) {
		margin-block: 0;
	}
	.markdown-editor :global(.document-prose ul[data-type='taskList']) {
		list-style: none;
		padding-left: 0.25rem;
	}
	.markdown-editor :global(.document-prose ul[data-type='taskList'] li) {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	.markdown-editor :global(.document-prose ul[data-type='taskList'] li > label) {
		margin-top: 0.4rem;
	}
	.markdown-editor :global(.document-prose ul[data-type='taskList'] li > div) {
		flex: 1;
	}
	.markdown-editor :global(.document-prose a) {
		text-decoration: underline;
	}
</style>
