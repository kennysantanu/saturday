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

	let { form } = $props();
	const errors = $derived(form?.errors ?? {});
	const values = $derived(form?.values ?? {});
</script>

<svelte:head><title>Add job · Saturday</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-8">
	<div class="space-y-4">
		<a href="/jobs" class="back-link"><ArrowLeft class="size-4" />Back to Jobs</a>
		<PageHeader
			title="Add job"
			description="Start with the title and company. You can add more later."
		/>
	</div>

	{#if errors.form}
		<Notice tone="error" title="The job was not saved">{errors.form}</Notice>
	{:else if Object.keys(errors).length > 0}
		<Notice tone="error" title="Check the highlighted fields" />
	{/if}

	<form method="POST" use:enhance={enhanceWithFocus} class="space-y-6">
		<p class="text-sm text-muted-foreground">
			<span class="text-destructive" aria-hidden="true">*</span> Required
		</p>
		<Card.Root>
			<Card.Content class="space-y-5 py-2">
				<Field id="job_title" label="Job title" required error={errors.job_title}>
					{#snippet control(attrs)}
						<Input
							{...attrs}
							name="job_title"
							placeholder="Product Designer"
							autocomplete="off"
							value={values.job_title ?? ''}
						/>
					{/snippet}
				</Field>

				<Field id="company_name" label="Company" required error={errors.company_name}>
					{#snippet control(attrs)}
						<Input
							{...attrs}
							name="company_name"
							placeholder="Northwind Labs"
							autocomplete="off"
							value={values.company_name ?? ''}
						/>
					{/snippet}
				</Field>
			</Card.Content>
		</Card.Root>

		<details
			class="disclosure group"
			open={Boolean(errors.posting_url || errors.job_description || errors.notes)}
		>
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
							inputmode="url"
							placeholder="https://"
							value={values.posting_url ?? ''}
						/>
					{/snippet}
				</Field>

				<Field
					id="job_description"
					label="Job description"
					hint="Paste the text from the posting. It is stored as plain text."
					error={errors.job_description}
				>
					{#snippet control(attrs)}
						<Textarea
							{...attrs}
							name="job_description"
							rows={6}
							value={values.job_description ?? ''}
						/>
					{/snippet}
				</Field>

				<Field
					id="notes"
					label="Job notes"
					hint="Your own notes about this job."
					error={errors.notes}
				>
					{#snippet control(attrs)}
						<Textarea {...attrs} name="notes" rows={4} value={values.notes ?? ''} />
					{/snippet}
				</Field>
			</div>
		</details>

		<div class="form-actions flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
			<Button href="/jobs" variant="ghost" size="lg">Cancel</Button>
			<Button type="submit" size="lg">Save job</Button>
		</div>
	</form>
</div>
