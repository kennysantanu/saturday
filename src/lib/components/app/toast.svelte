<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { toast } from '$lib/toast.svelte';
	const icons = { success: CircleCheck, error: CircleAlert, info: Info };
</script>

<!-- Two always-mounted live regions announce only the message text (never the buttons). -->
<div class="sr-only" role="status" aria-live="polite">{toast.announcement.polite}</div>
<div class="sr-only" role="alert">{toast.announcement.assertive}</div>

{#if toast.items.length}
	<div
		class="toast-region"
		role="group"
		aria-label="Notifications"
		onpointerenter={() => toast.pause()}
		onpointerleave={() => toast.resume()}
		onfocusin={() => toast.pause()}
		onfocusout={() => toast.resume()}
	>
		{#each toast.items as item (item.id)}
			{@const Icon = icons[item.tone]}
			<div class="toast glass-surface" data-tone={item.tone}>
				<Icon class="size-5" aria-hidden="true" />
				<span>{item.text}</span>
				{#if item.action}
					{@const action = item.action}
					<Button
						variant="ghost"
						size="sm"
						onclick={async () => {
							// Read the action first: dismissing clears it.
							const { run } = action;
							toast.dismiss(item.id);
							await run();
						}}>{action.label}</Button
					>
				{/if}
				<Button
					variant="ghost"
					size="icon"
					aria-label="Dismiss message"
					title="Dismiss"
					onclick={() => toast.dismiss(item.id)}><X class="size-4" /></Button
				>
			</div>
		{/each}
	</div>
{/if}
