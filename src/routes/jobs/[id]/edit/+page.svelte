<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { enhance } from '$app/forms';
	import Field from '$lib/components/app/field.svelte';
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { enhanceWithFocus } from '$lib/forms';

	let { data, form } = $props();
	const job = $derived(data.job);
	const errors = $derived(form?.errors ?? {});
	const values = $derived(form?.values ?? {});
</script>

<svelte:head><title>Edit {job.title} · Saturday</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-8">
	<div class="space-y-4">
		<a href="/jobs/{job.id}" class="back-link"><ArrowLeft class="size-4" />Back to job</a>
		<PageHeader title="Edit job" description="Update the details Saturday keeps for this job." />
	</div>

	{#if errors.form}<Notice tone="error" title="Changes were not saved">{errors.form}</Notice>{/if}

	<form method="POST" use:enhance={enhanceWithFocus} class="space-y-6">
		<p class="text-sm text-muted-foreground">
			<span class="text-destructive" aria-hidden="true">*</span> Required
		</p>
		<Card.Root>
			<Card.Content class="space-y-5 py-2">
				<Field id="job_title" label="Job title" required error={errors.job_title}>
					{#snippet control(attrs)}
						<Input {...attrs} name="job_title" value={values.job_title ?? job.title} />
					{/snippet}
				</Field>

				<Field id="company_name" label="Company" required error={errors.company_name}>
					{#snippet control(attrs)}
						<Input {...attrs} name="company_name" value={values.company_name ?? job.company} />
					{/snippet}
				</Field>
				<Field id="posting_url" label="Job posting link" error={errors.posting_url}>
					{#snippet control(attrs)}
						<Input
							{...attrs}
							name="posting_url"
							type="url"
							value={values.posting_url ?? job.postingUrl ?? ''}
						/>
					{/snippet}
				</Field>

				<Field
					id="job_description"
					label="Job description"
					hint="Stored as plain text."
					error={errors.job_description}
				>
					{#snippet control(attrs)}
						<Textarea
							{...attrs}
							name="job_description"
							rows={6}
							value={values.job_description ?? job.description ?? ''}
						/>
					{/snippet}
				</Field>

				<Field id="notes" label="Job notes" error={errors.notes}>
					{#snippet control(attrs)}
						<Textarea {...attrs} name="notes" rows={4} value={values.notes ?? job.notes ?? ''} />
					{/snippet}
				</Field>
				<input type="hidden" name="is_starred" value="0" />
				<label class="flex items-center gap-3 text-sm font-medium">
					<input
						type="checkbox"
						name="is_starred"
						value="1"
						class="size-4 accent-primary"
						checked={values.is_starred !== undefined
							? values.is_starred === '1'
							: Boolean(job.isStarred)}
					/>
					Star this job
				</label>
			</Card.Content>
		</Card.Root>

		<details class="disclosure group" open>
			<summary class="[&::-webkit-details-marker]:hidden">
				More details
				<ChevronDown
					class="size-4 text-muted-foreground transition-transform group-open:rotate-180"
				/>
			</summary>
			<div class="disclosure-body">
				<div class="grid gap-5 sm:grid-cols-2">
					<Field id="employment_type" label="Employment type" error={errors.employment_type}>
						{#snippet control(attrs)}
							<NativeSelect
								{...attrs}
								name="employment_type"
								value={values.employment_type ?? job.employmentType ?? ''}
							>
								<option value="">Not specified</option>
								<option value="full-time">Full-time</option>
								<option value="part-time">Part-time</option>
								<option value="contract">Contract</option>
								<option value="internship">Internship</option>
								<option value="temporary">Temporary</option>
							</NativeSelect>
						{/snippet}
					</Field>
					<Field id="work_arrangement" label="Work arrangement" error={errors.work_arrangement}>
						{#snippet control(attrs)}
							<NativeSelect
								{...attrs}
								name="work_arrangement"
								value={values.work_arrangement ?? job.workArrangement ?? ''}
							>
								<option value="">Not specified</option>
								<option value="remote">Remote</option>
								<option value="hybrid">Hybrid</option>
								<option value="on-site">On-site</option>
							</NativeSelect>
						{/snippet}
					</Field>
					<Field id="location" label="Location" error={errors.location}>
						{#snippet control(attrs)}
							<Input
								{...attrs}
								name="location"
								type="text"
								maxlength={200}
								value={values.location ?? job.location ?? ''}
							/>
						{/snippet}
					</Field>
					<Field
						id="compensation"
						label="Compensation"
						error={errors.compensation}
						hint="For example, $120k–$150k/year + equity."
					>
						{#snippet control(attrs)}
							<Input
								{...attrs}
								name="compensation"
								type="text"
								maxlength={1000}
								value={values.compensation ?? job.compensation ?? ''}
							/>
						{/snippet}
					</Field>
					<Field id="source" label="Source" error={errors.source}>
						{#snippet control(attrs)}
							<Input
								{...attrs}
								name="source"
								type="text"
								maxlength={200}
								value={values.source ?? job.source ?? ''}
							/>
						{/snippet}
					</Field>
					<Field
						id="application_deadline"
						label="Application deadline"
						error={errors.application_deadline}
					>
						{#snippet control(attrs)}
							<Input
								{...attrs}
								name="application_deadline"
								type="date"
								value={values.application_deadline ?? job.applicationDeadline ?? ''}
							/>
						{/snippet}
					</Field>
					<Field id="follow_up_date" label="Follow-up date" error={errors.follow_up_date}>
						{#snippet control(attrs)}
							<Input
								{...attrs}
								name="follow_up_date"
								type="date"
								value={values.follow_up_date ?? job.followUpDate ?? ''}
							/>
						{/snippet}
					</Field>
					<div class="sm:col-span-2">
						<Field
							id="follow_up_comment"
							label="Follow-up comment"
							error={errors.follow_up_comment}
							hint="Set a follow-up date to add a comment. Clear the date to remove the follow-up."
						>
							{#snippet control(attrs)}
								<Textarea
									{...attrs}
									name="follow_up_comment"
									rows={3}
									maxlength={10000}
									value={values.follow_up_comment ?? job.followUpComment ?? ''}
								/>
							{/snippet}
						</Field>
					</div>
				</div>
			</div>
		</details>

		<div class="form-actions flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
			<Button href="/jobs/{job.id}" variant="ghost" size="lg">Cancel</Button>
			<Button type="submit" size="lg">Save changes</Button>
		</div>
	</form>
</div>
