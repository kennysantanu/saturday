<script lang="ts">
	import { getContext } from 'svelte';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { filterBarKey, type FilterBarContext } from './filter-bar-context';

	/**
	 * The button that opens a FilterBar's advanced panel. Put it last in the primary row (inside
	 * `.filter-row-toggle`) so tab order matches the visual order: it spans its own row on a phone,
	 * sits beside the selects on a tablet and ends the row on a desktop. Without scripts it is
	 * hidden and the panel is always shown.
	 */
	const bar = getContext<FilterBarContext>(filterBarKey);
</script>

<button
	type="button"
	class="filter-toggle"
	aria-expanded={bar.open}
	aria-controls={bar.panelId}
	onclick={bar.toggle}
>
	<SlidersHorizontal class="size-4" aria-hidden="true" /><span>{bar.label}</span
	>{#if bar.count}<span class="filter-badge">{bar.count}<span class="sr-only"> applied</span></span
		>{/if}<ChevronDown class="filter-toggle-chevron size-4" aria-hidden="true" />
</button>
