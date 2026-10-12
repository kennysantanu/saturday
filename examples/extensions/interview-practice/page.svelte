<script lang="ts">
	import {
		PageShell,
		PageHeader,
		SectionCard,
		Field,
		Notice,
		FilterBar,
		Pagination,
		ConfirmDialog,
		UnsavedGuard,
		UnsavedChanges,
		Button,
		Input,
		Textarea,
		enhance
	} from '$lib/extension-ui.js';
	import Plus from '@lucide/svelte/icons/plus';
	let { data, form } = $props();
	const guard = new UnsavedChanges();
	let question = $state(''),
		answer = $state(''),
		practice = $state(false),
		reveal = $state(false),
		deleting = $state(false);
	$effect(() => {
		question = form?.values?.question ?? data.selected?.question ?? '';
		answer = form?.values?.answer ?? data.selected?.answer ?? '';
		guard.dirty = Boolean(form?.values);
		practice = false;
		reveal = false;
	});
	const href = (page: number) =>
		`?${new URLSearchParams({ query: data.query, page: String(page) })}`;
</script>

<PageShell title="Interview Practice">
	<PageHeader
		title="Interview Practice"
		description="Build your question bank and practice answering."
		back={{ href: '/extensions', label: 'extensions' }}
	>
		{#snippet actions()}<Button href="?new=1"><Plus data-icon="inline-start" />Add question</Button
			>{/snippet}
	</PageHeader>
	{#if form?.extensionError}<Notice tone="error" title="The question was not saved"
			>{form.extensionError}</Notice
		>{/if}
	<FilterBar
		action=""
		label="Search interview questions"
		clearHref="?"
		applyLabel="Search"
		showClear={Boolean(data.query)}
		><Field id="question_query" label="Search questions"
			>{#snippet control(attrs)}<Input
					{...attrs}
					name="query"
					value={data.query}
				/>{/snippet}</Field
		></FilterBar
	>
	<SectionCard title="Question bank" count={data.total}>
		{#if !data.questions.length}<p class="text-sm text-muted-foreground">
				No questions yet. Add a question to start practicing.
			</p>{/if}
		<ul class="divide-y divide-border">
			{#each data.questions as q (q.id)}<li class="py-3">
					<a
						class="link break-words"
						href={`?${new URLSearchParams({ query: data.query, page: String(data.page), question: String(q.id) })}`}
						>#{q.id} · {q.question}</a
					>
				</li>{/each}
		</ul>
		<Pagination
			label="Question pages"
			page={data.page}
			totalPages={data.totalPages}
			previous={href(data.page - 1)}
			next={href(data.page + 1)}
		/>
	</SectionCard>
	{#if data.selected || data.new}
		<SectionCard title={data.selected ? `Question #${data.selected.id}` : 'Add question'}>
			{#if data.selected}<div class="flex flex-wrap gap-2">
					<Button
						variant="outline"
						disabled={guard.dirty}
						onclick={() => {
							practice = !practice;
							reveal = false;
							answer = practice ? '' : data.selected.answer;
						}}>{practice ? 'Stop practice' : 'Practice'}</Button
					><Button variant="outline" onclick={() => (deleting = true)}>Delete question</Button>
				</div>{/if}
			{#if practice}<p class="font-medium">{data.selected.question}</p>
				<Button variant="outline" onclick={() => (reveal = !reveal)}
					>{reveal ? 'Hide saved answer' : 'Show saved answer'}</Button
				>{#if reveal}<pre class="inset-surface p-4 whitespace-pre-wrap">{data.selected.answer ||
							'No saved answer.'}</pre>{/if}{/if}
			<form method="POST" action="?/run" use:enhance={guard.enhance} class="space-y-5">
				<input type="hidden" name="data_token" value={data.selected?.data_token ?? ''} /><input
					type="hidden"
					name="operation"
					value={data.selected ? 'edit' : 'create'}
				/><input type="hidden" name="id" value={data.selected?.id ?? ''} /><input
					type="hidden"
					name="revision"
					value={data.selected?.revision ?? ''}
				/>
				<p class="text-sm text-muted-foreground">
					<span class="text-destructive" aria-hidden="true">*</span> Required
				</p>
				{#if !practice}<Field id="question_text" label="Question" required
						>{#snippet control(attrs)}<Textarea
								{...attrs}
								name="question"
								bind:value={question}
								oninput={guard.markDirty}
								maxlength={10000}
								required
							/>{/snippet}</Field
					>{/if}
				<Field id="answer_text" label={practice ? 'Practice answer' : 'Saved answer'}
					>{#snippet control(attrs)}<Textarea
							{...attrs}
							name="answer"
							bind:value={answer}
							oninput={guard.markDirty}
							maxlength={50000}
						/>{/snippet}</Field
				>
				<div class="form-actions justify-end">
					<Button variant="ghost" href="?">Cancel</Button><Button
						type="submit"
						disabled={guard.saving}
						>{guard.saving ? 'Saving…' : practice ? 'Save answer' : 'Save question'}</Button
					>
				</div>
			</form>
		</SectionCard>
	{/if}
</PageShell>
<form id="delete-question" method="POST" action="?/run" use:enhance={guard.enhance}>
	<input type="hidden" name="data_token" value={data.selected?.data_token ?? ''} /><input
		type="hidden"
		name="operation"
		value="delete"
	/><input type="hidden" name="id" value={data.selected?.id ?? ''} /><input
		type="hidden"
		name="revision"
		value={data.selected?.revision ?? ''}
	/><input type="hidden" name="confirm" value="true" />
</form>
<ConfirmDialog
	bind:open={deleting}
	title="Delete question?"
	description="The question and its saved answer will be permanently removed."
	confirmLabel="Delete question"
	formId="delete-question"
	destructive
/>
<UnsavedGuard {guard} />
