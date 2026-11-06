<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { tick, untrack, onMount } from 'svelte';
	import type { Tag, TagPickerData, TagCollection } from '$lib/tag-types';
	import { tagRequest, TagRequestError } from '$lib/tag-client';
	import { normalizeTagName, validTagSelection } from '$lib/tags.js';
	import TagSearch from './tag-search.svelte';
	import Checkbox from './checkbox.svelte';
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
	const searchThreshold = 12;
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
	// A short list needs no search box; a long list, a single-choice picker or a past search does.
	const showSearch = $derived(single || searched || initial.total > searchThreshold);
	const offered = $derived(normalizeTagName(query.trim()));
	const canOffer = $derived(
		allowCreate &&
			!loading &&
			!!offered &&
			offered.length <= 50 &&
			!listing.tags.some((tag) => tag.name === offered) &&
			!chosen.some((tag) => tag.name === offered)
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
	async function choose(id: string, checked: boolean) {
		selected = single
			? checked
				? [id]
				: []
			: checked
				? [...new Set([...selected, id])]
				: selected.filter((value) => value !== id);
		announcement = checked ? 'Tag selected.' : 'Tag removed from selection.';
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
	{#if showSearch}<TagSearch
			id={`${uid}-search`}
			label={`Search ${label.toLowerCase()}`}
			bind:query
			{loading}
			disabled={creating}
			invalid={listing.invalid_query}
			onsearch={() => search()}
		/>{/if}
	{#if message}<Notice tone="error" title="Tags need attention">{message}</Notice>{/if}
	<div class="flex flex-wrap gap-2" aria-busy={loading}>
		{#each options as tag (tag.id)}
			<div data-choice={tag.id} class="tag-choice" style:--tag={tag.color}>
				<Checkbox
					name={hydrated ? undefined : fieldName}
					value={String(tag.id)}
					class="min-h-11 min-w-11 px-3 py-2"
					label={tag.display_name + (tag.unavailable ? ' · Unavailable' : '')}
					checked={selected.includes(String(tag.id))}
					disabled={creating}
					onchange={(event) => choose(String(tag.id), event.currentTarget.checked)}
				/>
			</div>
		{:else}{#if !canOffer}<p class="text-sm text-muted-foreground">
					{single && !searched ? 'Search to choose a tag.' : 'No tags found.'}
				</p>{/if}{/each}
		{#if canOffer}<button
				type="button"
				class="tag-offer"
				disabled={creating}
				onclick={() => {
					createOpen = true;
					name = query.trim();
					errors = {};
					existing = null;
				}}
				><Plus class="size-4" aria-hidden="true" />Create “{offered!.replaceAll('_', ' ')}”</button
			>{/if}
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
	/* One toggle chip per tag: neutral with a color dot, tinted with a check when selected. */
	.tag-choice {
		position: relative;
		border: 1px solid var(--border);
		border-radius: var(--r-control);
		background: var(--card);
		color: var(--foreground);
		max-width: 100%;
		min-width: 0;
	}
	.tag-choice :global(.check-field) {
		position: relative;
		min-height: 44px;
		min-width: 44px;
		margin: 0;
		gap: 0;
		cursor: pointer;
		align-items: center;
	}
	.tag-choice :global(.check-field input) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		appearance: none;
		-webkit-appearance: none;
		opacity: 0;
		cursor: pointer;
	}
	.tag-choice :global(.check-field span) {
		overflow-wrap: anywhere;
	}
	.tag-choice :global(.check-field span)::before {
		content: '';
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-inline-end: 0.5rem;
		border-radius: 999px;
		background: var(--tag, #64748b);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--foreground) 22%, transparent);
	}
	.tag-choice:has(:global(input:checked)) {
		background: color-mix(in srgb, var(--tag, #64748b) 14%, var(--card));
		border-color: color-mix(in srgb, var(--tag, #64748b) 40%, var(--border));
		font-weight: 600;
	}
	.tag-choice:has(:global(input:checked)) :global(.check-field span)::after {
		content: '\2713';
		margin-inline-start: 0.5rem;
		font-weight: 700;
	}
	.tag-choice:has(:global(input:focus-visible)) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.tag-choice:has(:global(input:disabled)) {
		opacity: 0.5;
		cursor: not-allowed;
	}
	@media (hover: hover) {
		.tag-choice:not(:has(:global(input:checked))):hover {
			background: var(--muted);
		}
	}
	.tag-offer {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		min-height: 44px;
		padding: 0 0.875rem;
		border: 1px dashed var(--input);
		border-radius: var(--r-control);
		color: var(--foreground);
		font-size: 0.875rem;
		cursor: pointer;
	}
	.tag-offer:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (hover: hover) {
		.tag-offer:hover {
			background: var(--muted);
		}
	}
	@media (forced-colors: active) {
		.tag-choice {
			background: Canvas;
			color: CanvasText;
			border-color: CanvasText;
		}
		.tag-choice:has(:global(input:checked)) {
			border: 2px solid Highlight;
		}
		.tag-choice :global(.check-field span)::before {
			background: CanvasText;
			box-shadow: none;
		}
	}
</style>
