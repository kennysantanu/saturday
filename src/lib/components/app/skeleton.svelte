<script lang="ts">
	import { cn } from '$lib/utils.js';

	let { class: className }: { class?: string } = $props();
</script>

<div aria-hidden="true" class={cn('animate-pulse rounded-lg bg-muted', className)}></div>
