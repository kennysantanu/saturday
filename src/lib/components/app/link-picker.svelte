<script lang="ts" module>
	import type { StatusInfo } from '$lib/status';
	export type PickerChoice = {
		id: number;
		title: string;
		initial: string;
		meta?: string;
		status?: StatusInfo;
		closed?: boolean;
		linked?: boolean;
	};
</script>

<script lang="ts">
	import type { Component } from 'svelte';
	import { tick, untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { goto } from '$app/navigation';
	import { page as currentPage } from '$app/state';
	import { enhance } from '$app/forms';
	import { focusFirstError, withPending } from '$lib/forms';
	import { UnsavedChanges } from '$lib/unsaved.svelte';
	import { resultCount } from '$lib/filter-labels.js';
	import UnsavedDialog from './unsaved-dialog.svelte';
	import Field from './field.svelte';
	import SearchField from './search-field.svelte';
	import SearchEmpty from './search-empty.svelte';
	import Notice from './notice.svelte';
	import Pagination from './pagination.svelte';
	import RadioOption from './radio-option.svelte';
	import StatusBadge from './status-badge.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	/**
	 * The record picker dialog behind Link person (job detail) and Link to job (network detail).
	 * Search, paging and selection live in the URL and component state, so the chosen record and the
	 * relationship note survive searching, paging and a rejected save. The wrapper supplies names,
	 * parameter keys and the page's data; this component owns layout and behavior.
	 */
	let {
		title,
		description,
		noun,
		nouns,
		verb = 'Link',
		choices,
		page,
		totalPages,
		total,
		initialSelected,
		queryValue,
		queryParam,
		pageParam,
		closeKeys,
		searchAction,
		searchHidden,
		searchId,
		searchLabel,
		searchPlaceholder,
		noteId,
		formId,
		pagerLabel,
		fieldName,
		failureAction,
		actionName,
		form,
		searchErrors,
		addHref,
		addLabel,
		AddIcon,
		emptyHint,
		noteHint
	}: {
		title: string;
		description: string;
		noun: string;
		nouns: string;
		verb?: string;
		choices: PickerChoice[];
		page: number;
		totalPages: number;
		total: number;
		initialSelected: PickerChoice | null;
		queryValue: string;
		queryParam: string;
		pageParam: string;
		closeKeys: string[];
		searchAction: string;
		searchHidden: Record<string, string>;
		searchId: string;
		searchLabel: string;
		searchPlaceholder: string;
		noteId: string;
		formId: string;
		pagerLabel: string;
		fieldName: string;
		failureAction: string;
		actionName: string;
		form?: {
			action: string;
			errors?: Record<string, string>;
			values?: Record<string, string>;
		} | null;
		searchErrors: string[];
		addHref: string;
		addLabel: string;
		AddIcon: Component;
		emptyHint: string;
		noteHint: string;
	} = $props();

	let open = $state(true);
	const guard = new UnsavedChanges();
	let selected = $state<PickerChoice | null>(untrack(() => initialSelected));
	let note = $state('');
	let browsing = $state(false);
	let query = $state(untrack(() => queryValue));
	let applied = untrack(() => queryValue);
	const errors = $derived(form?.action === failureAction ? (form.errors ?? {}) : {});
	const linkedSelected = $derived(
		!!selected && !!choices.find((c) => c.id === selected?.id)?.linked
	);
	const list = $derived(
		selected && !choices.some((choice) => choice.id === selected?.id)
			? [selected, ...choices]
			: choices
	);

	function href(changes: Record<string, string | number | null> = {}) {
		const params = new URLSearchParams(currentPage.url.searchParams);
		for (const key of [...params.keys()])
			if (key.startsWith('/') || key === 'saved') params.delete(key);
		for (const [key, value] of Object.entries(changes)) {
			if (value === null || value === '') params.delete(key);
			else params.set(key, String(value));
		}
		return currentPage.url.pathname + (params.size ? '?' + params : '');
	}
	const closeHref = () => href(Object.fromEntries(closeKeys.map((key) => [key, null])));
	$effect(() => {
		if (!open) {
			guard.dirty = false;
			void goto(untrack(closeHref), { replaceState: true, noScroll: true, keepFocus: true });
		}
	});
	$effect(() => {
		if (form?.action !== failureAction || !form.errors) return;
		note = form.values?.notes ?? '';
		const candidates = untrack(() =>
			[selected, initialSelected, ...choices].filter((item): item is PickerChoice => item !== null)
		);
		selected = candidates.find((item) => String(item.id) === form.values?.[fieldName]) ?? null;
	});
	async function navigate(address: string) {
		browsing = true;
		guard.saving = true;
		try {
			await goto(address, { noScroll: true, keepFocus: true });
		} finally {
			browsing = false;
			guard.saving = false;
		}
	}
	function runSearch() {
		applied = query.trim();
		void navigate(href({ [pageParam]: null, [queryParam]: applied }));
	}
	// Results follow typing after a short pause; Enter searches at once.
	$effect(() => {
		const value = query.trim();
		if (value === applied) return;
		const timer = setTimeout(runSearch, 300);
		return () => clearTimeout(timer);
	});
	function select(choice: PickerChoice) {
		selected = choice;
		guard.markDirty();
	}
	function action() {
		const params = new URLSearchParams(currentPage.url.searchParams);
		for (const key of [...params.keys()]) if (key.startsWith('/')) params.delete(key);
		return `?/${actionName}&` + params;
	}
	const save: SubmitFunction = () => {
		guard.saving = true;
		return async ({ result, update }) => {
			if (result.type === 'redirect' || result.type === 'success') guard.dirty = false;
			await update({ reset: false });
			guard.saving = false;
			await tick();
			focusFirstError();
		};
	};
	const count = $derived(
		resultCount(total, {
			one: noun,
			many: nouns,
			filtered: !!queryValue,
			qualifier: 'matching search'
		})
	);
</script>

<UnsavedDialog bind:open {guard}>
	{#snippet children(close)}
		<Dialog.Content class="link-picker sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>{title}</Dialog.Title>
				<Dialog.Description>{description}</Dialog.Description>
			</Dialog.Header>
			<div class="link-picker-body space-y-5">
				<form
					method="GET"
					action={searchAction}
					onsubmit={(event) => {
						event.preventDefault();
						runSearch();
					}}
					class="space-y-3"
				>
					{#if searchErrors.length}<Notice tone="error" title="Check the search or page values"
							>{searchErrors.join(' ')}</Notice
						>{/if}
					{#each Object.entries(searchHidden) as [name, value] (name)}<input
							type="hidden"
							{name}
							{value}
						/>{/each}
					<SearchField
						id={searchId}
						label={searchLabel}
						name={queryParam}
						maxlength={200}
						placeholder={searchPlaceholder}
						bind:value={query}
					/>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="text-sm text-muted-foreground" role="status" aria-live="polite">{count}</p>
						<Button href={addHref} variant="ghost" disabled={guard.saving}
							><AddIcon data-icon="inline-start" />{addLabel}</Button
						>
					</div>
				</form>
				<form
					id={formId}
					method="POST"
					action={action()}
					use:enhance={withPending(save, () => {
						guard.saving = false;
					})}
					class="space-y-5"
					oninput={guard.markDirty}
				>
					<input type="hidden" name={fieldName} value={selected?.id ?? ''} />
					{#if errors.form || errors[fieldName]}<Notice
							tone="error"
							title={`Could not link ${noun}`}>{errors.form || errors[fieldName]}</Notice
						>{/if}
					<fieldset class="space-y-2" aria-busy={browsing}>
						<legend class="mb-2 text-sm font-medium"
							>{noun[0].toUpperCase() + noun.slice(1)}
							<span class="text-destructive" aria-hidden="true">*</span></legend
						>
						<div class="link-picker-results space-y-2">
							{#each list as choice (choice.id)}
								<RadioOption
									name={`${fieldName}_choice`}
									required={!selected}
									value={choice.id}
									checked={selected?.id === choice.id}
									disabled={choice.linked || guard.saving}
									onchange={() => select(choice)}
									initial={choice.initial}
									label={choice.title}
									number={choice.id}
									description={choice.meta}
								>
									{#snippet badges()}
										{#if choice.linked}<Badge variant="secondary">Already linked</Badge
											>{:else if choice.status}<StatusBadge status={choice.status} />{/if}
									{/snippet}
								</RadioOption>
							{/each}
						</div>
						{#if !choices.length}<SearchEmpty noun={nouns} hint={emptyHint} />{/if}
					</fieldset>
					<Pagination
						label={pagerLabel}
						{page}
						{totalPages}
						compact
						previous={guard.saving ? null : () => navigate(href({ [pageParam]: page - 1 }))}
						next={guard.saving ? null : () => navigate(href({ [pageParam]: page + 1 }))}
					/>
					{#if linkedSelected}<Notice tone="error" title="Already linked"
							>This {noun} is already linked. Choose another.</Notice
						>{/if}
					<Field id={noteId} label="Relationship note" hint={noteHint} error={errors.notes}>
						{#snippet control(attrs)}<Textarea
								{...attrs}
								name="notes"
								maxlength={2000}
								rows={3}
								bind:value={note}
							/>{/snippet}
					</Field>
				</form>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="ghost" disabled={guard.saving} onclick={close}>Cancel</Button
				>
				<Button
					type="submit"
					form={formId}
					class="max-w-full min-w-0"
					disabled={!selected || linkedSelected || guard.saving}
					><span class="truncate"
						>{guard.saving && !browsing
							? 'Linking…'
							: selected
								? `${verb} ${selected.title}`
								: `${verb} ${noun}`}</span
					></Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	{/snippet}
</UnsavedDialog>
