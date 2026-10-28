<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import DiscardChangesDialog from './discard-changes-dialog.svelte';
	import type { UnsavedChanges } from '$lib/unsaved.svelte';
	import UnsavedGuard from './unsaved-guard.svelte';

	/** Guards a short form's Cancel, Close, Escape, backdrop and page navigation. */
	let {
		open = $bindable(false),
		guard,
		onclosed,
		children
	}: {
		open?: boolean;
		guard: UnsavedChanges;
		onclosed?: () => void;
		children: Snippet<[() => void]>;
	} = $props();
	let discardOpen = $state(false);
	$effect(() => {
		if (!open) {
			guard.dirty = false;
			discardOpen = false;
		}
	});
	function requestClose() {
		if (guard.saving) return;
		if (guard.dirty) discardOpen = true;
		else open = false;
	}
</script>

<Dialog.Root
	onOpenChangeComplete={(next) => {
		if (!next) onclosed?.();
	}}
	bind:open={
		() => open,
		(next) => {
			if (next) open = true;
			else requestClose();
		}
	}
>
	{@render children(requestClose)}
	<DiscardChangesDialog
		bind:open={discardOpen}
		ondiscard={() => {
			guard.dirty = false;
			open = false;
		}}
	/>
	<UnsavedGuard {guard} />
</Dialog.Root>
