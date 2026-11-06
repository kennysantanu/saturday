<script lang="ts">
	import SearchField from './search-field.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	/**
	 * Tag search used by the tag picker and Settings tag lists: a labelled search field, Search tags
	 * button and invalid-query hint. Enter searches without submitting any surrounding form.
	 */
	let {
		id,
		label,
		query = $bindable(''),
		loading = false,
		disabled = false,
		invalid = false,
		onsearch
	}: {
		id: string;
		label: string;
		query?: string;
		loading?: boolean;
		disabled?: boolean;
		invalid?: boolean;
		onsearch: () => void;
	} = $props();
</script>

<div class="flex items-end gap-2">
	<div class="min-w-0 flex-1">
		<SearchField {id} {label} bind:value={query} maxlength={200} onenter={onsearch} />
	</div>
	<Button type="button" variant="outline" disabled={loading || disabled} onclick={onsearch}
		>{loading ? 'Searching…' : 'Search tags'}</Button
	>
</div>
{#if invalid}<p class="text-sm text-muted-foreground">
		Search using letters, numbers, spaces or underscores.
	</p>{/if}
