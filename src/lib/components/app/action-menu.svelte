<script lang="ts" module>
	import type { Component } from 'svelte';

	export type MenuItem = {
		label: string;
		icon?: Component<{ class?: string }>;
		onselect?: () => void;
		href?: string;
		destructive?: boolean;
		/** Draws a divider above the item. */
		separated?: boolean;
	};
</script>

<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { goto } from '$app/navigation';
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import { Button } from '$lib/components/ui/button/index.js';

	/** Overflow menu for secondary actions. Destructive items are tinted and sit last. */
	let { label, items }: { label: string; items: MenuItem[] } = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="icon" aria-label={label} title={label}
				><EllipsisVertical aria-hidden="true" /></Button
			>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Portal>
		<DropdownMenu.Content align="end" sideOffset={4} class="action-menu">
			{#each items as item (item.label)}
				{#if item.separated}<DropdownMenu.Separator class="my-1 h-px bg-border" />{/if}
				<DropdownMenu.Item
					class="action-menu-item"
					data-variant={item.destructive ? 'destructive' : undefined}
					onSelect={() => (item.href ? goto(item.href) : item.onselect?.())}
				>
					{#if item.icon}<item.icon />{/if}{item.label}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Portal>
</DropdownMenu.Root>
