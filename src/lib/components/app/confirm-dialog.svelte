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
		formAction,
		formNoValidate = false,
		destructive = false,
		pending = false,
		disabled = false,
		focusCancel = false,
		returnFocus,
		children
	}: {
		open?: boolean;
		title: string;
		description: string;
		confirmLabel: string;
		formId: string;
		formAction?: string;
		formNoValidate?: boolean;
		destructive?: boolean;
		pending?: boolean;
		disabled?: boolean;
		focusCancel?: boolean;
		returnFocus?: () => void;
		children?: Snippet;
	} = $props();
	let cancelButton = $state<HTMLButtonElement | null>(null);
</script>

<Dialog.Root
	bind:open={
		() => open,
		(next) => {
			if (!pending) open = next;
		}
	}
>
	<Dialog.Content
		class="sm:max-w-md"
		aria-busy={pending}
		showCloseButton={!pending}
		onOpenAutoFocus={(event) => {
			if (focusCancel) {
				event.preventDefault();
				cancelButton?.focus();
			}
		}}
		onCloseAutoFocus={(event) => {
			if (returnFocus) {
				event.preventDefault();
				returnFocus();
			}
		}}
		onEscapeKeydown={(event) => {
			if (pending) event.preventDefault();
		}}
		onInteractOutside={(event) => {
			if (pending) event.preventDefault();
		}}
	>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		{@render children?.()}
		<Dialog.Footer>
			<Button
				bind:ref={cancelButton}
				type="button"
				variant="ghost"
				disabled={pending}
				onclick={() => (open = false)}>Cancel</Button
			>
			<Button
				type="submit"
				form={formId}
				formaction={formAction}
				formnovalidate={formNoValidate}
				disabled={pending || disabled}
				variant={destructive ? 'destructive' : 'default'}>{confirmLabel}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
