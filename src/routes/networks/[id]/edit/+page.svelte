<script lang="ts">
	import { enhance } from '$app/forms';
	import Notice from '$lib/components/app/notice.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import PersonFields from '$lib/components/app/person-fields.svelte';
	import UnsavedGuard from '$lib/components/app/unsaved-guard.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { UnsavedChanges } from '$lib/unsaved.svelte';

	let { data, form } = $props();
	const values = $derived(form?.values ?? data.person);
	const errors = $derived(form?.errors ?? {});
	const back = $derived(data.back);
	const guard = new UnsavedChanges();
</script>

<PageShell title={`Edit ${data.person.name} · Network`} width="form">
	<PageHeader
		back={{ href: back, label: 'person' }}
		title="Edit details"
		description="Update this person's contact details and notes."
	/>

	{#if errors.form}
		<Notice tone="error" title="Person not saved">{errors.form}</Notice>
	{:else if Object.keys(errors).length}
		<Notice tone="error" title="Check the highlighted fields" />
	{/if}
	<form method="POST" use:enhance={guard.enhance} oninput={guard.markDirty} class="space-y-6">
		<PersonFields value={values} {errors} />
		<div class="form-actions justify-end">
			<Button href={back} variant="ghost" size="lg">Cancel</Button>
			<Button type="submit" size="lg">Save person</Button>
		</div>
	</form>
</PageShell>
<UnsavedGuard {guard} />
