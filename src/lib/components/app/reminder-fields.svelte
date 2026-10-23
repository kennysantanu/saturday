<script lang="ts">
	import Field from './field.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { ReminderDraft } from '$lib/reminders';
	let {
		values = $bindable(),
		errors = {},
		prefix = 'reminder'
	}: {
		values: ReminderDraft;
		errors?: Record<string, string | undefined>;
		prefix?: string;
	} = $props();
</script>

<Field
	id={prefix + '-date'}
	label="Date"
	required
	error={errors.scheduled_at || errors.reminder_date}
>
	{#snippet control(attrs)}<Input
			{...attrs}
			type="date"
			name="reminder_date"
			bind:value={values.reminder_date}
		/>{/snippet}
</Field>
<Field
	id={prefix + '-time'}
	label="Time"
	hint="00:00 is midnight and is hidden on reminder cards."
	error={errors.reminder_time}
>
	{#snippet control(attrs)}<Input
			{...attrs}
			type="time"
			name="reminder_time"
			step="60"
			bind:value={values.reminder_time}
		/>{/snippet}
</Field>
<Field id={prefix + '-note'} label="Reminder note" error={errors.reminder_note}>
	{#snippet control(attrs)}<Textarea
			{...attrs}
			name="reminder_note"
			rows={3}
			maxlength={10000}
			bind:value={values.reminder_note}
		/>{/snippet}
</Field>
<p class="text-sm text-muted-foreground">
	Times stay as entered. Overdue checks use the server computer’s local time.
</p>
