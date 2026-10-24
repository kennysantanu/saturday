<script lang="ts">
	import type { Tag } from '$lib/tag-types';
	import TagChip from './tag-chip.svelte';
	let { tags = [], limit = 2 }: { tags?: Tag[]; limit?: number } = $props();
</script>

{#if tags.length}<div class="flex min-w-0 flex-wrap items-center gap-2" aria-label="Tags">
		{#each tags.slice(0, limit) as tag (tag.id)}<TagChip
				{tag}
			/>{/each}{#if tags.length > limit}<span class="text-sm text-muted-foreground"
				>+{tags.length - limit} more</span
			>{/if}
	</div>{/if}
