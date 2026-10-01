<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Label } from '$lib/components/ui/label/index.js';

	/**
	 * Standard form field: label, optional hint, control, and a field-specific error.
	 * The control snippet receives ids/aria attributes so every field is accessible the same way.
	 */
	let {
		id,
		label,
		required = false,
		hint,
		error,
		control
	}: {
		id: string;
		label: string;
		required?: boolean;
		hint?: string;
		error?: string;
		control: Snippet<
			[
				{
					id: string;
					'aria-invalid': boolean;
					'aria-required': boolean;
					'aria-describedby': string | undefined;
				}
			]
		>;
	} = $props();

	const hintId = $derived(hint ? `${id}-hint` : undefined);
	const errorId = $derived(error ? `${id}-error` : undefined);
	const describedBy = $derived([hintId, errorId].filter(Boolean).join(' ') || undefined);
</script>

<div class="space-y-2">
	<Label for={id} class="text-sm font-medium">
		{label}
		{#if required}<span class="text-destructive" aria-hidden="true">*</span>{/if}
	</Label>
	{@render control({
		id,
		'aria-required': required,
		'aria-invalid': Boolean(error),
		'aria-describedby': describedBy
	})}
	{#if hint}
		<p id={hintId} class="text-sm text-muted-foreground">{hint}</p>
	{/if}
	{#if error}
		<p id={errorId} class="text-sm text-destructive">{error}</p>
	{/if}
</div>
