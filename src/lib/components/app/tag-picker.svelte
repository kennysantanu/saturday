<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { tick, untrack, onMount } from 'svelte';
	import type { Tag, TagPickerData, TagCollection } from '$lib/tag-types';
	import { tagRequest, TagRequestError } from '$lib/tag-client';
	import { tagTextColor, validTagSelection } from '$lib/tags.js';
	import TagSearch from './tag-search.svelte';
	import Checkbox from './checkbox.svelte';
	import TagChip from './tag-chip.svelte';
	import TagDefinitionFields from './tag-definition-fields.svelte';
	import Pagination from './pagination.svelte';
	import Notice from './notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { focusFirstError } from '$lib/forms';
	let {
		collection,
		initial,
		selected = $bindable<string[]>([]),
		label = 'Tags',
		allowCreate = true,
		marker = true,
		fieldName = 'tag_ids',
		single = false,
		error,
		excludeIds = [],
		onselection,
		refreshToken = 0
	}: {
		collection: TagCollection;
		initial: TagPickerData;
		selected?: string[];
		label?: string;
		allowCreate?: boolean;
		marker?: boolean;
		fieldName?: string;
		single?: boolean;
		error?: string;
		excludeIds?: string[];
		onselection?: (tags: Tag[]) => void;
		refreshToken?: number;
	} = $props();
	const uid = $props.id();
	let root: HTMLDivElement;
	let query = $state(''),
		listing = $state(untrack(() => initial)),
		cache = $state<Tag[]>(untrack(() => [...initial.tags, ...initial.selectedTags])),
		loading = $state(false),
		creating = $state(false),
		createOpen = $state(false),
		name = $state(''),
		color = $state('#64748b'),
		errors = $state<Record<string, string>>({}),
		message = $state(''),
		existing = $state<Tag | null>(null),
		announcement = $state('');
	let hydrated = $state(false);
	let requestSequence = 0;
	let searched = $state(false);
	const chosen = $derived(
		validTagSelection(selected)
			.map(
				(id) =>
					cache.find((t) => String(t.id) === id) ?? {
						id: Number(id),
						name: '',
						display_name: `Unavailable tag #${id}`,
						color: '#64748b',
						unavailable: true
					}
			)
			.sort((a, b) => a.display_name.localeCompare(b.display_name) || a.id - b.id)
	);
	const options = $derived(
		[
			...chosen,
			...(single && !searched ? [] : listing.tags).filter(
				(t) => !selected.includes(String(t.id)) && !excludeIds.includes(String(t.id))
			)
		].sort(
			(a, b) =>
				Number(selected.includes(String(b.id))) - Number(selected.includes(String(a.id))) ||
				a.display_name.localeCompare(b.display_name) ||
				a.id - b.id
		)
	);
	$effect(() => {
		const tags = chosen;
		untrack(() => onselection?.(tags));
	});
	$effect(() => {
		const snapshot = initial;
		untrack(() => {
			listing = snapshot;
			remember([...snapshot.tags, ...snapshot.selectedTags]);
		});
	});
	$effect(() => {
		if (refreshToken > 0)
			untrack(() => {
				void search();
			});
	});
	function remember(tags: Tag[]) {
		const map = new Map(cache.map((t) => [t.id, t]));
		for (const tag of tags) map.set(tag.id, tag);
		cache = [...map.values()];
	}
	function dirty() {
		root?.dispatchEvent(new Event('input', { bubbles: true }));
	}
	async function search(page = 1) {
		const sequence = ++requestSequence;
		searched = true;
		loading = true;
		message = '';
		try {
			const result = await tagRequest('list', { collection, query, page, selected });
			if (sequence !== requestSequence) return;
			listing = result;
			remember([...result.tags, ...result.selectedTags]);
		} catch (error) {
			if (sequence === requestSequence)
				message = error instanceof Error ? error.message : 'Tags could not be loaded.';
		} finally {
			if (sequence === requestSequence) loading = false;
		}
	}
	async function remove(id: string) {
		const at = chosen.findIndex((tag) => String(tag.id) === id);
		selected = selected.filter((value) => value !== id);
		announcement = 'Tag removed from selection.';
		dirty();
		await tick();
		const targets = root.querySelectorAll<HTMLButtonElement>('[data-tag-remove] button');
		(
			targets[Math.min(at, targets.length - 1)] ??
			root.querySelector<HTMLInputElement>('input[type="search"]')
		)?.focus();
	}
	async function choose(id: string, checked: boolean) {
		selected = single
			? checked
				? [id]
				: []
			: checked
				? [...new Set([...selected, id])]
				: selected.filter((value) => value !== id);
		dirty();
		await tick();
		root.querySelector<HTMLInputElement>(`[data-choice="${id}"] input`)?.focus();
	}
	async function create() {
		const form = root.closest('form');
		const parentButtons = [
			...(form?.querySelectorAll<HTMLButtonElement>('button[type="submit"]') ?? [])
		].map((button) => ({ button, disabled: button.disabled }));
		for (const item of parentButtons) item.button.disabled = true;
		form?.setAttribute('aria-busy', 'true');
		creating = true;
		errors = {};
		message = '';
		existing = null;
		try {
			const tag = await tagRequest('create', { collection, name, color });
			remember([tag]);
			selected = single ? [String(tag.id)] : [...new Set([...selected, String(tag.id)])];
			createOpen = false;
			name = '';
			announcement = 'Tag created and selected. Save to assign it.';
			dirty();
			await search();
		} catch (error) {
			if (error instanceof TagRequestError) {
				errors = error.errors;
				existing = error.existingTag ?? null;
			}
			message = error instanceof Error ? error.message : 'Tag could not be created.';
			await tick();
			focusFirstError();
		} finally {
			creating = false;
			for (const item of parentButtons) item.button.disabled = item.disabled;
			form?.removeAttribute('aria-busy');
		}
	}
	onMount(() => {
		hydrated = true;
		// A separate inline request must never submit or reset the surrounding editor.
		const form = root.closest('form');
		const protect = (event: SubmitEvent) => {
			if (creating) event.preventDefault();
		};
		form?.addEventListener('submit', protect, true);
		return () => {
			requestSequence++;
			form?.removeEventListener('submit', protect, true);
		};
	});
</script>

<div bind:this={root} class="space-y-3" role="group" aria-label={label}>
	<p class="text-sm font-medium">{label}</p>
	{#if marker}<input type="hidden" name="tags_present" value="1" />{/if}
	{#if hydrated}{#each selected as id (id)}<input
				type="hidden"
				name={fieldName}
				value={id}
			/>{/each}{:else}{#each chosen.filter((tag) => tag.unavailable) as tag (tag.id)}<input
				type="hidden"
				name={fieldName}
				value={tag.id}
			/>{/each}{/if}
	{#if error}<p class="text-sm text-destructive" role="alert" tabindex="-1">{error}</p>{/if}
	{#if chosen.length}<div class="flex flex-wrap gap-2" aria-label="Selected tags">
			{#each chosen as tag (tag.id)}<span data-tag-remove
					><TagChip {tag} onremove={() => remove(String(tag.id))} /></span
				>{/each}
		</div>{/if}
	<TagSearch
		id={`${uid}-search`}
		label={`Search ${label.toLowerCase()}`}
		bind:query
		{loading}
		disabled={creating}
		invalid={listing.invalid_query}
		onsearch={() => search()}
	/>
	{#if message}<Notice tone="error" title="Tags need attention">{message}</Notice>{/if}
	<div class="flex flex-wrap gap-2" aria-busy={loading}>
		{#each options as tag (tag.id)}
			<div
				data-choice={tag.id}
				class="tag-choice"
				style:background-color={tag.color}
				style:color={tagTextColor(tag.color)}
			>
				<Checkbox
					name={hydrated ? undefined : fieldName}
					value={String(tag.id)}
					class="min-h-11 min-w-11 px-3 py-2"
					label={tag.display_name + (tag.unavailable ? ' · Unavailable' : '')}
					checked={selected.includes(String(tag.id))}
					disabled={tag.unavailable || creating}
					onchange={(event) => choose(String(tag.id), event.currentTarget.checked)}
				/>
			</div>
		{:else}<p class="text-sm text-muted-foreground">
				{single && !searched ? 'Search to choose a tag.' : 'No tags found.'}
			</p>{/each}
	</div>
	{#if !single || searched}<Pagination
			page={listing.page}
			totalPages={listing.totalPages}
			label={`${label} choices`}
			previous={listing.page > 1 ? () => search(listing.page - 1) : null}
			next={listing.page < listing.totalPages ? () => search(listing.page + 1) : null}
			compact
		/>{/if}
	{#if allowCreate}
		<Button
			type="button"
			variant="outline"
			disabled={creating}
			onclick={() => {
				createOpen = !createOpen;
				name = query;
				errors = {};
				existing = null;
			}}><Plus data-icon="inline-start" aria-hidden="true" />Create a tag</Button
		>
		{#if createOpen}<div
				class="space-y-4 rounded-[var(--r-group)] border p-4"
				role="group"
				aria-label="Create tag"
			>
				<TagDefinitionFields
					bind:name
					bind:color
					{errors}
					prefix={`${uid}-create`}
					onenter={() => {
						if (!creating) void create();
					}}
				/>
				<p class="text-sm text-muted-foreground">
					Creating saves this reusable tag now. Save the job or person to assign it. Cancelling the
					editor leaves the tag available.
				</p>
				{#if existing}<Button
						type="button"
						variant="outline"
						onclick={() => {
							remember([existing!]);
							selected = single
								? [String(existing!.id)]
								: [...new Set([...selected, String(existing!.id)])];
							createOpen = false;
							message = '';
							dirty();
						}}>Use existing tag</Button
					>{/if}
				<div class="flex flex-wrap gap-2">
					<Button type="button" variant="outline" disabled={creating} onclick={create}
						>{creating ? 'Creating…' : 'Create tag'}</Button
					><Button
						type="button"
						variant="ghost"
						disabled={creating}
						onclick={() => (createOpen = false)}>Cancel creation</Button
					>
				</div>
			</div>{/if}{/if}
	<noscript
		><p class="text-sm text-muted-foreground">
			Choose from the tags shown, then save. Manage tag definitions in <a
				class="link"
				href="/settings#tags">Settings</a
			>. Enable JavaScript for tag search, more choices and inline creation.
		</p></noscript
	>
	<span class="sr-only" role="status">{announcement}</span>
</div>

<style>
	.tag-choice {
		border: 1px solid var(--border);
		border-radius: var(--r-control);
		max-width: 100%;
		min-width: 0;
	}
	.tag-choice :global(.check-field) {
		min-height: 44px;
		min-width: 44px;
		margin: 0;
		cursor: pointer;
		align-items: center;
	}
	.tag-choice :global(.check-field span) {
		overflow-wrap: anywhere;
	}
	@media (forced-colors: active) {
		.tag-choice {
			background: Canvas !important;
			color: CanvasText !important;
			border-color: CanvasText;
		}
	}
</style>
