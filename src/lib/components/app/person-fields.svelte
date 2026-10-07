<script lang="ts">
	import Field from './field.svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';

	/** The fields shared by Add person and Edit person. Add also offers an optional follow-up. */
	let {
		value,
		errors,
		withFollowUp = false
	}: {
		value: Record<string, string | null | undefined>;
		errors: Record<string, string | undefined>;
		withFollowUp?: boolean;
	} = $props();
	const text = (name: string) => value[name] ?? '';
</script>

<p class="text-sm text-muted-foreground">
	<span class="text-destructive" aria-hidden="true">*</span> Required
</p>
<Card.Root>
	<Card.Content class="space-y-5 py-2">
		<Field id="name" label="Name" required error={errors.name}>
			{#snippet control(attrs)}
				<Input {...attrs} name="name" type="text" maxlength={200} value={text('name')} />
			{/snippet}
		</Field>
		<Field id="role" label="Role" error={errors.role}>
			{#snippet control(attrs)}
				<Input {...attrs} name="role" type="text" maxlength={200} value={text('role')} />
			{/snippet}
		</Field>
		<Field id="organization" label="Organization" error={errors.organization}>
			{#snippet control(attrs)}
				<Input
					{...attrs}
					name="organization"
					type="text"
					maxlength={200}
					value={text('organization')}
				/>
			{/snippet}
		</Field>
		<Field id="phone" label="Phone" error={errors.phone}>
			{#snippet control(attrs)}
				<Input {...attrs} name="phone" type="tel" maxlength={100} value={text('phone')} />
			{/snippet}
		</Field>
		<Field id="email" label="Email" error={errors.email}>
			{#snippet control(attrs)}
				<Input {...attrs} name="email" type="email" maxlength={320} value={text('email')} />
			{/snippet}
		</Field>
		<Field id="link" label="Profile or website" error={errors.link}>
			{#snippet control(attrs)}
				<Input {...attrs} name="link" type="url" maxlength={2000} value={text('link')} />
			{/snippet}
		</Field>
		<Field id="notes" label="Notes" error={errors.notes}>
			{#snippet control(attrs)}
				<Textarea {...attrs} name="notes" rows={5} maxlength={20000} value={text('notes')} />
			{/snippet}
		</Field>
	</Card.Content>
</Card.Root>

{#if withFollowUp}
	<details class="disclosure" open={!!(errors.follow_up_date || errors.follow_up_comment)}>
		<summary>Follow-up (optional)</summary>
		<div class="disclosure-body space-y-5">
			<Field id="follow_up_date" label="Follow-up date" error={errors.follow_up_date}>
				{#snippet control(attrs)}
					<Input {...attrs} name="follow_up_date" type="date" value={text('follow_up_date')} />
				{/snippet}
			</Field>
			<Field
				id="follow_up_comment"
				label="Follow-up comment"
				hint="Choose a date before adding a comment."
				error={errors.follow_up_comment}
			>
				{#snippet control(attrs)}
					<Textarea
						{...attrs}
						name="follow_up_comment"
						maxlength={2000}
						value={text('follow_up_comment')}
					/>
				{/snippet}
			</Field>
		</div>
	</details>
{/if}
