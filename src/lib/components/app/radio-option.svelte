<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLInputAttributes } from 'svelte/elements';
	import Check from '@lucide/svelte/icons/check';

	/**
	 * One choice in a list of radio options, drawn as a solid selectable row.
	 *
	 * Pass `initial` (text) or `icon` (a snippet, such as a file icon) for the record-picker card used
	 * by Link person, Link to job and the Profile document picker: a mark tile, `label` with its
	 * record `number`, a `description` line and optional `badges`. The radio
	 * is then visually hidden but stays the focusable, accessible control, and selection shows as a
	 * tint and a check mark.
	 */
	let {
		label,
		description,
		initial,
		icon,
		number,
		badges,
		...restProps
	}: Omit<HTMLInputAttributes, 'type'> & {
		label: string;
		description?: string;
		initial?: string;
		icon?: Snippet;
		number?: number;
		badges?: Snippet;
	} = $props();
</script>

{#if initial !== undefined || icon}
	<label class="picker-option">
		<input type="radio" {...restProps} />
		<span class="row-mark picker-mark" aria-hidden="true"
			>{#if icon}{@render icon()}{:else}{initial}{/if}</span
		>
		<span class="picker-text">
			<span class="picker-title"
				>{label}
				{#if number !== undefined}<span
						class="meta-text font-normal whitespace-nowrap text-muted-foreground">#{number}</span
					>{/if}</span
			>
			{#if description}<span class="picker-meta">{description}</span>{/if}
		</span>
		{#if badges}<span class="picker-badges">{@render badges()}</span>{/if}
		<Check class="picker-check size-5" aria-hidden="true" />
	</label>
{:else}
	<label class="radio-option">
		<input type="radio" class="mt-1 size-4 shrink-0 accent-primary" {...restProps} />
		<span class="min-w-0 text-sm break-words"
			>{label}{#if description}<span class="block text-muted-foreground">{description}</span
				>{/if}</span
		>
	</label>
{/if}
