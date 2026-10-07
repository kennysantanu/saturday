<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Field from './field.svelte';
	import Checkbox from './checkbox.svelte';
	import NativeSelect from './native-select.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';

	/**
	 * The fields shared by Add job and Edit job, so the two forms cannot drift apart. `value`
	 * holds each field's current text; `detailsOpen` opens the optional section.
	 */
	let {
		value,
		starred,
		errors,
		mode,
		detailsOpen
	}: {
		value: Record<string, string | null | undefined>;
		starred: boolean;
		errors: Record<string, string | undefined>;
		mode: 'add' | 'edit';
		detailsOpen: boolean;
	} = $props();
	const text = (name: string) => value[name] ?? '';
</script>

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
					placeholder={mode === 'add' ? 'Product Designer' : undefined}
					autocomplete="off"
					value={text('job_title')}
				/>
			{/snippet}
		</Field>
		<Field id="company_name" label="Company" required error={errors.company_name}>
			{#snippet control(attrs)}
				<Input
					{...attrs}
					name="company_name"
					placeholder={mode === 'add' ? 'Northwind Labs' : undefined}
					autocomplete="off"
					value={text('company_name')}
				/>
			{/snippet}
		</Field>
		<Field id="posting_url" label="Job posting link" error={errors.posting_url}>
			{#snippet control(attrs)}
				<Input
					{...attrs}
					name="posting_url"
					type="url"
					inputmode="url"
					placeholder="https://"
					value={text('posting_url')}
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
				<Textarea {...attrs} name="job_description" rows={6} value={text('job_description')} />
			{/snippet}
		</Field>
		<Field id="notes" label="Job notes" hint="Your own notes about this job." error={errors.notes}>
			{#snippet control(attrs)}
				<Textarea {...attrs} name="notes" rows={4} value={text('notes')} />
			{/snippet}
		</Field>
		<input type="hidden" name="is_starred" value="0" />
		<Checkbox
			name="is_starred"
			value="1"
			label="Star this job"
			checked={starred}
			class="font-medium"
		/>
	</Card.Content>
</Card.Root>

<details class="disclosure group" open={detailsOpen}>
	<summary>
		More details
		<ChevronDown class="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
	</summary>
	<div class="disclosure-body">
		<div class="grid gap-5 sm:grid-cols-2">
			<Field id="employment_type" label="Employment type" error={errors.employment_type}>
				{#snippet control(attrs)}
					<NativeSelect {...attrs} name="employment_type" value={text('employment_type')}>
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
					<NativeSelect {...attrs} name="work_arrangement" value={text('work_arrangement')}>
						<option value="">Not specified</option>
						<option value="remote">Remote</option>
						<option value="hybrid">Hybrid</option>
						<option value="on-site">On-site</option>
					</NativeSelect>
				{/snippet}
			</Field>
			<Field id="location" label="Location" error={errors.location}>
				{#snippet control(attrs)}
					<Input {...attrs} name="location" type="text" maxlength={200} value={text('location')} />
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
						value={text('compensation')}
					/>
				{/snippet}
			</Field>
			<Field id="source" label="Source" error={errors.source}>
				{#snippet control(attrs)}
					<Input {...attrs} name="source" type="text" maxlength={200} value={text('source')} />
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
						value={text('application_deadline')}
					/>
				{/snippet}
			</Field>
			<Field id="follow_up_date" label="Follow-up date" error={errors.follow_up_date}>
				{#snippet control(attrs)}
					<Input {...attrs} name="follow_up_date" type="date" value={text('follow_up_date')} />
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
							value={text('follow_up_comment')}
						/>
					{/snippet}
				</Field>
			</div>
		</div>
	</div>
</details>
