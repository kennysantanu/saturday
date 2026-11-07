<script lang="ts">
	import { untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { goto } from '$app/navigation';
	import { page as currentPage } from '$app/state';
	import DocumentPickerDialog, { type DocumentChoice } from './document-picker-dialog.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import Upload from '@lucide/svelte/icons/upload';
	import Plus from '@lucide/svelte/icons/plus';

	/**
	 * The picker behind each Profile slot: `DocumentPickerDialog` with search and paging kept in the
	 * address (`select`, `query`, `page`), so the chosen file survives searching and paging, plus
	 * Upload and Create new beside the count.
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
	const navigate = (address: string) => goto(address, { noScroll: true, keepFocus: true });
	const submit: SubmitFunction =
		() =>
		async ({ update }) => {
			await update({ reset: false });
		};
</script>

<DocumentPickerDialog
	bind:open
	bind:selected
	bind:query
	title={`Select ${label}`}
	description={`Choose a ${formatLabel} file from Documents. The previous file is kept.`}
	{choices}
	{page}
	{totalPages}
	{total}
	{current}
	{queryValue}
	{error}
	formId="profile-select"
	formAction="?/select"
	hidden={{ designation, catalog_token: catalogToken }}
	{submit}
	submitLabel={(chosen) => (chosen ? `Use ${chosen.filename}` : 'Use document')}
	emptyText={`No ${formatLabel} documents yet. Upload a file or create a new one.`}
	pagerLabel="Document picker pages"
	onsearch={(value) => void navigate(href({ page: null, query: value }))}
	onpage={(target) => void navigate(href({ page: target }))}
>
	{#snippet actions(saving)}
		<Button variant="ghost" type="button" disabled={busy || saving} onclick={onupload}
			><Upload data-icon="inline-start" />{uploadLabel}</Button
		>
		<Button variant="ghost" href={createHref} disabled={busy || saving}
			><Plus data-icon="inline-start" />Create new</Button
		>
	{/snippet}
</DocumentPickerDialog>
