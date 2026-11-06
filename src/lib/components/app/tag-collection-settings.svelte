<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { untrack } from 'svelte';
	import type { Tag, TagPage, TagCollection } from '$lib/tag-types';
	import { tagRequest } from '$lib/tag-client';
	import TagEditorDialog from './tag-editor-dialog.svelte';
	import TagChip from './tag-chip.svelte';
	import TagSearch from './tag-search.svelte';
	import Notice from './notice.svelte';
	import RowActions from './row-actions.svelte';
	import Pagination from './pagination.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	let { collection, initial }: { collection: TagCollection; initial: TagPage } = $props();
	let listing = $state(untrack(() => initial)),
		query = $state(''),
		message = $state(''),
		loading = $state(false),
		editor = $state<'create' | 'edit' | 'merge' | null>(null),
		current = $state<Tag | undefined>(),
		// The unfiltered tag count: search appears once the list is long enough to need it.
		tagTotal = $state(untrack(() => initial.total));
	const showSearch = $derived(query !== '' || listing.invalid_query || tagTotal >= 12);
	let requestSequence = 0;
	async function search(page = 1) {
		const sequence = ++requestSequence;
		loading = true;
		message = '';
		try {
			const result = await tagRequest('list', { collection, query, page });
			if (sequence === requestSequence) {
				listing = result;
				if (!query) tagTotal = result.total;
			}
		} catch (error) {
			if (sequence === requestSequence)
				message = error instanceof Error ? error.message : 'Tags could not be loaded.';
		} finally {
			if (sequence === requestSequence) loading = false;
		}
	}
</script>

<div
	class="min-w-0 space-y-4"
	role="group"
	aria-label={collection === 'job' ? 'Job tags' : 'People tags'}
>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h3 class="font-semibold">{collection === 'job' ? 'Job tags' : 'People tags'}</h3>
		<div class="flex flex-wrap gap-2">
			<Button
				variant="outline"
				onclick={() => {
					current = undefined;
					editor = 'create';
				}}><Plus data-icon="inline-start" aria-hidden="true" />Create tag</Button
			><Button
				variant="outline"
				disabled={tagTotal < 2}
				onclick={() => {
					current = undefined;
					editor = 'merge';
				}}>Merge tags</Button
			>
		</div>
	</div>
	{#if showSearch}<TagSearch
			id={`settings-${collection}-search`}
			label={`Search ${collection === 'job' ? 'job' : 'people'} tags`}
			bind:query
			{loading}
			invalid={listing.invalid_query}
			onsearch={() => search()}
		/>{/if}
	{#if message}<Notice tone="error" title="Tags unavailable">{message}</Notice>{/if}
	<ul class="divide-y">
		{#each listing.tags as tag (tag.id)}<li
				class="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"
			>
				<div class="min-w-0 space-y-1">
					<TagChip {tag} />
					<p class="text-sm text-muted-foreground">
						{tag.usage_count ?? 0}
						{(tag.usage_count ?? 0) === 1
							? collection === 'job'
								? 'job'
								: 'person'
							: collection === 'job'
								? 'jobs'
								: 'people'}
					</p>
				</div>
				<RowActions
					label={tag.display_name}
					onEdit={() => {
						current = tag;
						editor = 'edit';
					}}
				/>
			</li>{:else}<li class="py-3 text-sm text-muted-foreground">
				No tags found. Create one here or while editing a record.
			</li>{/each}
	</ul>
	<Pagination
		page={listing.page}
		totalPages={listing.totalPages}
		label={`${collection} tags`}
		previous={listing.page > 1 ? () => search(listing.page - 1) : null}
		next={listing.page < listing.totalPages ? () => search(listing.page + 1) : null}
	/>
	{#if editor}<TagEditorDialog
			{collection}
			initial={{ ...listing, selectedTags: [] }}
			mode={editor}
			tag={current}
			onclose={() => (editor = null)}
			onsaved={() => search(listing.page)}
		/>{/if}
</div>
