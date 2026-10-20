<script lang="ts">
	import Field from './field.svelte';
	import NativeSelect from './native-select.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	type Stage = { id: number; name: string; is_archived: boolean; is_closed: boolean };
	let {
		stages,
		prefix,
		moving = false,
		currentStageId,
		today,
		values = {},
		errors = {}
	}: {
		stages: Stage[];
		prefix: string;
		moving?: boolean;
		currentStageId?: number;
		today: string;
		values?: Record<string, string | undefined>;
		errors?: Record<string, string | undefined>;
	} = $props();
	let selected = $state('');
	$effect(() => {
		selected = values.stage_id ?? '';
	});
	const destination = $derived(stages.find((stage) => String(stage.id) === selected));
</script>

<Field
	id={prefix + '-stage'}
	label={moving ? 'Destination stage' : 'Milestone or general note'}
	required={moving}
	error={errors.stage_id}
>
	{#snippet control(attrs)}<NativeSelect {...attrs} name="stage_id" bind:value={selected}>
			<option value="">{moving ? 'Choose a stage' : 'General note'}</option>
			{#each [false, true] as closed}
				<optgroup label={closed ? 'Closed destinations' : 'Open progression'}>
					{#each stages.filter((stage) => stage.is_closed === closed && (!moving || !stage.is_archived)) as stage (stage.id)}
						<option value={String(stage.id)} disabled={moving && stage.id === currentStageId}
							>{stage.name}{stage.is_archived ? ' · Archived' : ''}{moving &&
							stage.id === currentStageId
								? ' · Current'
								: ''}</option
						>
					{/each}
				</optgroup>
			{/each}
		</NativeSelect>{/snippet}
</Field>
{#if moving && destination}<p class="text-sm text-muted-foreground">
		{destination.is_closed
			? 'This closes the job. Its follow-up is retained and hidden from Dashboard attention.'
			: 'This makes the job active.'} A milestone is recorded with this change.
	</p>{/if}
<Field
	id={prefix + '-date'}
	label="Date"
	required
	hint={moving
		? 'Takes effect immediately; choose today or a past date.'
		: 'Future dates are scheduled milestones; they count in milestone history.'}
	error={errors.event_date}
>
	{#snippet control(attrs)}<Input
			{...attrs}
			name="event_date"
			type="date"
			value={values.event_date ?? today}
			max={moving ? today : undefined}
		/>{/snippet}
</Field>
<Field id={prefix + '-note'} label="Note" required={!moving && !selected} error={errors.note}>
	{#snippet control(attrs)}<Textarea
			{...attrs}
			name="note"
			value={values.note ?? ''}
			rows={3}
			maxlength={10000}
		/>{/snippet}
</Field>
