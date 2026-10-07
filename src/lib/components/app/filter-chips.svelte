<script lang="ts">
	import X from '@lucide/svelte/icons/x';

	/** Removable chips for the filters in effect. Each chip links to the list without that filter. */
	let { chips }: { chips: { key: string; label: string; href: string }[] } = $props();
</script>

{#if chips.length}
	<div role="group" class="flex flex-wrap gap-2" aria-label="Applied filters">
		{#each chips as chip (chip.key)}
			<div class="filter-chip">
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
