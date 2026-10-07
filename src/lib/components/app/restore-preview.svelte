<script lang="ts">
	import type { Snippet } from 'svelte';

	/** What a restore will change: current records beside the result, then its warnings and actions. */
	let {
		title,
		rows,
		columns = ['Current', 'Backup'],
		children
	}: {
		title: string;
		rows: { label: string; current: string | number; incoming: string | number }[];
		columns?: [string, string];
		children?: Snippet;
	} = $props();
</script>

<div class="inset-surface space-y-3 p-4" role="status">
	<h3 class="font-medium">{title}</h3>
	<table class="w-full text-sm">
		<caption class="sr-only">{title}</caption>
		<thead>
			<tr class="text-muted-foreground">
				<th scope="col" class="py-1.5 text-left font-medium">Record</th>
				<th scope="col" class="py-1.5 text-right font-medium">{columns[0]}</th>
				<th scope="col" class="py-1.5 text-right font-medium">{columns[1]}</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.label)}
				<tr class="border-t">
					<th scope="row" class="py-1.5 text-left font-normal">{row.label}</th>
					<td class="py-1.5 text-right tabular-nums">{row.current}</td>
					<td class="py-1.5 text-right tabular-nums">{row.incoming}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{@render children?.()}
</div>
