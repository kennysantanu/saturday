<script lang="ts">
	import DocumentList from '$lib/components/app/document-list.svelte';
	let { data, form } = $props();
</script>

<DocumentList {data} {form} />
