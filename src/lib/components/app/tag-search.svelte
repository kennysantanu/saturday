<script lang="ts">
	import { untrack } from 'svelte';
	import SearchField from './search-field.svelte';

	/**
	 * Tag search used by the tag picker and Settings tag lists: a labelled search field and an
	 * invalid-query hint. Results load as you type (after a short pause) or on Enter, which never
	 * submits a surrounding form.
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

	let searched = untrack(() => query);
	$effect(() => {
		const value = query;
		if (value === searched) return;
		const timer = setTimeout(() => {
			searched = value;
			onsearch();
		}, 300);
		return () => clearTimeout(timer);
	});
	function now() {
		searched = query;
		onsearch();
	}
</script>

<SearchField {id} {label} bind:value={query} maxlength={200} {disabled} onenter={now} />
<p class="sr-only" role="status">{loading ? 'Searching tags' : ''}</p>
{#if invalid}<p class="text-sm text-muted-foreground">
		Search using letters, numbers, spaces or underscores.
	</p>{/if}
