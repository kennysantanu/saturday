<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { toast } from '$lib/toast.svelte';
</script>

<!-- The live region stays mounted so assistive technology announces each new message. -->
<div role="status" aria-live="polite">
	{#if toast.message}
		<div class="toast glass-surface">
			<CircleCheck class="size-5" aria-hidden="true" />
			<span>{toast.message}</span>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Dismiss message"
				title="Dismiss"
				onclick={() => toast.dismiss()}><X class="size-4" /></Button
			>
		</div>
	{/if}
</div>
