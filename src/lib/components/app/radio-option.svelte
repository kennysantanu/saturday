<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	/** One choice in a list of radio options, drawn as a solid selectable row. */
	let {
		label,
		description,
		...restProps
	}: Omit<HTMLInputAttributes, 'type'> & { label: string; description?: string } = $props();
</script>

<label class="radio-option">
	<input type="radio" class="mt-1 size-4 shrink-0 accent-primary" {...restProps} />
	<span class="min-w-0 text-sm break-words"
		>{label}{#if description}<span class="block text-muted-foreground">{description}</span
			>{/if}</span
	>
</label>
