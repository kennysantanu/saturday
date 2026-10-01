<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Field from './field.svelte';
	import NativeSelect from './native-select.svelte';
	import Notice from './notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { focusFirstError } from '$lib/forms';
	import { UPDATE_CHOICES } from '$lib/status';

	type Entry = {
		id: string;
		eventType: string | null;
		label: string;
		date: string;
		note: string | null;
	};
	type FormValues = Record<string, string | undefined>;
	type FormErrors = Record<string, string | undefined>;
	let {
		entry,
		errors = {},
		values = {}
	}: { entry: Entry; errors?: FormErrors; values?: FormValues } = $props();

	let open = $state(false);
	let confirmingRemove = $state(false);
	let eventType = $state('');

	const isCurrentForm = $derived(values.update_id === entry.id);
	const ownErrors = $derived(isCurrentForm ? errors : {});
	const fieldValue = (name: string, fallback: string) =>
		isCurrentForm ? (values[name] ?? fallback) : fallback;

	// A failed correction reopens its own dialog so the error is next to the fields.
	$effect(() => {
		if (isCurrentForm && Object.keys(errors).length > 0) open = true;
	});
	$effect(() => {
		if (open) eventType = fieldValue('event_type', entry.eventType ?? '');
		else confirmingRemove = false;
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon"
				class="-my-2 -mr-2 shrink-0 text-muted-foreground"
				aria-label="Edit update: {entry.label}"
				title="Edit update"><Pencil class="size-4" /></Button
			>
		{/snippet}
	</Dialog.Trigger>

	<Dialog.Content class="sm:max-w-md">
		<form
			method="POST"
			action="?/correctUpdate"
			use:enhance={() =>
				async ({ result, update }) => {
					await update();
					if (result.type === 'redirect') {
						open = false;
						return;
					}
					confirmingRemove = false;
					await tick();
					focusFirstError();
				}}
			class="grid gap-5"
		>
			<input type="hidden" name="update_id" value={entry.id} />
			{#if confirmingRemove}
				<Dialog.Header>
					<Dialog.Title>Remove this update?</Dialog.Title>
					<Dialog.Description>
						“{entry.label}” will be removed from History. This cannot be undone.
					</Dialog.Description>
				</Dialog.Header>
				<Dialog.Footer>
					<Button type="button" variant="ghost" onclick={() => (confirmingRemove = false)}
						>Keep update</Button
					>
					<Button type="submit" name="remove" value="1" variant="destructive"
						><Trash2 data-icon="inline-start" />Remove update</Button
					>
				</Dialog.Footer>
			{:else}
				<Dialog.Header>
					<Dialog.Title>Edit update</Dialog.Title>
					<Dialog.Description>Correct the details, or remove it from History.</Dialog.Description>
				</Dialog.Header>
				{#if ownErrors.form}<Notice tone="error" title="The change was not saved"
						>{ownErrors.form}</Notice
					>{/if}
				<Field id="correction_type_{entry.id}" label="What happened?" error={ownErrors.event_type}>
					{#snippet control(attrs)}
						<NativeSelect {...attrs} name="event_type" bind:value={eventType}>
							<option value="">Note</option>
							{#each UPDATE_CHOICES.filter((choice) => choice.value !== 'note') as choice (choice.value)}
								<option value={choice.value}>{choice.label}</option>
							{/each}
						</NativeSelect>
					{/snippet}
				</Field>
				<Field id="correction_date_{entry.id}" label="Date" error={ownErrors.event_date}>
					{#snippet control(attrs)}<Input
							{...attrs}
							name="event_date"
							type="date"
							value={fieldValue('event_date', entry.date)}
						/>{/snippet}
				</Field>
				<Field id="correction_note_{entry.id}" label="Note" error={ownErrors.note}>
					{#snippet control(attrs)}<Textarea
							{...attrs}
							name="note"
							rows={3}
							value={fieldValue('note', entry.note ?? '')}
						/>{/snippet}
				</Field>
				<Dialog.Footer>
					<Button
						type="button"
						variant="ghost"
						class="text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto"
						onclick={() => (confirmingRemove = true)}
						><Trash2 data-icon="inline-start" />Remove</Button
					>
					<Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
					<Button type="submit">Save correction</Button>
				</Dialog.Footer>
			{/if}
		</form>
	</Dialog.Content>
</Dialog.Root>
