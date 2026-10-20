<script lang="ts">
	import { enhance } from '$app/forms';
	import SectionCard from './section-card.svelte';
	import Field from './field.svelte';
	import Checkbox from './checkbox.svelte';
	import Notice from './notice.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import UnsavedGuard from './unsaved-guard.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { UnsavedChanges } from '$lib/unsaved.svelte';
	import { enhanceWithFocus } from '$lib/forms';
	type Stage = {
		id: number;
		name: string;
		is_closed: boolean;
		is_archived: boolean;
		is_starting: boolean;
		is_referenced: boolean;
		job_count: number;
		can_up: boolean;
		can_down: boolean;
	};
	let {
		stages,
		unavailable,
		form
	}: {
		stages: Stage[];
		unavailable?: string | null;
		form?: {
			workflowError?: string;
			workflowErrors?: Record<string, string>;
			workflowValues?: Record<string, string>;
			workflowConfirm?: Record<string, string>;
			workflowSaved?: boolean;
		};
	} = $props();
	const guard = new UnsavedChanges();
	let confirming = $state(false);
	const pending = $derived(form?.workflowConfirm);
	$effect(() => {
		confirming = !!pending;
	});
	const failed = $derived(form?.workflowValues ?? {});
	const errors = $derived(form?.workflowErrors ?? {});
	function rowValue(stage: Stage) {
		return failed.stage_id === String(stage.id) && failed.kind === 'rename'
			? failed.name
			: stage.name;
	}
</script>

<SectionCard
	id="workflow"
	title="Workflow"
	description="Choose the stages in your job search. Open stages appear first; closed destinations follow. Changes apply immediately without a restart."
>
	{#if unavailable}<Notice tone="error" title="Workflow unavailable">{unavailable}</Notice>{:else}
		<p class="text-sm text-muted-foreground">
			The first open stage starts new jobs. Ordering guides your workflow; jobs can skip stages or
			move backward. Change stage on job detail closes or reopens a job according to its
			destination.
		</p>
		{#if form?.workflowError}<Notice tone="error" title="Workflow was not saved"
				>{form.workflowError}</Notice
			>{/if}
		{#if form?.workflowSaved}<Notice tone="success" title="Workflow saved"
				>Stage names, order and availability are updated across Jobs and Dashboard. Refresh other
				open clients to see the changes.</Notice
			>{/if}
		{#if pending}
			<form
				id="workflow-confirm"
				method="POST"
				action="?/workflow#workflow"
				use:enhance={enhanceWithFocus}
			>
				{#each Object.entries(pending) as [key, value]}{#if key !== 'confirm_starting_stage'}<input
							type="hidden"
							name={key}
							{value}
						/>{/if}{/each}
				<input type="hidden" name="confirm_starting_stage" value="1" />
				<noscript
					><Notice title="Confirm starting-stage change"
						>This changes where future jobs start. Existing jobs and history stay where they are. <Button
							type="submit">Confirm change</Button
						></Notice
					></noscript
				>
			</form>
			<ConfirmDialog
				bind:open={confirming}
				title="Change the starting stage?"
				description="This action changes where future jobs start. Existing jobs and their history stay in their current stages."
				confirmLabel="Confirm change"
				formId="workflow-confirm"
			/>
		{/if}
		<ol class="space-y-4" aria-label="Workflow stages">
			{#each stages as stage (stage.id)}
				<li
					class="space-y-3 rounded-[var(--r-group)] border border-border p-4"
					id={'workflow-stage-' + stage.id}
				>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<p class="font-medium break-words">
							{stage.name}
							<span class="meta-text font-normal text-muted-foreground"
								>{stage.is_starting ? ' · Starting stage' : ''}{stage.is_closed
									? ' · Closed'
									: ''}{stage.is_archived ? ' · Archived' : ''}</span
							>
						</p>
						<a
							href={'/jobs?view=all&current_stage=' + stage.id}
							class="link text-sm"
							hidden={stage.is_archived}
							>{stage.job_count} current {stage.job_count === 1 ? 'job' : 'jobs'}</a
						>
					</div>
					<div class="flex flex-wrap gap-2">
						{#if !stage.is_archived}
							{#each ['up', 'down'] as direction}
								<form method="POST" action="?/workflow#workflow" use:enhance={enhanceWithFocus}>
									<input type="hidden" name="kind" value="reorder" /><input
										type="hidden"
										name="stage_id"
										value={stage.id}
									/><input type="hidden" name="direction" value={direction} />
									<Button
										type="submit"
										variant="outline"
										size="sm"
										disabled={direction === 'up' ? !stage.can_up : !stage.can_down}
										aria-label={(direction === 'up' ? 'Move up: ' : 'Move down: ') + stage.name}
										>{direction === 'up' ? 'Up' : 'Down'}</Button
									>
								</form>
							{/each}
						{/if}
						<form method="POST" action="?/workflow#workflow" use:enhance={enhanceWithFocus}>
							<input
								type="hidden"
								name="kind"
								value={stage.is_archived ? 'restore' : 'archive'}
							/><input type="hidden" name="stage_id" value={stage.id} />
							<Button
								type="submit"
								variant="outline"
								size="sm"
								disabled={!stage.is_archived && stage.job_count > 0}
								>{stage.is_archived ? 'Restore stage' : 'Archive stage'}</Button
							>
						</form>
					</div>
					{#if !stage.is_archived && stage.job_count > 0}<p class="text-sm text-muted-foreground">
							Move the current jobs to other stages before archiving. Archiving retains history.
						</p>{/if}
					<details class="disclosure" open={failed.stage_id === String(stage.id)}>
						<summary>Edit stage</summary>
						<div class="disclosure-body space-y-4">
							<form
								method="POST"
								action="?/workflow#workflow"
								use:enhance={guard.enhance}
								oninput={guard.markDirty}
								class="space-y-3"
							>
								<input type="hidden" name="kind" value="rename" />
								<p class="meta-text">* Required</p>
								<input type="hidden" name="stage_id" value={stage.id} />
								<Field
									id={'workflow-name-' + stage.id}
									label="Stage name"
									required
									error={failed.stage_id === String(stage.id) ? errors.name : undefined}
								>
									{#snippet control(attrs)}<Input
											{...attrs}
											name="name"
											value={rowValue(stage)}
											maxlength={80}
										/>{/snippet}
								</Field>
								<div class="form-actions">
									<Button type="submit" variant="outline">Save name</Button>
								</div>
							</form>
							<form
								method="POST"
								action="?/workflow#workflow"
								use:enhance={enhanceWithFocus}
								class="space-y-3"
							>
								<input type="hidden" name="kind" value="closure" /><input
									type="hidden"
									name="stage_id"
									value={stage.id}
								/>
								<Checkbox
									name="is_closed"
									value="1"
									checked={stage.is_closed}
									disabled={stage.is_referenced}
									label="Closes the job"
								/>
								<p class="text-sm text-muted-foreground">
									{stage.is_referenced
										? 'Locked because jobs or history reference this stage. Create a replacement stage to change this behavior.'
										: 'Jobs in a closed stage are no longer being pursued. Changing this does not depend on the stage name.'}
								</p>
								<div class="form-actions">
									<Button type="submit" variant="outline" disabled={stage.is_referenced}
										>Save stage behavior</Button
									>
								</div>
							</form>
						</div>
					</details>
				</li>
			{/each}
		</ol>
		<details class="disclosure" open={failed.kind === 'add'}>
			<summary>Add stage</summary>
			<form
				method="POST"
				action="?/workflow#workflow"
				use:enhance={guard.enhance}
				oninput={guard.markDirty}
				class="disclosure-body space-y-4"
			>
				<input type="hidden" name="kind" value="add" />
				<p class="meta-text">* Required</p>
				<Field
					id="workflow-new-name"
					label="Stage name"
					required
					error={failed.kind === 'add' ? errors.name : undefined}
				>
					{#snippet control(attrs)}<Input
							{...attrs}
							name="name"
							maxlength={80}
							value={failed.kind === 'add' ? failed.name : ''}
						/>{/snippet}
				</Field>
				<Checkbox
					name="is_closed"
					value="1"
					checked={failed.kind === 'add' && failed.is_closed === '1'}
					label="Closes the job"
				/>
				<p class="text-sm text-muted-foreground">
					New stages are added at the end of their open or closed type. Names must be unique among
					available stages, ignoring case. Restore an archived stage to retain its identity; rename
					it first if its name is already in use.
				</p>
				<div class="form-actions"><Button type="submit">Add stage</Button></div>
			</form>
		</details>
	{/if}
</SectionCard>
<UnsavedGuard {guard} />
