<script lang="ts">
	/** Native disclosure keeps long saved content accessible without JavaScript. */
	let { text, limit = 480, lines = 8 }: { text: string; limit?: number; lines?: number } = $props();
	const preview = $derived(text.split('\n').slice(0, lines).join('\n').slice(0, limit));
</script>

{#if preview.length < text.length}
	<details class="expandable-text">
		<summary>
			<span class="expandable-preview block break-words whitespace-pre-wrap"
				>{preview.trimEnd()}…</span
			>
			<span class="expand-label">Show more</span><span class="collapse-label">Show less</span>
		</summary>
		<p class="mt-2 break-words whitespace-pre-wrap">{text}</p>
	</details>
{:else}
	<p class="break-words whitespace-pre-wrap">{text}</p>
{/if}
