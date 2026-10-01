<script lang="ts">
	import Compass from '@lucide/svelte/icons/compass';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import EmptyState from '$lib/components/app/empty-state.svelte';

	const notFound = $derived(page.status === 404);
</script>

<svelte:head><title>{page.status} · Saturday</title></svelte:head>

<EmptyState
	title={notFound ? 'We couldn’t find that page' : 'Something went wrong'}
	description={notFound
		? 'The link may be out of date, or the job may no longer exist. Head back to your dashboard or jobs.'
		: 'Saturday ran into a problem. Try again, or go back to the Dashboard.'}
>
	{#snippet icon()}
		{#if notFound}<Compass class="size-5" />{:else}<TriangleAlert class="size-5" />{/if}
	{/snippet}
	{#snippet actions()}
		<Button href="/">Go to Dashboard</Button>
		<Button href="/jobs" variant="outline">View jobs</Button>
		{#if !notFound}
			<Button variant="ghost" onclick={() => window.location.reload()}>Try again</Button>
		{/if}
	{/snippet}
</EmptyState>
