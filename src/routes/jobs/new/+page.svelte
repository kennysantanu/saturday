<script lang="ts">
	import { enhance } from '$app/forms';
	import JobFields from '$lib/components/app/job-fields.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import UnsavedGuard from '$lib/components/app/unsaved-guard.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { UnsavedChanges } from '$lib/unsaved.svelte';

	let { form } = $props();
	const errors = $derived(form?.errors ?? {});
	const values = $derived(form?.values ?? {});
	const guard = new UnsavedChanges();
	const detailKeys = [
		'employment_type',
		'work_arrangement',
		'location',
		'compensation',
		'source',
		'application_deadline',
		'follow_up_date',
		'follow_up_comment'
	];
</script>

<PageShell title="Add job" width="form">
	<PageHeader
		back={{ href: '/jobs', label: 'Jobs' }}
		title="Add job"
		description="Start with the title and company. You can add more later."
	/>

	{#if errors.form}
		<Notice tone="error" title="The job was not saved">{errors.form}</Notice>
	{:else if Object.keys(errors).length > 0}
		<Notice tone="error" title="Check the highlighted fields" />
	{/if}

	<form method="POST" use:enhance={guard.enhance} oninput={guard.markDirty} class="space-y-6">
		<JobFields
			value={values}
			starred={values.is_starred === '1'}
			{errors}
			mode="add"
			detailsOpen={detailKeys.some((key) => errors[key])}
		/>
		<div class="form-actions justify-end">
			<Button href="/jobs" variant="ghost" size="lg">Cancel</Button>
			<Button type="submit" size="lg">Save job</Button>
		</div>
	</form>
</PageShell>
<UnsavedGuard {guard} />
