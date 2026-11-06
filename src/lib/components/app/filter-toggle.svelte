<script lang="ts">
	import { getContext } from 'svelte';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { filterBarKey, type FilterBarContext } from './filter-bar-context';

	/**
	 * The button that opens a FilterBar's advanced panel. Place it inside the primary row (as the
	 * last cell) so it shares a line with the controls. Below 40rem it shrinks to an icon with a
	 * count badge; the label stays available to assistive technology. Without scripts it is hidden
	 * and the panel is always shown.
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
	<SlidersHorizontal class="size-4" aria-hidden="true" /><span class="max-sm:sr-only"
		>{bar.label}</span
	>{#if bar.count}<span class="filter-badge">{bar.count}<span class="sr-only"> applied</span></span
		>{/if}<ChevronDown class="filter-toggle-chevron size-4 max-sm:hidden" aria-hidden="true" />
</button>
