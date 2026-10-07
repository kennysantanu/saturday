<script lang="ts">
	import { onMount } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import { Markdown } from '@tiptap/markdown';
	import { Button } from '$lib/components/ui/button';
	let {
		value = '',
		readonly = false,
		onchange = (_: string) => {}
	} = $props<{ value?: string; readonly?: boolean; onchange?: (value: string) => void }>();
	let element: HTMLDivElement;
	let editor = $state<Editor | null>(null);
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
				attributes: {
					class: 'document-prose',
					role: 'textbox',
					'aria-label': 'Markdown document',
					'aria-multiline': 'true'
				}
			},
			onUpdate: ({ editor }) => onchange(editor.getMarkdown())
		});
		return () => editor?.destroy();
	});
	$effect(() => {
		if (editor && !editor.isDestroyed && value !== editor.getMarkdown())
			editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
	});
	$effect(() => {
		editor?.setEditable(!readonly);
	});
</script>

<div class="markdown-editor rounded-[var(--r-group)] border bg-card">
	{#if !readonly}<div
			class="flex flex-wrap gap-1 border-b p-2"
			role="toolbar"
			aria-label="Markdown formatting"
		>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>Heading</Button
			><Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => editor?.chain().focus().toggleBold().run()}>Bold</Button
			><Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => editor?.chain().focus().toggleItalic().run()}>Italic</Button
			><Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => editor?.chain().focus().toggleBulletList().run()}>List</Button
			><Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => editor?.chain().focus().undo().run()}>Undo</Button
			><Button
				type="button"
				variant="ghost"
				size="sm"
				onclick={() => editor?.chain().focus().redo().run()}>Redo</Button
			>
		</div>{/if}
	<div bind:this={element} class="min-h-48 p-4"></div>
</div>

<style>
	/* Documents use the same solid content surfaces and control radii as job pages. */
	.markdown-editor :global(.document-prose) {
		outline: none;
		overflow-wrap: anywhere;
		line-height: 1.7;
	}
	.markdown-editor :global(.document-prose:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
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
