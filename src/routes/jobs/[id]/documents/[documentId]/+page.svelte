<script lang="ts">
	import DocumentEditor from '$lib/components/app/document-editor.svelte';
	let { data, form } = $props();
</script>

<DocumentEditor {data} {form} />
