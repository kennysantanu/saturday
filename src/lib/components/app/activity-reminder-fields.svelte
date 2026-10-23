<script lang="ts">
	import Checkbox from './checkbox.svelte';
	import ReminderFields from './reminder-fields.svelte';
	import type { ReminderDraft } from '$lib/reminders';
	let {
		enabled = $bindable(false),
		values = $bindable(),
		errors = {},
		prefix = 'activity-reminder',
		note = ''
	}: {
		enabled?: boolean;
		values: ReminderDraft;
		errors?: Record<string, string | undefined>;
		prefix?: string;
		note?: string;
	} = $props();
</script>

<div class="space-y-5">
	<Checkbox
		label="Add reminder"
		name="add_reminder"
		bind:checked={enabled}
		onchange={(event) => {
			if ((event.currentTarget as HTMLInputElement).checked && !values.reminder_note)
				values.reminder_note = note.slice(0, 10000);
		}}
	/>
	{#if enabled}<ReminderFields bind:values {errors} {prefix} />{/if}
</div>
