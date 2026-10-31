<script lang="ts">
	import { enhance } from '$app/forms';
	import { withPending, focusFirstError } from '$lib/forms';
	import { tick } from 'svelte';
	import { waitForRecentViews } from '$lib/recents';
	import SectionCard from './section-card.svelte';
	import Field from './field.svelte';
	import NativeSelect from './native-select.svelte';
	import Checkbox from './checkbox.svelte';
	import Notice from './notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		settings,
		error,
		message
	}: {
		settings: { enabled: boolean; limit: number } | null;
		error?: string;
		message?: string;
	} = $props();
</script>

<SectionCard
	id="navigation"
	title="Navigation"
	description="Recently viewed is shared across devices accessing this Saturday workspace."
>
	<h3 class="text-sm font-medium">Recently viewed</h3>
	{#if !settings}<Notice tone="error"
			>Navigation settings are unavailable. Repair storage before changing recently viewed.</Notice
		>{/if}
	{#if error}<Notice tone="error">{error}</Notice>{/if}
	{#if message}<Notice tone="success">{message}</Notice>{/if}
	{#if settings}
		<form
			method="POST"
			action="?/navigation"
			use:enhance={withPending(async () => {
				await waitForRecentViews();
				return async ({ update }) => {
					await update();
					await tick();
					focusFirstError();
				};
			})}
			class="space-y-4"
		>
			<Checkbox
				name="enabled"
				value="1"
				checked={settings.enabled}
				label="Enable recently viewed"
				aria-describedby="recents-enabled-hint"
			/>
			<p id="recents-enabled-hint" class="text-sm text-muted-foreground">
				Turning this off hides Recent and stops recording views. Existing history stays until
				cleared.
			</p>
			<Field id="recent-limit" label="Items per list" hint="Applies to both Jobs and People.">
				{#snippet control(attrs)}
					<NativeSelect {...attrs} name="limit" value={String(settings.limit)}>
						<option value="5">5</option>
						<option value="10">10</option>
						<option value="20">20</option>
					</NativeSelect>
				{/snippet}
			</Field>
			<Button type="submit">Save navigation settings</Button>
		</form>
		<div class="space-y-2 border-t pt-4">
			<form
				method="POST"
				action="?/navigation"
				use:enhance={withPending(async () => {
					await waitForRecentViews();
					return async ({ update }) => {
						await update();
						await tick();
						focusFirstError();
					};
				})}
			>
				<input type="hidden" name="kind" value="clear" />
				<Button type="submit" variant="outline">Clear recently viewed</Button>
			</form>
			<p class="text-sm text-muted-foreground">
				Clears both lists across devices. Jobs and people are kept.
			</p>
		</div>
	{/if}
</SectionCard>
