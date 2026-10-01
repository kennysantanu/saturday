<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { enhance } from '$app/forms';
	import Field from '$lib/components/app/field.svelte';
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
			</div>
		</details>

		<div class="form-actions flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
			<Button href="/jobs/{job.id}" variant="ghost" size="lg">Cancel</Button>
			<Button type="submit" size="lg">Save changes</Button>
		</div>
	</form>
</div>
