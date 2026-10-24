<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Tag, TagCollection, TagPickerData } from '$lib/tag-types';
	import { tagRequest, TagRequestError } from '$lib/tag-client';
	import { UnsavedChanges } from '$lib/unsaved.svelte';
	import { focusFirstError } from '$lib/forms';
	import { toast } from '$lib/toast.svelte';
	import UnsavedDialog from './unsaved-dialog.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import Notice from './notice.svelte';
	import TagDefinitionFields from './tag-definition-fields.svelte';
	import TagPicker from './tag-picker.svelte';
	let {
		collection,
		initial,
		mode,
		tag,
		ownerId,
		onclose,
		onsaved
	}: {
		collection: TagCollection;
		initial: TagPickerData;
		mode: 'create' | 'edit' | 'merge' | 'assign';
		tag?: Tag;
		ownerId?: number;
		onclose: () => void;
		onsaved?: () => void | Promise<void>;
	} = $props();
	const uid = $props.id(),
		guard = new UnsavedChanges();
	let open = $state(true),
		deleting = $state(false),
		name = $state(untrack(() => tag?.display_name ?? '')),
		color = $state(untrack(() => tag?.color ?? '#64748b')),
		selected = $state(untrack(() => initial.selectedTags.map((t) => String(t.id)))),
		first = $state<string[]>([]),
		second = $state<string[]>([]),
		nameEdited = $state(false),
		colorEdited = $state(false),
		errors = $state<Record<string, string>>({}),
		message = $state(''),
		refreshToken = $state(0);
	const title = $derived(
		mode === 'create'
			? 'Create tag'
			: mode === 'edit'
				? 'Edit tag'
				: mode === 'merge'
					? 'Merge tags'
					: 'Edit tags'
	);
	async function save(
		event: SubmitEvent,
		action: string = mode === 'assign'
			? 'assign'
			: mode === 'create'
				? 'create'
				: mode === 'merge'
					? 'merge'
					: 'edit'
	) {
		event.preventDefault();
		if (guard.saving) return;
		guard.saving = true;
		errors = {};
		message = '';
		try {
			const result = await tagRequest(action, {
				collection,
				tag_id: tag?.id,
				owner_id: ownerId,
				tag_ids: selected,
				name,
				color,
				first_tag_id: first[0],
				second_tag_id: second[0],
				confirm: action === 'delete' || action === 'merge'
			});
			guard.dirty = false;
			open = false;
			deleting = false;
			toast.show(
				action === 'merge'
					? `Tags merged: ${result.resulting_owner_count} ${collection === 'job' ? 'jobs' : 'people'} tagged; ${result.changed_owner_count} changed.`
					: action === 'delete'
						? 'Tag deleted.'
						: action === 'assign'
							? 'Tags saved.'
							: 'Tag saved.'
			);
			await onsaved?.();
			await invalidateAll();
		} catch (error) {
			if (error instanceof TagRequestError) errors = error.errors;
			if (mode === 'assign') refreshToken++;
			message = error instanceof Error ? error.message : 'Tags could not be saved.';
			deleting = false;
		} finally {
			guard.saving = false;
			if (message) {
				await tick();
				focusFirstError();
			}
		}
	}
</script>

<UnsavedDialog bind:open {guard} onclosed={onclose}>
	{#snippet children(close)}
		<Dialog.Content class="sm:max-w-lg" aria-busy={guard.saving}>
			<Dialog.Header
				><Dialog.Title>{title}</Dialog.Title><Dialog.Description
					>{mode === 'assign'
						? 'Choose tags for this record. Removing a selection keeps the reusable tag.'
						: mode === 'merge'
							? 'Combine two tags in this collection. The first tag survives; the second is permanently removed. Jobs and people remain.'
							: 'Names and colors apply everywhere this tag is used in its collection.'}</Dialog.Description
				></Dialog.Header
			>
			<form
				id={`${uid}-save`}
				class="space-y-5"
				onsubmit={save}
				oninput={(event) => {
					guard.markDirty();
					const target = event.target as HTMLInputElement;
					if (target.id === `${uid}-name`) nameEdited = true;
					if (target.id === `${uid}-hex` || target.id === `${uid}-color`) colorEdited = true;
				}}
			>
				{#if message}<Notice tone="error" title="Tags were not saved"
						>{Object.values(errors).join(' ') || message}</Notice
					>{/if}
				<fieldset disabled={guard.saving} class="min-w-0 space-y-5">
					{#if mode === 'assign'}<TagPicker
							{refreshToken}
							{collection}
							{initial}
							bind:selected
							error={errors.tag_ids}
						/>
					{:else}
						{#if mode === 'merge'}
							<TagPicker
								{collection}
								{initial}
								label="First tag"
								bind:selected={first}
								single
								allowCreate={false}
								marker={false}
								fieldName="first_tag_id"
								excludeIds={second}
								error={errors.first_tag_id}
								onselection={(tags) => {
									if (tags[0]) {
										if (!nameEdited) name = tags[0].display_name;
										if (!colorEdited) color = tags[0].color;
									}
								}}
							/>
							<TagPicker
								{collection}
								{initial}
								label="Second tag"
								bind:selected={second}
								single
								allowCreate={false}
								marker={false}
								fieldName="second_tag_id"
								excludeIds={first}
								error={errors.second_tag_id}
							/>
						{/if}
						<TagDefinitionFields bind:name bind:color {errors} prefix={uid} />
						{#if mode === 'merge'}<p class="text-sm text-muted-foreground">
								Every record using either tag will have the merged tag once. The first tag's name
								and color become the result shown above. The second tag is removed. This cannot be
								undone here.
							</p>{/if}
					{/if}
				</fieldset>
				<Dialog.Footer class={mode === 'edit' ? 'dialog-edit-actions' : undefined}>
					{#if mode === 'edit'}<Button
							type="button"
							variant="destructive"
							disabled={guard.saving}
							onclick={() => (deleting = true)}>Delete tag</Button
						>{/if}
					<Button type="button" variant="ghost" disabled={guard.saving} onclick={close}
						>Cancel</Button
					>
					<Button
						type="submit"
						disabled={guard.saving ||
							(mode === 'merge' && (!first.length || !second.length || first[0] === second[0]))}
						>{guard.saving
							? 'Saving…'
							: mode === 'merge'
								? 'Merge tags'
								: mode === 'assign'
									? 'Save tags'
									: mode === 'create'
										? 'Create tag'
										: 'Save tag'}</Button
					>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	{/snippet}
</UnsavedDialog>
<form id={`${uid}-delete`} onsubmit={(event) => save(event, 'delete')}></form>
<ConfirmDialog
	bind:open={deleting}
	title="Delete tag?"
	description={`Remove “${tag?.display_name ?? ''}” from every ${collection === 'job' ? 'job' : 'person'} using it. The records remain. This cannot be undone here.`}
	confirmLabel="Delete tag"
	formId={`${uid}-delete`}
	destructive
	pending={guard.saving}
	focusCancel
/>
