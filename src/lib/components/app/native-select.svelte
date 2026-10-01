<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { cn } from '$lib/utils.js';

	/**
	 * A native select with Saturday's control styling. The native menu is kept on purpose: it
	 * is the best experience on touch devices and is accessible by default.
	 */
	let {
		value = $bindable(),
		children,
		class: className,
		...restProps
	}: HTMLSelectAttributes & { children?: Snippet } = $props();
</script>

<div class="native-select-wrap">
	<select bind:value class={cn('native-select', className)} {...restProps}>
		{@render children?.()}
	</select>
	<ChevronDown class="size-4" aria-hidden="true" />
</div>
