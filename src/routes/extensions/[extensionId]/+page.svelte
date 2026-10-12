<script lang="ts">
	import { extensionRegistry } from '$lib/extensions.generated.js';
	import Notice from '$lib/components/app/notice.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import { Button } from '$lib/components/ui/button';
	let { data, form } = $props();
	const component = $derived(
		(
			extensionRegistry as Record<
				string,
				(typeof extensionRegistry)[keyof typeof extensionRegistry]
			>
		)[data.extensionId]?.page()
	);
</script>

<svelte:boundary>
	{#await component}<PageShell title="Extension"><p role="status">Loading extension…</p></PageShell
		>{:then mod}{#if mod}<mod.default {data} {form} />{/if}{:catch}<PageShell
			title="Extension unavailable"
			><Notice tone="error" title="Extension could not be loaded"
				>Return to Extensions to check its installation.</Notice
			><Button href="/extensions">Back to Extensions</Button></PageShell
		>{/await}
	{#snippet failed()}<PageShell title="Extension unavailable"
			><Notice tone="error" title="Extension could not be displayed"
				>Core Saturday pages remain available.</Notice
			><Button href="/extensions">Back to Extensions</Button></PageShell
		>{/snippet}
</svelte:boundary>
