<script lang="ts">
	import { enhance } from '$app/forms';
	import Notice from '$lib/components/app/notice.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import PersonFields from '$lib/components/app/person-fields.svelte';
	import UnsavedGuard from '$lib/components/app/unsaved-guard.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { UnsavedChanges } from '$lib/unsaved.svelte';
	import { jobDetailUrl } from '$lib/job-navigation.js';

	let { data, form } = $props();
	const values = $derived(form?.values ?? {});
	const errors = $derived(form?.errors ?? {});
	const back = $derived(
		data.job
			? { href: jobDetailUrl(data.job.id, data.returnTo), label: 'job' }
			: { href: '/networks', label: 'Network' }
	);
	const guard = new UnsavedChanges();
</script>

<PageShell title="Add person · Network" width="form">
	<PageHeader {back} title="Add person" description="Name is all you need to get started." />
	{#if data.missingJob}
		<Notice title="The originating job is no longer available"
			>You can still save this person in Network.</Notice
		>
	{/if}
	{#if errors.form}
		<Notice tone="error" title="Person not saved">{errors.form}</Notice>
	{:else if Object.keys(errors).length}
		<Notice tone="error" title="Check the highlighted fields" />
	{/if}
	<form method="POST" use:enhance={guard.enhance} oninput={guard.markDirty} class="space-y-6">
		<PersonFields value={values} {errors} withFollowUp />
		<div class="form-actions justify-end">
			<Button href={back.href} variant="ghost" size="lg">Cancel</Button>
			<Button type="submit" size="lg">Save person</Button>
		</div>
	</form>
</PageShell>
<UnsavedGuard {guard} />
