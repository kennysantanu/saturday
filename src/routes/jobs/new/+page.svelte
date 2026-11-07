<script lang="ts">
	import { enhance } from '$app/forms';
	import JobFields from '$lib/components/app/job-fields.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import UnsavedGuard from '$lib/components/app/unsaved-guard.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { jobDetailUrl } from '$lib/job-navigation.js';
	import { UnsavedChanges } from '$lib/unsaved.svelte';

	let { data, form } = $props();
	const errors = $derived(form?.errors ?? {});
	const values = $derived(form?.values ?? {});
	const guard = new UnsavedChanges();
	let dismissedWarning = $state.raw<unknown>(null);
	const showDuplicates = $derived(
		Boolean(form?.duplicateJobs?.length && dismissedWarning !== form)
	);
	function keepEditing(event: MouseEvent) {
		event.preventDefault();
		dismissedWarning = form;
		document.getElementById('job_title')?.focus();
	}
	const detailKeys = [
		'employment_type',
		'work_arrangement',
		'location',
		'compensation',
		'source',
		'application_deadline'
	];
</script>

<PageShell title="Add job" width="form">
	<PageHeader
		back={{
			href: data.returnTo,
			label: data.person
				? data.person.name
				: data.returnTo.startsWith('/jobs')
					? 'Jobs'
					: 'Dashboard'
		}}
		title="Add job"
		description={data.person
			? `Start with the title and company. You can link ${data.person.name} next.`
			: 'Start with the title and company. You can add more later.'}
	/>

	{#if errors.form}
		<Notice tone="error" title="The job was not saved">{errors.form}</Notice>
	{:else if Object.keys(errors).length > 0}
		<Notice tone="error" title="Check the highlighted fields" />
	{/if}

	<form
		method="POST"
		use:enhance={guard.enhance}
		oninput={() => {
			guard.markDirty();
			dismissedWarning = form;
		}}
		class="space-y-6"
	>
		<JobFields
			tagData={{
				...data.tagOptions,
				selectedTags: form?.tagSelection ?? data.tagOptions.selectedTags
			}}
			value={values}
			starred={values.is_starred === '1'}
			{errors}
			mode="add"
			detailsOpen={detailKeys.some((key) => errors[key])}
		/>
		{#if showDuplicates}
			<Notice tone="error" title="A similar job already exists">
				<p>
					Review these jobs before creating another. Your entries have been kept; this job has not
					been saved.
				</p>
				<ul class="my-3 space-y-3">
					{#each form!.duplicateJobs! as job (job.id)}
						<li class="space-y-1">
							<a class="link font-medium break-words" href={jobDetailUrl(job.id, data.returnTo)}>
								Open existing job #{job.id}: {job.title}
							</a>
							<p class="break-words">
								{job.company} · {job.location || 'Location not set'} · {job.stage}
							</p>
							<p>
								{job.reason === 'matching_posting_url'
									? 'Same posting link'
									: 'Same title and company; location matches or is not set'}
							</p>
						</li>
					{/each}
				</ul>
				{#if form!.duplicateTotal! > form!.duplicateJobs!.length}
					<p>Showing {form!.duplicateJobs!.length} of {form!.duplicateTotal} possible matches.</p>
				{/if}
				<Button href="#job_title" variant="ghost" onclick={keepEditing}>Keep editing</Button>
			</Notice>
		{/if}
		<div class="form-actions justify-end">
			<Button href={data.returnTo} variant="ghost" size="lg">Cancel</Button>
			<Button
				type="submit"
				variant={showDuplicates ? 'outline' : 'default'}
				size="lg"
				disabled={guard.saving}>Save job</Button
			>
			{#if showDuplicates}
				<Button type="submit" name="allow_duplicate" value="true" size="lg" disabled={guard.saving}
					>Create anyway</Button
				>
			{/if}
		</div>
	</form>
</PageShell>
<UnsavedGuard {guard} />
