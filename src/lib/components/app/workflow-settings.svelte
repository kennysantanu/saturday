<script lang="ts">
	import { stageJobsUrl } from '$lib/job-search.js';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Pencil from '@lucide/svelte/icons/pencil';
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
	const groups = $derived([
		{
			key: 'open',
			title: 'Open stages',
			stages: stages.filter((stage) => !stage.is_closed && !stage.is_archived)
		},
		{
			key: 'closed',
			title: 'Closed stages',
			stages: stages.filter((stage) => stage.is_closed && !stage.is_archived)
		},
		{
			key: 'archived',
			title: 'Archived stages',
			stages: stages.filter((stage) => stage.is_archived)
		}
	]);
	// A row opens for editing from the URL (works without JavaScript) or after a failed save.
	const editing = $derived(page.url.searchParams.get('edit_stage'));
	const isOpen = (stage: Stage) =>
		editing === String(stage.id) || failed.stage_id === String(stage.id);
	function rowValue(stage: Stage) {
		return failed.stage_id === String(stage.id) && failed.kind === 'rename'
			? failed.name
			: stage.name;
	}
</script>

<SectionCard
	id="workflow"
	title="Workflow"
	description="Choose the stages in your job search. Changes apply immediately without a restart."
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
		{#each groups as group (group.key)}
			{#if group.stages.length}
				<div class="space-y-2">
					<h3 class="stage-group-title">{group.title} ({group.stages.length})</h3>
					<ol class="stage-list" aria-label={group.title}>
						{#each group.stages as stage (stage.id)}
							<li id={'workflow-stage-' + stage.id}>
								<div class="stage-row">
									<div class="stage-name">
										<p class="font-medium">
											{stage.name}
											<span class="meta-text font-normal text-muted-foreground"
												>{stage.is_starting ? ' · Starting stage' : ''}{stage.is_closed
													? ' · Closed'
													: ''}{stage.is_archived ? ' · Archived' : ''}</span
											>
										</p>
										{#if !stage.is_archived}<a href={stageJobsUrl(stage.id)} class="link text-sm"
												>{stage.job_count} current {stage.job_count === 1 ? 'job' : 'jobs'}</a
											>{/if}
									</div>
									<div class="stage-actions">
										{#if !stage.is_archived}
											{#each ['up', 'down'] as direction}
												<form
													method="POST"
													action="?/workflow#workflow"
													use:enhance={enhanceWithFocus}
												>
													<input type="hidden" name="kind" value="reorder" /><input
														type="hidden"
														name="stage_id"
														value={stage.id}
													/><input type="hidden" name="direction" value={direction} />
													<Button
														type="submit"
														variant="ghost"
														size="icon"
														class="size-11"
														disabled={direction === 'up' ? !stage.can_up : !stage.can_down}
														title={direction === 'up' ? 'Move up' : 'Move down'}
														aria-label={(direction === 'up' ? 'Move up: ' : 'Move down: ') +
															stage.name}
													>
														{#if direction === 'up'}<ChevronUp
																aria-hidden="true"
															/>{:else}<ChevronDown aria-hidden="true" />{/if}
													</Button>
												</form>
											{/each}
										{:else}
											<form
												method="POST"
												action="?/workflow#workflow"
												use:enhance={enhanceWithFocus}
											>
												<input type="hidden" name="kind" value="restore" /><input
													type="hidden"
													name="stage_id"
													value={stage.id}
												/>
												<Button type="submit" variant="outline">Restore stage</Button>
											</form>
										{/if}
										{#if !stage.is_archived}
											<Button
												variant="ghost"
												class="h-11"
												href={isOpen(stage)
													? '?#workflow-stage-' + stage.id
													: '?edit_stage=' + stage.id + '#workflow-stage-' + stage.id}
												aria-expanded={isOpen(stage)}
												aria-controls={'stage-panel-' + stage.id}
												data-sveltekit-noscroll
												data-sveltekit-replacestate
											>
												<Pencil data-icon="inline-start" aria-hidden="true" /><span
													class="max-sm:sr-only">{isOpen(stage) ? 'Close' : 'Edit'}</span
												><span class="sr-only"> stage {stage.name}</span>
											</Button>
										{/if}
									</div>
								</div>
								{#if !stage.is_archived && isOpen(stage)}
									<div class="stage-panel" id={'stage-panel-' + stage.id}>
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
										<form
											method="POST"
											action="?/workflow#workflow"
											use:enhance={enhanceWithFocus}
											class="space-y-3 border-t border-border pt-4"
										>
											<input type="hidden" name="kind" value="archive" /><input
												type="hidden"
												name="stage_id"
												value={stage.id}
											/>
											{#if stage.job_count > 0}<p class="text-sm text-muted-foreground">
													Move the current jobs to other stages before archiving. Archiving retains
													history.
												</p>{/if}
											<div class="form-actions">
												<Button type="submit" variant="outline" disabled={stage.job_count > 0}
													>Archive stage</Button
												>
											</div>
										</form>
									</div>
								{/if}
							</li>
						{/each}
					</ol>
				</div>
			{/if}
		{/each}
		<details class="disclosure disclosure-quiet" open={failed.kind === 'add'}>
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
