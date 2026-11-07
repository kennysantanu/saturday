<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	/**
	 * Confirmation for an action that is hard to undo. The confirm button submits the form named
	 * by `formId`, so the dialog can sit outside the form. The page closes it after the submit.
	 * While that form is being sent (`withPending` marks it `aria-busy`) the dialog locks itself:
	 * Cancel, Escape, the backdrop and a second confirm are all ignored, so `pending` is only
	 * needed for work the form does not cover.
	 *
	 * `destructive` is for actions that delete data, replace data, or remove protection.
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
	let sending = $state(false);
	$effect(() => {
		const form = open ? document.getElementById(formId) : null;
		if (!form) {
			sending = false;
			return;
		}
		const read = () => (sending = form.getAttribute('aria-busy') === 'true');
		read();
		const observer = new MutationObserver(read);
		observer.observe(form, { attributes: true, attributeFilter: ['aria-busy'] });
		return () => observer.disconnect();
	});
	const locked = $derived(pending || sending);
</script>

<Dialog.Root
	bind:open={
		() => open,
		(next) => {
			if (!locked) open = next;
		}
	}
>
	<Dialog.Content
		class="sm:max-w-md"
		aria-busy={locked}
		showCloseButton={!locked}
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
			if (locked) event.preventDefault();
		}}
		onInteractOutside={(event) => {
			if (locked) event.preventDefault();
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
				disabled={locked}
				onclick={() => (open = false)}>Cancel</Button
			>
			<Button
				type="submit"
				form={formId}
				formaction={formAction}
				formnovalidate={formNoValidate}
				disabled={locked || disabled}
				variant={destructive ? 'destructive' : 'default'}>{confirmLabel}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
