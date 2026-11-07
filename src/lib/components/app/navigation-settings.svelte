<script lang="ts">
	import { enhance } from '$app/forms';
	import { withPending, focusFirstError } from '$lib/forms';
	import { tick } from 'svelte';
	import { waitForRecentViews } from '$lib/recents';
	import Field from './field.svelte';
	import NativeSelect from './native-select.svelte';
	import Checkbox from './checkbox.svelte';
	import Notice from './notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	let {
		settings,
		error
	}: {
		settings: { enabled: boolean; limit: number } | null;
		error?: string;
	} = $props();
</script>

<section id="navigation" class="settings-subsection space-y-4" aria-labelledby="navigation-heading">
	<div class="space-y-1">
		<h3 id="navigation-heading" class="text-sm font-semibold">Recently viewed</h3>
		<p class="text-sm text-muted-foreground">
			Shared across devices accessing this Saturday workspace. Changes save as you make them.
		</p>
	</div>
	{#if !settings}<Notice tone="error"
			>Navigation settings are unavailable. Repair storage before changing recently viewed.</Notice
		>{/if}
	{#if error}<Notice tone="error">{error}</Notice>{/if}
	{#if settings}
		<form
			method="POST"
			action="?/navigation"
			use:enhance={withPending(async () => {
				await waitForRecentViews();
				return async ({ update }) => {
					await update({ reset: false });
					await tick();
					focusFirstError();
				};
			})}
			onchange={(event) => event.currentTarget.requestSubmit()}
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
			<noscript><Button type="submit">Save recently viewed settings</Button></noscript>
		</form>
		<div class="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
			<p class="min-w-0 flex-1 text-sm text-muted-foreground">
				Clears both lists across devices. Jobs and people are kept.
			</p>
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
		</div>
	{/if}
</section>
