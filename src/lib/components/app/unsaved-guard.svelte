<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import DiscardChangesDialog from './discard-changes-dialog.svelte';
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

<DiscardChangesDialog
	bind:open
	ondiscard={() => {
		guard.dirty = false;
		void goto(target);
	}}
/>
