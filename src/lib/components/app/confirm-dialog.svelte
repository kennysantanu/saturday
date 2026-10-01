<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	/**
	 * Confirmation for an action that is hard to undo. The confirm button submits the form named
	 * by `formId`, so the dialog can sit outside the form. The page closes it after the submit.
	 */
	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel,
		formId,
		destructive = false,
		children
	}: {
		open?: boolean;
		title: string;
		description: string;
		confirmLabel: string;
		formId: string;
		destructive?: boolean;
		children?: Snippet;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		{@render children?.()}
		<Dialog.Footer>
			<Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" form={formId} variant={destructive ? 'destructive' : 'default'}
				>{confirmLabel}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
