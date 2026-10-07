<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';

	/**
	 * A GET search or filter form in a card, with Clear then Apply (primary last). `before` sits
	 * above the card, such as an error notice; `more` sits between the card and the buttons.
	 */
	let {
		label,
		action,
		clearHref,
		applyLabel = 'Apply filters',
		clearLabel = 'Clear filters',
		showClear = true,
		before,
		more,
		children
	}: {
		label: string;
		action: string;
		clearHref: string;
		applyLabel?: string;
		clearLabel?: string;
		showClear?: boolean;
		before?: Snippet;
		more?: Snippet;
		children: Snippet;
	} = $props();
</script>

<form method="GET" {action} class="space-y-4" aria-label={label}>
	{@render before?.()}
	<Card.Root>
		<Card.Content class="space-y-5 py-2">{@render children()}</Card.Content>
	</Card.Root>
	{@render more?.()}
	<div class="form-actions">
		{#if showClear}<Button href={clearHref} variant="ghost">{clearLabel}</Button>{/if}
		<Button type="submit" variant="outline">{applyLabel}</Button>
	</div>
</form>
