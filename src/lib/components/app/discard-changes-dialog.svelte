<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	let { open = $bindable(false), ondiscard }: { open?: boolean; ondiscard: () => void } = $props();
</script>

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
					open = false;
					ondiscard();
				}}>Discard changes</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
