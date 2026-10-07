<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils.js';

	/** A labelled native checkbox. Pass `bind:group` for a set of choices or `bind:checked` for one. */
	let {
		label,
		value,
		group = $bindable(),
		checked = $bindable(false),
		class: className,
		...restProps
	}: Omit<HTMLInputAttributes, 'type' | 'group' | 'checked' | 'value'> & {
		label: string;
		value?: string;
		group?: string[];
		checked?: boolean;
	} = $props();
</script>

<label class={cn('check-field', className)}>
	{#if group !== undefined}
		<input type="checkbox" {value} bind:group {...restProps} />
	{:else}
		<input type="checkbox" {value} bind:checked {...restProps} />
	{/if}
	<span>{label}</span>
</label>
