<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import SectionCard from './section-card.svelte';
	import ReminderFields from './reminder-fields.svelte';
	import ReminderBadge from './reminder-badge.svelte';
	import Checkbox from './checkbox.svelte';
	import UnsavedDialog from './unsaved-dialog.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import Notice from './notice.svelte';
	import ExpandableText from './expandable-text.svelte';
	import Pagination from './pagination.svelte';
	import { UnsavedChanges } from '$lib/unsaved.svelte';
	import { enhanceWithFocus, withPending, focusFirstError } from '$lib/forms';
	import { formatDateTime } from '$lib/format';
	import type { Reminder, ReminderPage, ReminderDraft } from '$lib/reminders';
	let {
		data,
		form,
		today,
		closedJob = false
	}: {
		data: { active: ReminderPage; past: ReminderPage; now: string };
		form?: {
			action?: string;
			errors?: Record<string, string>;
			values?: Record<string, string>;
		} | null;
		today: string;
		closedJob?: boolean;
	} = $props();
	let failure = $state<Record<string, string>>({});
	let open = $state(false),
		deleting = $state(false),
		selected = $state<Reminder | null>(null),
		active = $state(true),
		originalActive = $state(true);
	let draft = $state<ReminderDraft>({
		reminder_date: '',
		reminder_time: '00:00',
		reminder_note: ''
	});
	const guard = new UnsavedChanges();
	const errors = $derived(failure);
	function href(key: string, value: number) {
		const query = new URLSearchParams(page.url.searchParams);
		for (const k of [...query.keys()]) if (k.startsWith('/') || k === 'saved') query.delete(k);
		query.set(key, String(value));
		return page.url.pathname + '?' + query + '#reminders';
	}
	function formAction(name: string) {
		const query = new URLSearchParams(page.url.searchParams);
		for (const k of [...query.keys()]) if (k.startsWith('/')) query.delete(k);
		return '?/' + name + (query.size ? '&' + query : '');
	}
	function edit(entry: Reminder | null) {
		failure = {};
		selected = entry;
		originalActive = entry?.is_active ?? true;
		active = originalActive;
		draft = {
			reminder_date: entry?.scheduled_at.slice(0, 10) ?? today,
			reminder_time: entry?.scheduled_at.slice(11, 16) ?? '00:00',
			reminder_note: entry?.note ?? ''
		};
		open = true;
	}
	$effect(() => {
		if (form?.action === 'reminderDismiss' && form.errors) failure = form.errors;
		if (
			form?.errors &&
			['reminderCreate', 'reminderEdit', 'reminderDelete'].includes(form.action ?? '')
		) {
			const values = form.values ?? {};
			failure = form.errors;
			selected =
				[...data.active.reminders, ...data.past.reminders].find(
					(r) => String(r.id) === values.reminder_id
				) ??
				selected ??
				(values.reminder_id ? ({ id: Number(values.reminder_id) } as Reminder) : null);
			if (values.original_active !== undefined) {
				originalActive = values.original_active === '1';
				active = originalActive;
			}
			draft = {
				reminder_date: values.reminder_date ?? draft.reminder_date,
				reminder_time: values.reminder_time ?? draft.reminder_time,
				reminder_note: values.reminder_note ?? draft.reminder_note
			};
			if (values.active_changed === '1') active = values.is_active === 'on';
			open = true;
			deleting = false;
		}
	});
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

<SectionCard id="reminders" title="Reminders" class="compact-card" contentClass="space-y-3">
	{#snippet action()}<Button variant="ghost" size="sm" onclick={() => edit(null)}
			><Plus data-icon="inline-start" />Add reminder</Button
		>{/snippet}
	{#if closedJob && data.active.total}<p class="text-sm text-muted-foreground">
			Closed job · Active reminders remain visible on Dashboard.
		</p>{/if}
	{#if form?.action === 'reminderDismiss' && errors.form}<Notice
			tone="error"
			title="Reminder was not dismissed">{errors.form}</Notice
		>{/if}
	{#if !data.active.total}<p class="text-sm text-muted-foreground">No active reminders.</p>{/if}
	{#each data.active.reminders as entry (entry.id)}
		<div class="space-y-3 rounded-[var(--r-group)] border p-3" data-reminder-id={entry.id}>
			<ReminderBadge schedule={entry.scheduled_at} now={data.now} />
			{#if entry.note}<ExpandableText text={entry.note} limit={160} lines={3} />{:else}<p
					class="text-sm"
				>
					Reminder
				</p>{/if}
			<div class="flex flex-wrap items-center gap-2">
				<form method="POST" action={formAction('reminderDismiss')} use:enhance={enhanceWithFocus}>
					<input type="hidden" name="reminder_id" value={entry.id} /><Button
						variant="outline"
						size="sm"
						type="submit">Dismiss reminder</Button
					>
				</form>
				<Button variant="ghost" size="sm" onclick={() => edit(entry)}
					><Pencil data-icon="inline-start" />Edit reminder</Button
				>
			</div>
		</div>
	{/each}
	<Pagination
		compact
		label="Active reminder pages"
		page={data.active.page}
		totalPages={data.active.totalPages}
		previous={href('reminders_page', data.active.page - 1)}
		next={href('reminders_page', data.active.page + 1)}
	/>
	{#if data.past.total}<details
			class="disclosure"
			open={page.url.searchParams.has('past_reminders_page')}
		>
			<summary>Past reminders ({data.past.total})</summary>
			<div class="disclosure-body space-y-4">
				{#each data.past.reminders as entry (entry.id)}<div
						class="space-y-3"
						data-reminder-id={entry.id}
					>
						<ReminderBadge schedule={entry.scheduled_at} now="" />
						{#if entry.note}<ExpandableText text={entry.note} limit={160} lines={3} />{:else}<p
								class="text-sm"
							>
								Reminder
							</p>{/if}
						<p class="text-sm text-muted-foreground">
							Dismissed {formatDateTime(entry.dismissed_at!)}
						</p>
						<Button variant="ghost" size="sm" onclick={() => edit(entry)}
							><Pencil data-icon="inline-start" />Edit reminder</Button
						>
					</div>{/each}
				<Pagination
					compact
					label="Past reminder pages"
					page={data.past.page}
					totalPages={data.past.totalPages}
					previous={href('past_reminders_page', data.past.page - 1)}
					next={href('past_reminders_page', data.past.page + 1)}
				/>
			</div>
		</details>{/if}
</SectionCard>
<UnsavedDialog bind:open {guard}>
	{#snippet children(close)}
		<Dialog.Content class="sm:max-w-lg"
			><Dialog.Header
				><Dialog.Title>{selected ? 'Edit reminder' : 'Add reminder'}</Dialog.Title
				><Dialog.Description
					>Keep a prompt for this record. Dismissing it does not record an outcome in history.</Dialog.Description
				></Dialog.Header
			>
			<form
				id="reminder-editor"
				method="POST"
				action={formAction(selected ? 'reminderEdit' : 'reminderCreate')}
				use:enhance={withPending(save, () => {
					guard.saving = false;
					deleting = false;
				})}
				oninput={guard.markDirty}
				class="space-y-5"
			>
				<p class="text-sm text-muted-foreground">* Required</p>
				{#if selected}<input type="hidden" name="reminder_id" value={selected.id} /><input
						type="hidden"
						name="original_active"
						value={originalActive ? '1' : '0'}
					/><input
						type="hidden"
						name="active_changed"
						value={active !== originalActive ? '1' : '0'}
					/>{/if}
				<input type="hidden" name="confirm" value="true" />
				{#if errors.form || errors.confirm || errors.note || errors.reminder_id}<Notice
						tone="error"
						title="Reminder was not saved"
						>{errors.form || errors.confirm || errors.note || errors.reminder_id}</Notice
					>{/if}
				<ReminderFields bind:values={draft} {errors} />
				{#if selected}<Checkbox label="Active" name="is_active" bind:checked={active} />{/if}
				<Dialog.Footer class={selected ? 'dialog-edit-actions' : undefined}>
					{#if selected}<Button
							type="button"
							variant="destructive"
							onclick={() => (deleting = true)}>Delete reminder</Button
						>{/if}
					<Button type="button" variant="ghost" onclick={close}>Cancel</Button><Button type="submit"
						>{selected ? 'Save reminder' : 'Add reminder'}</Button
					>
				</Dialog.Footer>
			</form></Dialog.Content
		>
		<ConfirmDialog
			bind:open={deleting}
			title="Delete reminder?"
			description="Permanently delete this reminder. Its job or person and history are kept. This cannot be undone."
			confirmLabel="Delete reminder"
			formId="reminder-editor"
			formAction={formAction('reminderDelete')}
			formNoValidate
			destructive
			pending={guard.saving}
		/>
	{/snippet}
</UnsavedDialog>
