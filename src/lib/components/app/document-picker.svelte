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
	import { tick, untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { goto } from '$app/navigation';
	import { page as currentPage } from '$app/state';
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
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Upload from '@lucide/svelte/icons/upload';
	import Plus from '@lucide/svelte/icons/plus';

	/**
	 * The document picker behind each Profile slot. It follows the Link person and Link to job
	 * pickers: a search field that follows typing, a count with the ways to add a file, bounded
	 * result cards (file icon, name, type · size · updated), compact paging, and Cancel plus a
	 * "Use <name>" button. Search and paging live in the address (`select`, `query`, `page`); the
	 * chosen document survives searching and paging.
	 */
	let {
		designation,
		label,
		formatLabel,
		choices,
		page,
		totalPages,
		total,
		current,
		queryValue,
		catalogToken,
		error,
		uploadLabel,
		busy,
		createHref,
		onupload,
		onclosed
	}: {
		designation: string;
		label: string;
		formatLabel: string;
		choices: DocumentChoice[];
		page: number;
		totalPages: number;
		total: number;
		current: DocumentChoice | null;
		queryValue: string;
		catalogToken: string;
		error?: string | null;
		uploadLabel: string;
		busy: boolean;
		createHref: string;
		onupload: () => void;
		/** Called after the dialog has closed and the address no longer names a slot. */
		onclosed?: () => void;
	} = $props();

	let open = $state(true);
	let selected = $state<DocumentChoice | null>(untrack(() => current));
	let query = $state(untrack(() => queryValue));
	let applied = untrack(() => queryValue);
	let browsing = $state(false);
	let saving = $state(false);
	// A pending choice from another page or search stays visible; the current file only when listed.
	const list = $derived(
		selected && selected.id !== current?.id && !choices.some((choice) => choice.id === selected?.id)
			? [selected, ...choices]
			: choices
	);
	const unchanged = $derived(!selected || selected.id === current?.id);

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
	const closeHref = () => href({ select: null, query: null, page: null });
	$effect(() => {
		if (!open)
			void goto(untrack(closeHref), { replaceState: true, noScroll: true, keepFocus: true }).then(
				() => onclosed?.()
			);
	});
	async function navigate(address: string) {
		browsing = true;
		try {
			await goto(address, { noScroll: true, keepFocus: true });
		} finally {
			browsing = false;
		}
	}
	function runSearch() {
		applied = query.trim();
		void navigate(href({ page: null, query: applied }));
	}
	// Results follow typing after a short pause; Enter searches at once.
	$effect(() => {
		const value = query.trim();
		if (value === applied) return;
		const timer = setTimeout(runSearch, 300);
		return () => clearTimeout(timer);
	});
	const save: SubmitFunction = () => {
		saving = true;
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type !== 'redirect') {
				saving = false;
				await tick();
				focusFirstError();
			}
		};
	};
	const describe = (doc: DocumentChoice) =>
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

<Dialog.Root bind:open>
	<Dialog.Content class="link-picker sm:max-w-lg" onOpenAutoFocus={skipKeyboardFocus}>
		<Dialog.Header>
			<Dialog.Title>Select {label}</Dialog.Title>
			<Dialog.Description
				>Choose a {formatLabel} file from Documents. The previous file is kept.</Dialog.Description
			>
		</Dialog.Header>
		<div class="link-picker-body space-y-5">
			<form
				method="GET"
				action="/profile"
				onsubmit={(event) => {
					event.preventDefault();
					runSearch();
				}}
				class="space-y-3"
			>
				<input type="hidden" name="select" value={designation} />
				<SearchField
					id="profile_query"
					label="Search filenames"
					name="query"
					maxlength={200}
					placeholder="Filename"
					bind:value={query}
				/>
				<div class="flex flex-wrap items-center justify-between gap-2">
					<p class="text-sm text-muted-foreground" role="status" aria-live="polite">{count}</p>
					<div class="flex flex-wrap items-center gap-1">
						<Button variant="ghost" type="button" disabled={busy || saving} onclick={onupload}
							><Upload data-icon="inline-start" />{uploadLabel}</Button
						>
						<Button variant="ghost" href={createHref} disabled={busy || saving}
							><Plus data-icon="inline-start" />Create new</Button
						>
					</div>
				</div>
			</form>
			<form
				id="profile-select"
				method="POST"
				action="?/select"
				use:enhance={withPending(save, () => (saving = false))}
				class="space-y-5"
			>
				<input type="hidden" name="designation" value={designation} />
				<input type="hidden" name="id" value={selected?.id ?? ''} />
				<input type="hidden" name="token" value={selected?.token ?? ''} />
				<input type="hidden" name="catalog_token" value={catalogToken} />
				{#if error}<Notice tone="error" title="The selection was not saved">{error}</Notice>{/if}
				<fieldset class="space-y-2" aria-busy={browsing}>
					<legend class="mb-2 text-sm font-medium">Document</legend>
					<div class="link-picker-results space-y-2">
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
								description={describe(doc)}
							>
								{#snippet icon()}<Icon class="size-5" />{/snippet}
								{#snippet badges()}
									{#if current?.id === doc.id}<Badge variant="secondary">Current</Badge>{/if}
								{/snippet}
							</RadioOption>
						{/each}
					</div>
					{#if !choices.length}
						{#if queryValue}
							<SearchEmpty noun="documents" hint={noMatchHint.search} />
						{:else}
							<p class="text-sm text-muted-foreground">
								No {formatLabel} documents yet. Upload a file or create a new one.
							</p>
						{/if}
					{/if}
				</fieldset>
				<Pagination
					label="Document picker pages"
					{page}
					{totalPages}
					compact
					previous={saving ? null : () => navigate(href({ page: page - 1 }))}
					next={saving ? null : () => navigate(href({ page: page + 1 }))}
				/>
			</form>
		</div>
		<Dialog.Footer>
			<Button type="button" variant="ghost" disabled={saving} onclick={() => (open = false)}
				>Cancel</Button
			>
			<Button
				type="submit"
				form="profile-select"
				class="max-w-full min-w-0"
				disabled={unchanged || saving}
				><span class="truncate"
					>{saving ? 'Saving…' : selected ? `Use ${selected.filename}` : 'Use document'}</span
				></Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
