<script lang="ts">
	import { tick } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { focusFirstError, withPending } from '$lib/forms';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ActionMenu from './action-menu.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import Notice from './notice.svelte';
	let {
		kind,
		id,
		datasetId,
		name,
		counts,
		action,
		disabled = false
	}: {
		kind: 'job' | 'person';
		id: number;
		datasetId: string;
		name: string;
		counts: { history: number; relationships: number; documents?: number | null };
		action: string;
		disabled?: boolean;
	} = $props();
	let open = $state(false),
		pending = $state(false),
		error = $state(''),
		recovery = $state(false);
	let trigger = $state<HTMLButtonElement | null>(null);
	const label = $derived(`Delete ${kind}`);
	const formId = $derived(`delete-${kind}`);
	const submit: SubmitFunction = () => {
		pending = true;
		error = '';
		return async ({ result, update }) => {
			if (result.type === 'failure') {
				const data = result.data as { error?: string; recovery?: boolean } | undefined;
				error = data?.error ?? 'Deletion could not be completed. Check the record before retrying.';
				recovery = !!data?.recovery;
			} else if (result.type === 'redirect') {
				open = false;
				await update();
			} else {
				error = 'The result is uncertain. Reload to check the record before trying again.';
				recovery = true;
			}
			pending = false;
			await tick();
			focusFirstError();
		};
	};
</script>

<ActionMenu
	bind:ref={trigger}
	label={`${kind === 'job' ? 'Job' : 'Person'} actions`}
	{disabled}
	items={[
		{
			label,
			icon: Trash2,
			destructive: true,
			separated: true,
			onselect: () => {
				if (!recovery) error = '';
				open = true;
			}
		}
	]}
/>
<form
	id={formId}
	method="POST"
	{action}
	use:enhance={withPending(submit, () => {
		pending = false;
	})}
>
	<input type="hidden" name="dataset_id" value={datasetId} />
	<input type="hidden" name="confirm" value="true" />
</form>
<ConfirmDialog
	bind:open
	title={`${label}?`}
	confirmLabel={pending ? 'Deleting…' : label}
	description={kind === 'job'
		? `Permanently delete ${name} (job #${id}), its history, reminders, person relationships and all job-specific documents? Linked people and documents stored elsewhere are kept. This cannot be undone.`
		: `Permanently delete ${name} (person #${id}), their interactions, reminders and job relationships? Linked jobs are kept. This cannot be undone.`}
	{formId}
	destructive
	{pending}
	disabled={recovery}
	focusCancel
	returnFocus={() => trigger?.focus()}
>
	<p class="text-sm text-muted-foreground">
		Currently: {counts.history}
		{kind === 'job'
			? counts.history === 1
				? 'history entry'
				: 'history entries'
			: counts.history === 1
				? 'interaction'
				: 'interactions'},
		{counts.relationships}
		{kind === 'job' ? 'person' : 'job'}
		{counts.relationships === 1 ? 'relationship' : 'relationships'}{#if kind === 'job'},
			{#if counts.documents === null || counts.documents === undefined}document count unavailable{:else}{counts.documents}
				{counts.documents === 1 ? 'document' : 'documents'}{/if}{/if}. Includes changes saved before
		deletion starts.
	</p>
	{#if error}<Notice tone="error" title={recovery ? 'Deletion needs recovery' : 'Could not delete'}
			>{error}{#if recovery}<p>
					Reload to check the result after recovery. Do not submit another deletion.
				</p>{/if}</Notice
		>{/if}
</ConfirmDialog>
