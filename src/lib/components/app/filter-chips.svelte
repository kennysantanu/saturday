<script lang="ts">
	import { tagTextColor, tagColorPattern } from '$lib/tags.js';
	import X from '@lucide/svelte/icons/x';

	/** Removable chips for the filters in effect. Each chip links to the list without that filter. */
	let { chips }: { chips: { key: string; label: string; href: string; color?: string }[] } =
		$props();
</script>

{#if chips.length}
	<div role="group" class="flex flex-wrap gap-2" aria-label="Applied filters">
		{#each chips as chip (chip.key)}
			<div
				class="filter-chip"
				class:colored-tag={!!chip.color}
				style:background-color={chip.color && tagColorPattern.test(chip.color)
					? chip.color
					: undefined}
				style:color={chip.color && tagColorPattern.test(chip.color)
					? tagTextColor(chip.color)
					: undefined}
			>
				<span>{chip.label}</span><a
					href={chip.href}
					aria-label={`Remove ${chip.label}`}
					title={`Remove ${chip.label}`}
					class="hover:bg-foreground/10"><X class="size-4" aria-hidden="true" /></a
				>
			</div>
		{/each}
	</div>
{/if}

<style>
	.colored-tag {
		min-height: 44px;
		max-width: 100%;
		padding-block: 0;
	}
	.colored-tag a {
		min-width: 44px;
		min-height: 44px;
	}
	.colored-tag span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	@media (forced-colors: active) {
		.colored-tag {
			background: Canvas !important;
			color: CanvasText !important;
			border: 1px solid CanvasText;
		}
	}
</style>
