<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import ActionMenu, { type MenuItem } from './action-menu.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	/**
	 * The actions for one list item: a visible Edit with an icon and label, and an overflow menu
	 * for the rest. `label` names the item for assistive technology, for example "web-cv.md".
	 */
	let {
		label,
		editHref,
		onEdit,
		menu = []
	}: { label: string; editHref?: string; onEdit?: () => void; menu?: MenuItem[] } = $props();
</script>

<div class="flex items-center gap-1">
	{#if editHref || onEdit}
		<Button variant="ghost" size="sm" href={editHref} onclick={onEdit} aria-label={`Edit ${label}`}
			><Pencil data-icon="inline-start" />Edit</Button
		>
	{/if}
	{#if menu.length}<ActionMenu label={`More actions for ${label}`} items={menu} />{/if}
</div>
