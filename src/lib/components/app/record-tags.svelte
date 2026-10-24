<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import type { TagCollection, TagPickerData } from '$lib/tag-types';
	import { Button } from '$lib/components/ui/button/index.js';
	import TagList from './tag-list.svelte';
	import TagEditorDialog from './tag-editor-dialog.svelte';
	let {
		collection,
		ownerId,
		initial
	}: { collection: TagCollection; ownerId: number; initial: TagPickerData } = $props();
	let editing = $state(false);
</script>

<div class="flex min-w-0 flex-wrap items-center gap-3" aria-label="Record tags">
	<TagList tags={initial.selectedTags} limit={Infinity} /><Button
		variant="ghost"
		size="sm"
		onclick={() => (editing = true)}
		><Pencil data-icon="inline-start" aria-hidden="true" />Edit tags</Button
	>
</div>
{#if editing}<TagEditorDialog
		{collection}
		{initial}
		mode="assign"
		{ownerId}
		onclose={() => (editing = false)}
	/>{/if}
