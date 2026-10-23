<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { tick, untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import JobHistoryFields from './job-history-fields.svelte';
	import ActivityReminderFields from './activity-reminder-fields.svelte';
	import Notice from './notice.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import UnsavedDialog from './unsaved-dialog.svelte';
	import { UnsavedChanges } from '$lib/unsaved.svelte';
	import { focusFirstError, withPending } from '$lib/forms';
	import type { ReminderDraft } from '$lib/reminders';
	let {
		data,
		mode,
		entry,
		form,
		onclose
	}: {
		data: {
			job: { id: number; currentStageId: number; currentStage: { name: string } };
			stages: { id: number; name: string; is_closed: boolean; is_archived: boolean }[];
			today: string;
			returnTo: string;
		};
		mode: 'move' | 'add' | 'edit';
		entry?: {
			id: number;
			stageId: number | null;
			date: string;
			note: string | null;
			label: string;
		};
		form?: {
			action: string;
			values: Record<string, string>;
			errors: Record<string, string>;
			moveFirst?: boolean;
		} | null;
		onclose: () => void;
	} = $props();
	const title = $derived(
		mode === 'move' ? 'Change stage' : mode === 'edit' ? 'Edit history' : 'Add history'
	);
	const errors = $derived(form?.errors ?? {});
	let open = $state(true),
		deleting = $state(false);
	let draft = $state(
		untrack(() => ({
			stage_id: form?.values.stage_id ?? (entry?.stageId ? String(entry.stageId) : ''),
			event_date: form?.values.event_date ?? entry?.date ?? data.today,
			note: form?.values.note ?? entry?.note ?? ''
		}))
	);
	let addReminder = $state(untrack(() => form?.values.add_reminder === 'on'));
	let reminder = $state<ReminderDraft>(
		untrack(() => ({
			reminder_date: form?.values.reminder_date ?? data.today,
			reminder_time: form?.values.reminder_time ?? '00:00',
			reminder_note: form?.values.reminder_note ?? ''
		}))
	);
	const guard = new UnsavedChanges();
	$effect(() => {
		if (form?.errors) deleting = false;
	});
	function action(name: string) {
		return '?/' + name + '&' + new URLSearchParams({ return_to: data.returnTo });
	}
	const save: SubmitFunction = () => {
		guard.saving = true;
		return async ({ result, update }) => {
			if (result.type === 'redirect' || result.type === 'success') {
				guard.dirty = false;
				open = false;
			}
			await update({ reset: false });
			guard.saving = false;
			deleting = false;
			await tick();
			focusFirstError();
		};
	};
</script>

<UnsavedDialog bind:open {guard} onclosed={onclose}>
	{#snippet children(close)}
		<Dialog.Content class="sm:max-w-lg"
			><Dialog.Header
				><Dialog.Title>{title}</Dialog.Title><Dialog.Description
					>{mode === 'move'
						? 'Change current placement and record a milestone together.'
						: mode === 'edit'
							? 'Correct history without changing the current stage.'
							: 'Records history only; does not change the current stage.'}</Dialog.Description
				></Dialog.Header
			>
			<form
				id="job-update-form"
				method="POST"
				action={action(
					mode === 'move' ? 'changeStage' : mode === 'edit' ? 'editHistory' : 'addHistory'
				)}
				use:enhance={withPending(save, () => {
					guard.saving = false;
					deleting = false;
				})}
				oninput={guard.markDirty}
				class="space-y-5"
			>
				{#if mode === 'edit'}<input
						type="hidden"
						name="update_id"
						value={form?.values.update_id ?? entry?.id}
					/>{/if}
				{#if errors.form}<Notice
						tone="error"
						title={form?.action === 'deleteHistory'
							? 'History was not deleted'
							: 'Changes were not saved'}
						>{errors.form}{#if form?.moveFirst}<p>
								Change stage first, then return to this entry.
							</p>{/if}</Notice
					>{/if}
				<p class="meta-text">
					* Required · Current stage: <strong>{data.job.currentStage.name}</strong>
				</p>
				<JobHistoryFields
					stages={data.stages}
					prefix={mode === 'move' ? 'move' : mode === 'edit' ? 'correction' : 'history'}
					moving={mode === 'move'}
					currentStageId={data.job.currentStageId}
					today={data.today}
					bind:values={draft}
					{errors}
				/>
				{#if mode !== 'edit'}<ActivityReminderFields
						bind:enabled={addReminder}
						bind:values={reminder}
						{errors}
						note={draft.note}
						prefix="history-reminder"
					/>{/if}
				<Dialog.Footer class={mode === 'edit' ? 'dialog-edit-actions' : undefined}>
					{#if mode === 'edit'}<Button
							type="button"
							variant="destructive"
							onclick={() => (deleting = true)}>Delete history</Button
						>{/if}
					<Button type="button" variant="ghost" onclick={close}>Cancel</Button><Button type="submit"
						>{mode === 'edit' ? 'Save history' : title}</Button
					>
				</Dialog.Footer>
			</form></Dialog.Content
		>
		{#if mode === 'edit'}<ConfirmDialog
				bind:open={deleting}
				title="Delete history?"
				description={`Permanently delete ${entry?.label ?? 'this history entry'}. This cannot be undone and does not change the current stage. Reminders are kept.`}
				confirmLabel="Delete history"
				formId="job-update-form"
				formAction={action('deleteHistory')}
				formNoValidate
				destructive
				pending={guard.saving}
			/>{/if}
	{/snippet}
</UnsavedDialog>
