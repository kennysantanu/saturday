<script lang="ts">
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	let { data, form } = $props();
</script>

<div class="space-y-6">
	<a class="back-link" href="/settings">Back to Settings</a><PageHeader
		title="Recover unmatched attachments"
		description={`Original job ID: ${data.jobId}`}
	/>{#if form?.fileError}<Notice tone="error">{form.fileError}</Notice>{/if}
	<form method="GET" class="flex gap-2">
		<Input aria-label="Search destination jobs" name="query" /><Button
			type="submit"
			variant="outline">Find job</Button
		>
	</form>
	{#each data.documents as doc}<div class="inset-surface space-y-3 p-4">
			<p class="font-medium break-all">{doc.filename}</p>
			<a class="text-sm underline" href={`/settings/files/recovery/${data.jobId}/${doc.id}`}
				>Download</a
			>
			<form method="POST" action="?/copy" class="space-y-3">
				<input type="hidden" name="id" value={doc.id} /><input
					type="hidden"
					name="token"
					value={doc.token}
				/><label class="block space-y-2 text-sm"
					><span>Destination job</span><NativeSelect name="destination_scope" required
						>{#each data.jobs as job}<option value={job.id}>{job.title} · {job.company}</option
							>{/each}</NativeSelect
					></label
				><label class="block space-y-2 text-sm"
					><span>Destination filename *</span><Input
						name="filename"
						value={doc.filename}
						required
					/></label
				><Button variant="outline" type="submit">Copy to job</Button>
			</form>
		</div>{/each}
</div>
