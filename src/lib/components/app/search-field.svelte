<script lang="ts">
	import Field from './field.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';

	/**
	 * Labelled search input with a leading Search icon and a clear control. The clear control only
	 * appears once JavaScript runs, so the plain GET form still works without it. Pass
	 * `name` so the value submits with the surrounding form.
	 */
	let {
		id,
		label,
		name = 'query',
		value = $bindable(''),
		hint,
		error,
		placeholder,
		maxlength,
		disabled = false,
		onenter,
		instant = false
	}: {
		id: string;
		label: string;
		name?: string;
		value?: string;
		hint?: string;
		error?: string;
		placeholder?: string;
		maxlength?: number;
		disabled?: boolean;
		/** Called on Enter instead of submitting the surrounding form (for nested searches). */
		onenter?: () => void;
		/** Mark as an instant-apply control for a surrounding FilterBar. Search never is by default. */
		instant?: boolean;
	} = $props();

	let ready = $state(false);
	let input = $state<HTMLInputElement | null>(null);
	$effect(() => {
		ready = true;
	});

	function clear() {
		value = '';
		input?.focus();
	}
</script>

<Field {id} {label} {hint} {error}>
	{#snippet control(attrs)}
		<div class="search-wrap relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				{...attrs}
				{name}
				{placeholder}
				{maxlength}
				{disabled}
				onkeydown={(event) => {
					if (onenter && event.key === 'Enter') {
						event.preventDefault();
						onenter();
					}
				}}
				type="search"
				bind:value
				bind:ref={input}
				class="pl-9 {ready && value ? 'pr-11' : ''}"
				data-instant={instant ? '' : undefined}
			/>
			{#if ready && value && !disabled}
				<button
					type="button"
					class="search-clear"
					aria-label={`Clear ${label.toLowerCase()}`}
					title={`Clear ${label.toLowerCase()}`}
					onclick={clear}><X class="size-4" aria-hidden="true" /></button
				>
			{/if}
		</div>
	{/snippet}
</Field>

<style>
	/* Our clear control replaces the browser's own. */
	.search-wrap :global(input::-webkit-search-cancel-button) {
		display: none;
	}
	.search-clear {
		position: absolute;
		top: 50%;
		right: 2px;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		transform: translateY(-50%);
		border-radius: var(--r-control);
		color: var(--muted-foreground);
	}
	@media (hover: hover) {
		.search-clear:hover {
			color: var(--foreground);
			background: var(--accent);
		}
	}
</style>
