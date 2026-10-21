<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { UnsavedChanges } from '$lib/unsaved.svelte';
	import UnsavedGuard from './unsaved-guard.svelte';

	/** Guards a short form's Cancel, Close, Escape, backdrop and page navigation. */
	let {
		open = $bindable(false),
		guard,
		children
	}: {
		open?: boolean;
		guard: UnsavedChanges;
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
	bind:open={
		() => open,
		(next) => {
			if (next) open = true;
			else requestClose();
		}
	}
>
	{@render children(requestClose)}
	<Dialog.Root bind:open={discardOpen}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Discard unsaved changes?</Dialog.Title>
				<Dialog.Description>Your latest edits have not been saved.</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="ghost" onclick={() => (discardOpen = false)}>Keep editing</Button>
				<Button
					variant="destructive"
					onclick={() => {
						guard.dirty = false;
						discardOpen = false;
						open = false;
					}}>Discard changes</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
	<UnsavedGuard {guard} />
</Dialog.Root>
