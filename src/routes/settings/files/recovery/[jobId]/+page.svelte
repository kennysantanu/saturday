<script lang="ts">
	import { enhance } from '$app/forms';
	import { withPending } from '$lib/forms';
	import Download from '@lucide/svelte/icons/download';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import Field from '$lib/components/app/field.svelte';
	import FilterBar from '$lib/components/app/filter-bar.svelte';
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	let { data, form } = $props();
</script>

<PageShell title="Recover attachments · Settings">
	<PageHeader
		back={{ href: '/settings#files', label: 'Settings' }}
		title="Recover unmatched attachments"
		description={`Original job ID: ${data.jobId}`}
	/>
	{#if form?.fileError}<Notice tone="error" title="The attachment was not copied"
			>{form.fileError}</Notice
		>{/if}

	<FilterBar
		label="Find destination job"
		action=""
		clearHref=""
		applyLabel="Find job"
		showClear={false}
	>
		<Field id="query" label="Search destination jobs">
			{#snippet control(attrs)}<Input {...attrs} name="query" />{/snippet}
		</Field>
	</FilterBar>

	{#each data.documents as doc (doc.id)}
		<div class="inset-surface space-y-4 p-4">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<p class="min-w-0 font-medium break-all">{doc.filename}</p>
				<Button variant="ghost" size="sm" href={`/settings/files/recovery/${data.jobId}/${doc.id}`}
					><Download data-icon="inline-start" />Download<span class="sr-only">
						{doc.filename}</span
					></Button
				>
			</div>
			<form method="POST" action="?/copy" use:enhance={withPending()} class="space-y-4">
				<input type="hidden" name="id" value={doc.id} /><input
					type="hidden"
					name="token"
					value={doc.token}
				/>
				<p class="text-sm text-muted-foreground">
					<span class="text-destructive" aria-hidden="true">*</span> Required
				</p>
				<Field id={`destination_${doc.id}`} label="Destination job" required>
					{#snippet control(attrs)}
						<NativeSelect {...attrs} name="destination_scope" required>
							{#each data.jobs as job (job.id)}<option value={job.id}
									>{job.title} · {job.company}</option
								>{/each}
						</NativeSelect>
					{/snippet}
				</Field>
				<Field id={`filename_${doc.id}`} label="Destination filename" required>
					{#snippet control(attrs)}<Input
							{...attrs}
							name="filename"
							value={doc.filename}
							required
						/>{/snippet}
				</Field>
				<div class="form-actions">
					<Button variant="outline" type="submit">Copy to job</Button>
				</div>
			</form>
		</div>
	{:else}
		<EmptyState
			size="inline"
			title="No attachments found"
			description="These files may already have been recovered."
		/>
	{/each}
</PageShell>
