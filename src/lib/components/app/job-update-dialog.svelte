<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick, untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import JobHistoryFields from './job-history-fields.svelte';
	import Field from './field.svelte';
	import Notice from './notice.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import UnsavedGuard from './unsaved-guard.svelte';
	import { UnsavedChanges } from '$lib/unsaved.svelte';
	import { focusFirstError, withPending } from '$lib/forms';

	let {
		data,
		mode,
		entry,
		form,
		onclose
	}: {
		data: {
			job: {
				id: number;
				currentStageId: number;
				currentStage: { name: string };
				followUpDate: string | null;
				followUpComment: string | null;
			};
			stages: { id: number; name: string; is_closed: boolean; is_archived: boolean }[];
			today: string;
			returnTo: string;
		};
		mode: 'move' | 'add' | 'edit' | 'followUp';
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
		mode === 'move'
			? 'Change stage'
			: mode === 'edit'
				? 'Edit history'
				: mode === 'add'
					? 'Add history'
					: data.job.followUpDate
						? 'Edit follow-up'
						: 'Schedule follow-up'
	);
	const description = $derived(
		mode === 'move'
			? 'Change current placement and record a milestone together.'
			: mode === 'edit'
				? 'Correct history without changing the current stage.'
				: mode === 'add'
					? 'Records history only; does not change the current stage.'
					: 'Plan your next follow-up. This does not change the current stage or add history.'
	);
	const prefix = $derived(mode === 'move' ? 'move' : mode === 'edit' ? 'correction' : 'history');
	const errors = $derived(form?.errors ?? {});
	function action(name: string) {
		return '?/' + name + '&' + new URLSearchParams({ return_to: data.returnTo });
	}
	function initialValues() {
		return {
			stage_id: form?.values.stage_id ?? (entry?.stageId ? String(entry.stageId) : ''),
			event_date: form?.values.event_date ?? entry?.date ?? data.today,
			note: form?.values.note ?? entry?.note ?? '',
			follow_up_date: form?.values.follow_up_date ?? data.job.followUpDate ?? '',
			follow_up_comment: form?.values.follow_up_comment ?? data.job.followUpComment ?? ''
		};
	}
	let draft = $state(untrack(initialValues));
	let open = $state(true);
	let deleting = $state(false);
	let discardOpen = $state(false);
	const guard = new UnsavedChanges();
	$effect(() => {
		if (form?.errors) {
			draft = initialValues();
			deleting = false;
		}
	});
	function close() {
		discardOpen = false;
		deleting = false;
		open = false;
	}
	function requestClose() {
		if (guard.saving) return;
		if (guard.dirty) discardOpen = true;
		else close();
	}
	const enhanceEditor: SubmitFunction = () => {
		guard.saving = true;
		return async ({ result, update }) => {
			if (result.type === 'redirect' || result.type === 'success') {
				guard.dirty = false;
				close();
			}
			await update({ reset: false });
			guard.saving = false;
			await tick();
			focusFirstError();
		};
	};
</script>

<Dialog.Root
	bind:open={
		() => open,
		(next) => {
			if (!next) requestClose();
		}
	}
	onOpenChangeComplete={(open) => {
		if (!open) onclose();
	}}
>
	<Dialog.Content class={mode === 'followUp' ? 'sm:max-w-md' : 'sm:max-w-lg'}>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<form
			id="job-update-form"
			method="POST"
			action={action(
				mode === 'move'
					? 'changeStage'
					: mode === 'edit'
						? 'editHistory'
						: mode === 'add'
							? 'addHistory'
							: 'followUp'
			)}
			use:enhance={withPending(enhanceEditor, () => (guard.saving = false))}
			oninput={guard.markDirty}
			class="space-y-5"
		>
			{#if mode === 'edit'}<input
					type="hidden"
					name="update_id"
					value={form?.values.update_id ?? entry?.id}
				/>{/if}
			{#if errors.form}
				<Notice
					tone="error"
					title={form?.action === 'deleteHistory'
						? 'History was not deleted'
						: 'Changes were not saved'}
				>
					{errors.form}
					{#if form?.moveFirst}<p>Change stage first, then return to this entry.</p>{/if}
				</Notice>
			{/if}
			{#if mode === 'followUp'}
				<Field id="follow_up_date" label="Follow-up date" error={errors.follow_up_date}>
					{#snippet control(attrs)}<Input
							{...attrs}
							name="follow_up_date"
							type="date"
							bind:value={draft.follow_up_date}
						/>{/snippet}
				</Field>
				<Field
					id="follow_up_comment"
					label="Follow-up comment"
					hint="Optional. Set a date to add a comment."
					error={errors.follow_up_comment}
				>
					{#snippet control(attrs)}<Textarea
							{...attrs}
							name="follow_up_comment"
							rows={3}
							maxlength={10000}
							bind:value={draft.follow_up_comment}
						/>{/snippet}
				</Field>
			{:else}
				<p class="meta-text">
					* Required · Current stage: <strong>{data.job.currentStage.name}</strong>
				</p>
				<JobHistoryFields
					stages={data.stages}
					{prefix}
					moving={mode === 'move'}
					currentStageId={data.job.currentStageId}
					today={data.today}
					bind:values={draft}
					{errors}
				/>
			{/if}
			<Dialog.Footer
				class={mode === 'edit' || (mode === 'followUp' && data.job.followUpDate)
					? 'dialog-edit-actions'
					: undefined}
			>
				{#if mode === 'edit'}
					<Button type="button" variant="destructive" onclick={() => (deleting = true)}
						>Delete history</Button
					>
				{:else if mode === 'followUp' && data.job.followUpDate}
					<Button
						type="submit"
						variant="destructive"
						formaction={action('clearFollowUp')}
						formnovalidate>Clear follow-up</Button
					>
				{/if}
				<Button type="button" variant="ghost" onclick={requestClose}>Cancel</Button>
				<Button type="submit"
					>{mode === 'edit'
						? 'Save history'
						: mode === 'followUp'
							? 'Save follow-up'
							: title}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
	{#if mode === 'edit'}
		<ConfirmDialog
			bind:open={deleting}
			title="Delete history?"
			description={`Permanently delete ${entry?.label ?? 'this history entry'}. This cannot be undone and does not change the current stage.`}
			confirmLabel="Delete history"
			formId="job-update-form"
			formAction={action('deleteHistory')}
			formNoValidate
			destructive
		/>
	{/if}
	<Dialog.Root bind:open={discardOpen}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Discard unsaved changes?</Dialog.Title>
				<Dialog.Description>Your latest edits have not been saved.</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="ghost" onclick={() => (discardOpen = false)}>Keep editing</Button>
				<Button
					variant="destructive"
					onclick={() => {
						guard.dirty = false;
						close();
					}}>Discard changes</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
	<UnsavedGuard {guard} />
</Dialog.Root>
