<script lang="ts">
	import Field from './field.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { normalizeTagName, displayTagName, tagColorPattern } from '$lib/tags.js';
	import TagChip from './tag-chip.svelte';
	let {
		name = $bindable(''),
		color = $bindable('#64748b'),
		errors = {},
		prefix = 'tag',
		onenter
	}: {
		name?: string;
		color?: string;
		errors?: Record<string, string>;
		prefix?: string;
		onenter?: () => void;
	} = $props();
	const normalized = $derived(normalizeTagName(name));
	const hex = $derived(/^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : '#64748b');
</script>

<p class="text-sm text-muted-foreground">
	<span class="text-destructive" aria-hidden="true">*</span> Required
</p>
<Field
	id={`${prefix}-name`}
	label="Tag name"
	required
	hint="Letters and numbers only; spaces separate words. Names are saved in lowercase."
	error={errors.name}
>
	{#snippet control(attrs)}<Input
			{...attrs}
			bind:value={name}
			autocomplete="off"
			maxlength={200}
			onkeydown={(event) => {
				if (event.key === 'Enter' && onenter) {
					event.preventDefault();
					onenter();
				}
			}}
		/>{/snippet}
</Field>
<div class="grid grid-cols-[4.5rem_1fr] gap-4">
	<Field id={`${prefix}-color`} label="Color">
		{#snippet control(attrs)}<Input
				{...attrs}
				type="color"
				value={hex}
				oninput={(event) => (color = event.currentTarget.value)}
				class="h-11 w-full cursor-pointer p-1"
			/>{/snippet}
	</Field>
	<Field id={`${prefix}-hex`} label="Hex color" required error={errors.color}>
		{#snippet control(attrs)}<Input
				{...attrs}
				bind:value={color}
				maxlength={7}
				spellcheck={false}
				onkeydown={(event) => {
					if (event.key === 'Enter' && onenter) {
						event.preventDefault();
						onenter();
					}
				}}
			/>{/snippet}
	</Field>
</div>
{#if normalized && normalized.length <= 50}<div aria-label="Tag preview">
		<TagChip
			tag={{
				id: 0,
				name: normalized,
				display_name: displayTagName(normalized),
				color: tagColorPattern.test(hex) ? hex : '#64748b'
			}}
		/>
	</div>{/if}
