<script lang="ts">
	import { setTheme, theme } from '$lib/theme.svelte';
	import SectionCard from './section-card.svelte';
	import Field from './field.svelte';
	import NativeSelect from './native-select.svelte';
</script>

<SectionCard
	id="appearance"
	title="Appearance"
	description="Choose how Saturday looks in this browser. Changes apply immediately."
>
	<Field id="theme" label="Theme" hint="System follows this device’s light or dark appearance.">
		{#snippet control(attrs)}
			<NativeSelect
				{...attrs}
				value={theme.preference}
				disabled={!theme.ready || !theme.storageAvailable}
				onchange={(event) => setTheme(event.currentTarget.value)}
			>
				<option value="system">System</option>
				<option value="light">Light</option>
				<option value="dark">Dark</option>
			</NativeSelect>
		{/snippet}
	</Field>
	{#if !theme.storageAvailable}
		<p role="status" class="text-sm text-muted-foreground">
			Browser storage is unavailable. Following your system theme.
		</p>
	{/if}
	<noscript
		><p class="text-sm text-muted-foreground">
			Enable JavaScript to choose a theme. Saturday follows your system theme.
		</p></noscript
	>
</SectionCard>
