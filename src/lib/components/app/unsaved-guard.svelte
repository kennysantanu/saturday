<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import type { UnsavedChanges } from '$lib/unsaved.svelte';

	/** Asks before leaving a page with unsaved edits. Place once on the page. */
	let { guard }: { guard: Pick<UnsavedChanges, 'dirty' | 'saving'> } = $props();
	let open = $state(false);
	let target = $state('');

	beforeNavigate((navigation) => {
		if (!guard.dirty || guard.saving) return;
		navigation.cancel();
		if (navigation.to && !navigation.willUnload) {
			target = navigation.to.url.href;
			open = true;
		}
	});

	function unload(event: BeforeUnloadEvent) {
		if (guard.dirty && !guard.saving) {
			event.preventDefault();
			event.returnValue = '';
		}
	}
</script>

<svelte:window onbeforeunload={unload} />

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Discard unsaved changes?</Dialog.Title>
			<Dialog.Description>Your latest edits have not been saved.</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (open = false)}>Keep editing</Button>
			<Button
				variant="destructive"
				onclick={() => {
					guard.dirty = false;
					open = false;
					void goto(target);
				}}>Discard changes</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
