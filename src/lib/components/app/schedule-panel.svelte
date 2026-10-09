<script lang="ts">
	import type { Snippet } from 'svelte';
	import { enhanceWithFocus } from '$lib/forms';
	import { enhance } from '$app/forms';
	import Checkbox from './checkbox.svelte';
	import Field from './field.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	/** Automatic-backup settings: on/off, interval, retention, and a live status block. */
	let {
		action,
		idPrefix,
		enabled,
		intervalHours,
		keepCount,
		enabledLabel,
		description,
		saveLabel,
		status,
		contents
	}: {
		action: string;
		idPrefix: string;
		enabled: boolean;
		intervalHours: number;
		keepCount: number;
		enabledLabel: string;
		description: string;
		saveLabel: string;
		status: Snippet;
		contents?: Snippet;
	} = $props();
</script>

<form method="POST" {action} use:enhance={enhanceWithFocus} class="inset-surface space-y-4 p-4">
	<Checkbox name="enabled" label={enabledLabel} checked={enabled} class="font-medium" />
	<p class="text-sm text-muted-foreground">{description}</p>
	{#if contents}{@render contents()}{/if}
	<div class="grid gap-4 sm:grid-cols-2">
		<Field id={`${idPrefix}_interval`} label="Back up every (hours)">
			{#snippet control(attrs)}
				<Input
					{...attrs}
					type="number"
					name="interval_hours"
					min="1"
					max="168"
					step="1"
					required
					value={intervalHours}
				/>
			{/snippet}
		</Field>
		<Field id={`${idPrefix}_keep`} label="Automatic backups to keep">
			{#snippet control(attrs)}
				<Input
					{...attrs}
					type="number"
					name="keep_count"
					min="1"
					max="100"
					step="1"
					required
					value={keepCount}
				/>
			{/snippet}
		</Field>
	</div>
	<div class="space-y-1 text-sm text-muted-foreground" aria-live="polite">{@render status()}</div>
	<div class="form-actions">
		<Button type="submit" variant="outline">{saveLabel}</Button>
	</div>
</form>
