<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { Popover } from 'bits-ui';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Clock from '@lucide/svelte/icons/clock';
	import { jobDetailUrl } from '$lib/job-navigation.js';
	import { networkDetailUrl } from '$lib/network-navigation.js';
	import { waitForRecentViews } from '$lib/recents';

	type Item = { id: number; title: string; subtitle: string | null };
	let { enabled, kind }: { enabled: boolean; kind: 'jobs' | 'people' } = $props();
	const title = $derived(kind === 'jobs' ? 'Recent jobs' : 'Recent people');
	let open = $state(false);
	let mobile = $state(false);
	let loading = $state(false);
	let error = $state('');
	let items = $state<Item[]>([]);
	let request = 0;

	onMount(() => {
		const media = window.matchMedia('(width < 48rem)');
		const update = () => {
			mobile = media.matches;
			open = false;
		};
		update();
		media.addEventListener('change', update);
		return () => {
			request++;
			media.removeEventListener('change', update);
		};
	});
	afterNavigate(() => {
		open = false;
	});
	$effect(() => {
		if (!enabled) open = false;
	});

	async function load() {
		const current = ++request;
		loading = true;
		error = '';
		items = [];
		try {
			await waitForRecentViews();
			const response = await fetch('/api/recents', {
				cache: 'no-store',
				signal: AbortSignal.timeout(8000)
			});
			const data = await response.json();
			if (!response.ok)
				throw new Error(
					response.status === 401
						? 'Sign in again to see recently viewed.'
						: 'Recently viewed is unavailable. Try again.'
				);
			if (current !== request) return;
			if (!data.settings.enabled) {
				open = false;
				return;
			}
			items = data[kind];
		} catch (e) {
			if (current === request)
				error = e instanceof Error ? e.message : 'Recently viewed is unavailable.';
		} finally {
			if (current === request) loading = false;
		}
	}
	function changed(next: boolean) {
		if (next) {
			void load();
		}
	}
</script>

{#snippet triggerContent()}
	<Clock class="size-5" aria-hidden="true" /><span class="recent-trigger-label">Recent</span>
{/snippet}

{#snippet panel()}
	<div class="recent-results" aria-busy={loading}>
		{#if loading}
			<p role="status" class="recent-message">Loading recently viewed…</p>
		{:else if error}
			<div class="recent-message space-y-3">
				<p role="alert">{error}</p>
				<Button variant="outline" onclick={load}>Try again</Button>
			</div>
		{:else if items.length === 0}
			<p class="recent-message">
				No recently viewed {kind} yet. Open a {kind === 'jobs' ? 'job' : 'person'} to find it here.
			</p>
		{:else}
			<ul class="recent-list">
				{#each items as item (item.id)}
					<li>
						<a
							href={kind === 'jobs'
								? jobDetailUrl(item.id, page.url.pathname + page.url.search)
								: networkDetailUrl(item.id, page.url.pathname + page.url.search)}
							onclick={() => (open = false)}
							class="recent-record"
						>
							<span class="font-medium break-words">{item.title}</span>
							{#if item.subtitle}<span class="text-sm break-words text-muted-foreground"
									>{item.subtitle}</span
								>{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	<a class="recent-settings link" href="/settings#navigation" onclick={() => (open = false)}
		>Recently viewed settings</a
	>
{/snippet}

{#if enabled}
	{#if mobile}
		<Dialog.Root bind:open onOpenChange={changed}>
			<Dialog.Trigger>
				{#snippet child({ props })}<Button
						{...props}
						variant="outline"
						size="lg"
						class="recent-trigger"
						aria-label={title}>{@render triggerContent()}</Button
					>{/snippet}
			</Dialog.Trigger>
			<Dialog.Content class="recent-sheet">
				<Dialog.Header
					><Dialog.Title>{title}</Dialog.Title><Dialog.Description
						>Return to {kind} you opened recently.</Dialog.Description
					></Dialog.Header
				>
				{@render panel()}
			</Dialog.Content>
		</Dialog.Root>
	{:else}
		<Popover.Root bind:open onOpenChange={changed}>
			<Popover.Trigger>
				{#snippet child({ props })}<Button
						{...props}
						variant="outline"
						size="lg"
						class="recent-trigger"
						aria-label={title}>{@render triggerContent()}</Button
					>{/snippet}
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Content
					side="bottom"
					align="end"
					sideOffset={12}
					collisionPadding={16}
					class="recent-popover"
					aria-label={title}
				>
					<h2 class="mb-3 text-base font-medium">{title}</h2>
					{@render panel()}
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	{/if}
{/if}
