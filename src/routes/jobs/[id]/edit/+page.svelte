<script lang="ts">
	import { enhance } from '$app/forms';
	import JobFields from '$lib/components/app/job-fields.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import UnsavedGuard from '$lib/components/app/unsaved-guard.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { UnsavedChanges } from '$lib/unsaved.svelte';

	let { data, form } = $props();
	const job = $derived(data.job);
	const errors = $derived(form?.errors ?? {});
	const values = $derived(form?.values ?? {});
	const guard = new UnsavedChanges();
	// A failed save keeps what was typed; otherwise each field starts from the saved job.
	const current = $derived({
		job_title: values.job_title ?? job.title,
		company_name: values.company_name ?? job.company,
		posting_url: values.posting_url ?? job.postingUrl,
		job_description: values.job_description ?? job.description,
		notes: values.notes ?? job.notes,
		employment_type: values.employment_type ?? job.employmentType,
		work_arrangement: values.work_arrangement ?? job.workArrangement,
		location: values.location ?? job.location,
		compensation: values.compensation ?? job.compensation,
		source: values.source ?? job.source,
		application_deadline: values.application_deadline ?? job.applicationDeadline,
		follow_up_date: values.follow_up_date ?? job.followUpDate,
		follow_up_comment: values.follow_up_comment ?? job.followUpComment
	});
	const starred = $derived(
		values.is_starred !== undefined ? values.is_starred === '1' : Boolean(job.isStarred)
	);
</script>

<PageShell title={`Edit ${job.title}`} width="form">
	<PageHeader
		back={{ href: `/jobs/${job.id}?return_to=${encodeURIComponent(data.returnTo)}`, label: 'job' }}
		title="Edit job"
		description="Update the details Saturday keeps for this job."
	/>

	{#if errors.form}<Notice tone="error" title="Changes were not saved">{errors.form}</Notice>{/if}

	<form method="POST" use:enhance={guard.enhance} oninput={guard.markDirty} class="space-y-6">
		<JobFields value={current} {starred} {errors} mode="edit" detailsOpen />
		<div class="form-actions justify-end">
			<Button
				href={'/jobs/' + job.id + '?return_to=' + encodeURIComponent(data.returnTo)}
				variant="ghost"
				size="lg">Cancel</Button
			>
			<Button type="submit" size="lg">Save changes</Button>
		</div>
	</form>
</PageShell>
<UnsavedGuard {guard} />
