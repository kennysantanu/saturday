<script lang="ts">
	import Field from './field.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { normalizeTagName, displayTagName, tagColorPattern, tagPalette } from '$lib/tags.js';
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
	hint="Letters and numbers only. Spaces separate words. Names are saved in lowercase."
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
<div role="group" aria-label="Color choices" class="space-y-1">
	<p class="text-sm font-medium">Color</p>
	<div class="flex flex-wrap gap-1">
		{#each tagPalette as swatch (swatch.color)}
			<button
				type="button"
				class="swatch"
				style:--swatch={swatch.color}
				aria-label={swatch.name}
				aria-pressed={hex === swatch.color}
				title={swatch.name}
				onclick={() => (color = swatch.color)}
			></button>
		{/each}
	</div>
</div>
<div class="grid grid-cols-[7rem_1fr] gap-4">
	<Field id={`${prefix}-color`} label="Custom color">
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

<style>
	/* 44px target around a 28px swatch; the ring shows the current color. */
	.swatch {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 999px;
		cursor: pointer;
	}
	.swatch::before {
		content: '';
		width: 28px;
		height: 28px;
		border-radius: 999px;
		background: var(--swatch);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--foreground) 22%, transparent);
	}
	.swatch[aria-pressed='true']::before {
		box-shadow:
			0 0 0 2px var(--card),
			0 0 0 4px var(--foreground);
	}
	.swatch:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 0;
	}
	@media (forced-colors: active) {
		.swatch::before {
			forced-color-adjust: none;
		}
		.swatch[aria-pressed='true']::before {
			box-shadow:
				0 0 0 2px Canvas,
				0 0 0 4px Highlight;
		}
	}
</style>
