<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import JobHistoryFields from './job-history-fields.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import Notice from './notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { enhanceWithFocus } from '$lib/forms';
	let {
		entry,
		stages,
		jobId,
		historyGuard,
		errors = {},
		values = {}
	}: {
		entry: { id: number; stageId: number | null; date: string; note: string | null; label: string };
		stages: { id: number; name: string; is_closed: boolean; is_archived: boolean }[];
		jobId: number;
		historyGuard: import('$lib/unsaved.svelte').UnsavedChanges;
		errors?: Record<string, string | undefined>;
		values?: Record<string, string | undefined>;
	} = $props();
	let deleting = $state(false);
	const own = $derived(values.update_id === String(entry.id));
	const ownErrors = $derived(own ? errors : {});
	const draft = $derived({
		stage_id: entry.stageId ? String(entry.stageId) : '',
		event_date: entry.date,
		note: entry.note ?? '',
		...(own ? values : {})
	});
	$effect(() => {
		if (own && Object.keys(ownErrors).length) deleting = false;
	});
	const action = $derived(
		'?/correctUpdate' +
			(page.url.searchParams.get('return_to')
				? '&return_to=' + encodeURIComponent(page.url.searchParams.get('return_to')!)
				: '')
	);
</script>

<details class="disclosure" open={own && Object.keys(ownErrors).length > 0}>
	<summary aria-label={'Edit history: ' + entry.label}>Edit history</summary>
	<form
		id={'history-' + entry.id}
		method="POST"
		{action}
		use:enhance={historyGuard.enhance}
		oninput={historyGuard.markDirty}
		class="disclosure-body space-y-4"
	>
		<input type="hidden" name="update_id" value={entry.id} />
		<input type="hidden" name="job_id" value={jobId} />
		{#if ownErrors.form}<Notice tone="error" title="History was not changed"
				>{ownErrors.form} <a href="#change-stage" class="link">Change stage first</a>.</Notice
			>{/if}
		<p class="text-sm">Correct history without changing the current stage.</p>
		<p class="meta-text">* Required</p>
		<JobHistoryFields
			{stages}
			prefix={'correction-' + entry.id}
			today={entry.date}
			values={draft}
			errors={ownErrors}
		/>
		<div class="form-actions">
			<Button type="button" variant="ghost" onclick={() => (deleting = true)}>Delete history</Button
			><Button type="submit">Save history</Button>
		</div>
	</form>
	<form
		id={'delete-history-' + entry.id}
		method="POST"
		{action}
		use:enhance={historyGuard.enhance}
		oninput={historyGuard.markDirty}
	>
		<input type="hidden" name="update_id" value={entry.id} /><input
			type="hidden"
			name="remove"
			value="1"
		/>
		<noscript
			><p class="text-sm">Deletion is permanent. Confirm removal of this history entry.</p>
			<Button type="submit" variant="destructive">Confirm delete history</Button></noscript
		>
	</form>
	<ConfirmDialog
		bind:open={deleting}
		title="Delete history?"
		description={'Permanently delete ' +
			entry.label +
			'. This cannot be undone and does not change the current stage.'}
		confirmLabel="Delete history"
		formId={'delete-history-' + entry.id}
		destructive
	/>
</details>
