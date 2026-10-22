<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { focusFirstError, withPending } from '$lib/forms';
	import { UnsavedChanges } from '$lib/unsaved.svelte';
	import UnsavedDialog from './unsaved-dialog.svelte';
	import Field from './field.svelte';
	import Notice from './notice.svelte';
	import Pagination from './pagination.svelte';
	import RadioOption from './radio-option.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import UserPlus from '@lucide/svelte/icons/user-plus';

	type Person = { id: number; name: string; role?: string | null; organization?: string | null };
	let {
		data,
		form
	}: {
		data: {
			job: { id: number; title: string; company: string };
			selectedPerson: Person | null;
			personPicker: { networks: Person[]; page: number; totalPages: number } | null;
			linkedPersonIds: number[];
			returnTo: string;
			networkQuery: Record<string, string>;
			networkErrors: object;
		};
		form?: {
			action: string;
			errors?: Record<string, string>;
			values?: Record<string, string>;
		} | null;
	} = $props();
	let open = $state(true);
	const guard = new UnsavedChanges();
	let selected = $state<Person | null>(untrack(() => data.selectedPerson ?? null));
	let note = $state('');
	let browsing = $state(false);
	const errors = $derived(form?.action === 'network-linked' ? (form.errors ?? {}) : {});
	const unavailable = $derived(!!selected && data.linkedPersonIds.includes(selected.id));
	const invalidSearch = $derived(Object.keys(data.networkErrors).length > 0);
	const choices = $derived(
		selected && !data.personPicker?.networks.some((person) => person.id === selected?.id)
			? [selected, ...(data.personPicker?.networks ?? [])]
			: (data.personPicker?.networks ?? [])
	);

	function href(changes: Record<string, string | number | null> = {}) {
		const query = new URLSearchParams(page.url.searchParams);
		for (const key of [...query.keys()])
			if (key.startsWith('/') || key === 'saved') query.delete(key);
		for (const [key, value] of Object.entries(changes)) {
			if (value === null || value === '') query.delete(key);
			else query.set(key, String(value));
		}
		return page.url.pathname + (query.size ? '?' + query : '');
	}
	function closeHref() {
		return href({
			link_person: null,
			person: null,
			person_page: null,
			person_query: null
		});
	}
	$effect(() => {
		if (!open) {
			guard.dirty = false;
			void goto(untrack(closeHref), { replaceState: true, noScroll: true, keepFocus: true });
		}
	});
	$effect(() => {
		if (form?.action !== 'network-linked' || !form.errors) return;
		note = form.values?.notes ?? '';
		const candidates: Person[] = untrack(() =>
			[selected, data.selectedPerson, ...(data.personPicker?.networks ?? [])].filter(
				(person): person is Person => person !== null
			)
		);
		selected = candidates.find((person) => String(person.id) === form.values?.network_id) ?? null;
	});
	async function navigate(address: string) {
		browsing = true;
		guard.saving = true;
		try {
			await goto(address, { noScroll: true, keepFocus: true });
		} finally {
			browsing = false;
			guard.saving = false;
		}
	}
	function search(event: SubmitEvent) {
		event.preventDefault();
		const fields = new FormData(event.currentTarget as HTMLFormElement);
		void navigate(
			href({
				person_page: null,
				person_query: String(fields.get('person_query') ?? '')
			})
		);
	}
	function select(person: Person) {
		selected = person;
		guard.markDirty();
	}

	function action() {
		const query = new URLSearchParams(page.url.searchParams);
		for (const key of [...query.keys()]) if (key.startsWith('/')) query.delete(key);
		return '?/networkLink&' + query;
	}
	const save: SubmitFunction = () => {
		guard.saving = true;
		return async ({ result, update }) => {
			if (result.type === 'redirect' || result.type === 'success') guard.dirty = false;
			await update({ reset: false });
			guard.saving = false;
			await tick();
			focusFirstError();
		};
	};
</script>

<UnsavedDialog bind:open {guard}>
	{#snippet children(close)}
		<Dialog.Content class="person-picker sm:max-w-lg">
			<Dialog.Header>
				<Dialog.Title>Link person</Dialog.Title>
				<Dialog.Description
					>Choose someone from your network and add an optional note.</Dialog.Description
				>
			</Dialog.Header>
			<div class="person-picker-body space-y-5">
				<form method="GET" action={`/jobs/${data.job.id}`} onsubmit={search} class="space-y-3">
					{#if invalidSearch}<Notice tone="error" title="Check the search or page values"
							>{Object.values(data.networkErrors).join(' ')}</Notice
						>{/if}
					<input type="hidden" name="link_person" value="1" />
					<input type="hidden" name="return_to" value={data.returnTo} />
					<Field id="person_query" label="Search people">
						{#snippet control(attrs)}<Input
								{...attrs}
								type="search"
								name="person_query"
								maxlength={200}
								placeholder="Name, role or organization"
								value={data.networkQuery.person_query ?? ''}
							/>{/snippet}
					</Field>
					<div class="flex flex-wrap gap-2">
						<Button type="submit" variant="outline" disabled={guard.saving}>Search people</Button>
						<Button
							href={`/networks/new?${new URLSearchParams({ job_id: String(data.job.id), return_to: data.returnTo })}`}
							variant="ghost"
							disabled={guard.saving}><UserPlus data-icon="inline-start" />Add person</Button
						>
					</div>
				</form>
				<form
					id="job-person-link"
					method="POST"
					action={action()}
					use:enhance={withPending(save, () => {
						guard.saving = false;
					})}
					class="space-y-5"
					oninput={guard.markDirty}
				>
					<input type="hidden" name="network_id" value={selected?.id ?? ''} />
					{#if errors.form || errors.network_id}<Notice tone="error" title="Could not link person"
							>{errors.form || errors.network_id}</Notice
						>{/if}
					<fieldset class="space-y-2">
						<legend class="mb-2 text-sm font-medium"
							>Person <span class="text-destructive" aria-hidden="true">*</span></legend
						>
						<div class="person-picker-results space-y-2">
							{#each choices as person (person.id)}
								<RadioOption
									name="person_choice"
									required={!selected}
									value={person.id}
									checked={selected?.id === person.id}
									disabled={data.linkedPersonIds.includes(person.id) || guard.saving}
									onchange={() => select(person)}
									label={`${person.name} #${person.id}`}
									description={[
										person.role,
										person.organization,
										data.linkedPersonIds.includes(person.id) ? 'Already linked' : null
									]
										.filter(Boolean)
										.join(' · ')}
								/>
							{/each}
						</div>
						{#if !data.personPicker?.networks.length}<p class="text-sm text-muted-foreground">
								No matching people. Add a person or change the search.
							</p>{/if}
					</fieldset>
					{#if data.personPicker}<Pagination
							label="Person picker pages"
							page={data.personPicker.page}
							totalPages={data.personPicker.totalPages}
							compact
							previous={guard.saving
								? null
								: () => navigate(href({ person_page: (data.personPicker?.page ?? 1) - 1 }))}
							next={guard.saving
								? null
								: () => navigate(href({ person_page: (data.personPicker?.page ?? 1) + 1 }))}
						/>{/if}
					{#if unavailable}<Notice tone="error" title="Already linked"
							>This person is already linked to this job. Choose someone else.</Notice
						>{/if}
					<Field
						id="new_network_relationship_note"
						label="Relationship note"
						hint="Optional. Describe this person's connection to this job."
						error={errors.notes}
					>
						{#snippet control(attrs)}<Textarea
								{...attrs}
								name="notes"
								maxlength={2000}
								rows={3}
								bind:value={note}
							/>{/snippet}
					</Field>
				</form>
			</div>
			<Dialog.Footer>
				<Button type="button" variant="ghost" disabled={guard.saving} onclick={close}>Cancel</Button
				>
				<Button
					type="submit"
					form="job-person-link"
					disabled={!selected || unavailable || guard.saving}
					>{guard.saving && !browsing ? 'Linking…' : 'Link person'}</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	{/snippet}
</UnsavedDialog>
