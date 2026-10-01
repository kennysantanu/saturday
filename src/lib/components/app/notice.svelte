<script lang="ts">
	import type { Snippet } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/circle-check';
	import AlertCircle from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import { cn } from '$lib/utils.js';

	let {
		tone = 'info',
		title,
		children,
		class: className
	}: {
		tone?: 'success' | 'error' | 'info';
		title?: string;
		children?: Snippet;
		class?: string;
	} = $props();

	const styles = {
		success: 'border-success/30 bg-success-soft text-foreground',
		error: 'border-destructive/30 bg-destructive/5 text-foreground',
		info: 'border-border bg-card text-foreground'
	};
	const iconStyles = { success: 'text-success', error: 'text-destructive', info: 'text-primary' };
</script>

<!-- Error notices are focused programmatically (tabindex -1) after a failed save. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	role={tone === 'error' ? 'alert' : 'status'}
	tabindex={tone === 'error' ? -1 : undefined}
	class={cn(
		'flex items-start gap-3 rounded-[var(--r-group)] border px-4 py-3 text-sm',
		styles[tone],
		className
	)}
>
	<span class={cn('mt-0.5 shrink-0', iconStyles[tone])}>
		{#if tone === 'success'}
			<CheckCircle2 class="size-4" />
		{:else if tone === 'error'}
			<AlertCircle class="size-4" />
		{:else}
			<Info class="size-4" />
		{/if}
	</span>
	<div class="min-w-0 space-y-0.5">
		{#if title}<p class="font-medium">{title}</p>{/if}
		{#if children}<div class="text-muted-foreground">{@render children()}</div>{/if}
	</div>
</div>
