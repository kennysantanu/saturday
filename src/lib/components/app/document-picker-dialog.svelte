<script lang="ts" module>
	export type DocumentChoice = {
		id: string;
		token: string;
		filename: string;
		size: number;
		updated_at: string;
	};
</script>

<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { focusFirstError, skipKeyboardFocus, withPending } from '$lib/forms';
	import { fileIconFor } from '$lib/file-icons';
	import { fileType } from '$lib/file-types';
	import { formatBytes, formatDateTime } from '$lib/format';
	import { resultCount, noMatchHint } from '$lib/filter-labels.js';
	import SearchField from './search-field.svelte';
	import SearchEmpty from './search-empty.svelte';
	import Notice from './notice.svelte';
	import Pagination from './pagination.svelte';
	import RadioOption from './radio-option.svelte';
	import Skeleton from './skeleton.svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	/**
	 * The document picker dialog shared by Profile (Select <slot>) and Copy to this job. It follows
	 * the Link person and Link to job pickers: a search field that follows typing, a count line,
	 * bounded result cards (file icon, name, type · size · updated), compact paging, and Cancel plus
	 * "<verb> <name>". The caller decides where results come from (`onsearch`, `onpage`) and what
	 * the form posts (`formAction`, `hidden`, `submit`), so this component owns layout and behavior
	 * only. `actions` holds extra buttons beside the count, such as Upload and Create new, and
	 * `extra` adds fields inside the form, such as a destination filename.
	 */
	let {
		open = $bindable(true),
		title,
		description,
		choices,
		page,
		totalPages,
		total,
		current = null,
		selected = $bindable(null),
		query = $bindable(''),
		queryValue,
		loading = false,
		error = null,
		errorTitle = 'The selection was not saved',
		formId,
		formAction,
		hidden,
		submit,
		submitLabel,
		emptyText,
		pagerLabel,
		onsearch,
		onpage,
		onclosed,
		actions,
		extra
	}: {
		open?: boolean;
		title: string;
		description: string;
		choices: DocumentChoice[];
		page: number;
		totalPages: number;
		total: number;
		/** The file already in place; it is marked Current and cannot be re-submitted. */
		current?: DocumentChoice | null;
		selected?: DocumentChoice | null;
		query?: string;
		/** The search that produced `choices`. */
		queryValue: string;
		loading?: boolean;
		error?: string | null;
		errorTitle?: string;
		formId: string;
		formAction: string;
		hidden: Record<string, string>;
		submit: SubmitFunction;
		submitLabel: (selected: DocumentChoice | null) => string;
		emptyText: string;
		pagerLabel: string;
		onsearch: (query: string) => void;
		onpage: (page: number) => void;
		/** Called after the dialog has closed. */
		onclosed?: () => void;
		actions?: Snippet<[boolean]>;
		extra?: Snippet;
	} = $props();

	let applied = untrack(() => queryValue);
	let saving = $state(false);
	const list = $derived(
		// A pending choice from another page or search stays visible; the current file only when listed.
		selected && selected.id !== current?.id && !choices.some((choice) => choice.id === selected?.id)
			? [selected, ...choices]
			: choices
	);
	const unchanged = $derived(!selected || selected.id === current?.id);
	function runSearch() {
		applied = query.trim();
		onsearch(applied);
	}
	// Results follow typing after a short pause; Enter searches at once.
	$effect(() => {
		const value = query.trim();
		if (value === applied) return;
		const timer = setTimeout(runSearch, 300);
		return () => clearTimeout(timer);
	});
	const send: SubmitFunction = async (input) => {
		saving = true;
		const callback = await submit(input);
		return async (result) => {
			try {
				await callback?.(result);
			} finally {
				if (result.result.type !== 'redirect') {
					saving = false;
					await tick();
					focusFirstError();
				}
			}
		};
	};
	const describeDoc = (doc: DocumentChoice) =>
		`${fileType(doc.filename).label} · ${formatBytes(doc.size)} · ${formatDateTime(doc.updated_at)}`;
	const count = $derived(
		resultCount(total, {
			one: 'document',
			many: 'documents',
			filtered: !!queryValue,
			qualifier: 'matching search'
		})
	);
</script>

<Dialog.Root
	bind:open={() => open, (next) => (open = saving ? open : next)}
	onOpenChangeComplete={(next) => {
		if (!next) onclosed?.();
	}}
>
	<Dialog.Content
		class="link-picker sm:max-w-lg"
		aria-busy={saving}
		onOpenAutoFocus={skipKeyboardFocus}
		onEscapeKeydown={(event) => saving && event.preventDefault()}
		onInteractOutside={(event) => saving && event.preventDefault()}
	>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<div class="link-picker-body space-y-5">
			<form
				method="GET"
				onsubmit={(event) => {
					event.preventDefault();
					runSearch();
				}}
				class="space-y-3"
			>
				<SearchField
					id="picker_query"
					label="Search filenames"
					name="query"
					maxlength={200}
					placeholder="Filename"
					bind:value={query}
				/>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="text-sm text-muted-foreground" role="status" aria-live="polite">{count}</p>
					{#if actions}<div class="flex flex-wrap items-center gap-1">
							{@render actions(saving)}
						</div>{/if}
				</div>
			</form>
			<form
				id={formId}
				method="POST"
				action={formAction}
				use:enhance={withPending(send, () => (saving = false))}
				class="space-y-5"
			>
				{#each Object.entries(hidden) as [name, value] (name)}<input
						type="hidden"
						{name}
						{value}
					/>{/each}
				<input type="hidden" name="id" value={selected?.id ?? ''} />
				<input type="hidden" name="token" value={selected?.token ?? ''} />
				{#if error}<Notice tone="error" title={errorTitle}>{error}</Notice>{/if}
				<fieldset class="space-y-2" aria-busy={loading}>
					<legend class="mb-2 text-sm font-medium">Document</legend>
					<div class="link-picker-results space-y-2">
						{#if loading}
							<Skeleton class="h-14 w-full" /><Skeleton class="h-14 w-full" /><Skeleton
								class="h-14 w-full"
							/>
						{:else}
							{#each list as doc (doc.id)}
								{@const Icon = fileIconFor(doc.filename)}
								<RadioOption
									name="choice"
									required={!selected}
									value={doc.id}
									checked={selected?.id === doc.id}
									disabled={saving}
									onchange={() => (selected = doc)}
									label={doc.filename}
									description={describeDoc(doc)}
								>
									{#snippet icon()}<Icon class="size-5" />{/snippet}
									{#snippet badges()}
										{#if current?.id === doc.id}<Badge variant="secondary">Current</Badge>{/if}
									{/snippet}
								</RadioOption>
							{/each}
						{/if}
					</div>
					{#if !loading && !choices.length}
						{#if queryValue}
							<SearchEmpty noun="documents" hint={noMatchHint.search} />
						{:else}
							<p class="text-sm text-muted-foreground">{emptyText}</p>
						{/if}
					{/if}
				</fieldset>
				<Pagination
					label={pagerLabel}
					{page}
					{totalPages}
					compact
					previous={saving ? null : () => onpage(page - 1)}
					next={saving ? null : () => onpage(page + 1)}
				/>
				{@render extra?.()}
			</form>
		</div>
		<Dialog.Footer>
			<Button type="button" variant="ghost" disabled={saving} onclick={() => (open = false)}
				>Cancel</Button
			>
			<Button type="submit" form={formId} class="max-w-full min-w-0" disabled={unchanged || saving}
				><span class="truncate">{saving ? 'Saving…' : submitLabel(selected)}</span></Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
