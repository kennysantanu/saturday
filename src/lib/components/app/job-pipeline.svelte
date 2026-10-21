<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { navigating } from '$app/state';
	import { onMount, tick } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Button } from '$lib/components/ui/button/index.js';
	import Pagination from './pagination.svelte';
	import { jobDetailUrl } from '$lib/job-navigation.js';
	import { pipelineHref } from '$lib/job-pipeline.js';

	type Column = {
		id: number;
		name: string;
		total: number;
		page: number;
		totalPages: number;
		jobs: { id: number; title: string; company: string }[];
	};
	let { columns, startStageId }: { columns: Column[]; startStageId: number | null } = $props();
	let board: HTMLDivElement;
	let capacity = $state(1);
	let focusStageId = $state<number | null>(null);
	const loading = $derived(navigating.to?.url.pathname === '/');
	const visibleCount = $derived(Math.min(capacity, columns.length));
	const firstIndex = $derived.by(() => {
		const requested = Math.max(
			0,
			columns.findIndex((column) => column.id === startStageId)
		);
		const lastStart = Math.max(0, columns.length - visibleCount);
		let start = Math.min(requested, lastStart);
		const target = columns.findIndex((column) => column.id === focusStageId);
		if (target >= 0) {
			if (target < start) start = target;
			else if (target >= start + visibleCount) start = target - visibleCount + 1;
		}
		return Math.min(start, lastStart);
	});
	const visibleColumns = $derived(columns.slice(firstIndex, firstIndex + visibleCount));
	const firstStageId = $derived(columns[firstIndex]?.id);

	function stageHref(index: number) {
		const column = columns[index];
		return pipelineHref(columns, column.id, column.page, column.id).replace(
			/#.*$/,
			'#job-pipeline'
		);
	}

	onMount(() => {
		const measure = () => {
			// Match the CSS gap and minimum readable column width, with one stage on phones.
			capacity = window.matchMedia('(min-width: 48rem)').matches
				? Math.max(1, Math.floor((board.clientWidth + 12) / (256 + 12)))
				: 1;
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(board);
		return () => observer.disconnect();
	});

	afterNavigate(({ to, complete }) => {
		if (!to || to.url.pathname !== '/') return;
		const match = to.url.hash.match(/^#pipeline-stage-([1-9]\d*)$/);
		focusStageId = match ? Number(match[1]) : null;
		if (!match) return;
		void complete.then(async () => {
			await tick();
			requestAnimationFrame(() => {
				if (location.pathname !== '/' || location.hash !== to.url.hash) return;
				const heading = document.getElementById(`pipeline-stage-${match[1]}`);
				if (heading) {
					heading.focus({ preventScroll: true });
					heading.scrollIntoView({ block: 'nearest' });
				}
			});
		});
	});
</script>

{#if loading}<p role="status" class="text-sm text-muted-foreground">Loading pipeline…</p>{/if}
<div class="pipeline-browser" aria-busy={loading}>
	<Button
		variant="outline"
		size="icon"
		class="pipeline-arrow"
		href={firstIndex > 0 ? stageHref(firstIndex - 1) : undefined}
		disabled={firstIndex === 0}
		aria-label="Previous stages"
		title="Previous stages"
		aria-controls="pipeline-columns"
		data-sveltekit-keepfocus><ChevronLeft aria-hidden="true" /></Button
	>
	<div class="min-w-0 space-y-3">
		<div
			bind:this={board}
			id="pipeline-columns"
			class="pipeline-board"
			style={`--pipeline-columns: ${Math.max(1, visibleCount)}`}
			role="region"
			aria-label="Job pipeline stages"
		>
			{#each visibleColumns as column (column.id)}
				<section class="pipeline-column" aria-labelledby={`pipeline-stage-${column.id}`}>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<h3
						id={`pipeline-stage-${column.id}`}
						tabindex="-1"
						class="pipeline-heading text-base font-semibold"
					>
						<a href={`/jobs?view=all&current_stage=${column.id}`} class="link" title={column.name}
							>{column.name}</a
						>
						<span class="meta-text font-normal text-muted-foreground">({column.total})</span>
					</h3>
					{#if column.jobs.length}
						<ul class="pipeline-jobs" aria-label={`${column.name} jobs`}>
							{#each column.jobs as job (job.id)}
								<li>
									<a
										class="pipeline-card"
										href={jobDetailUrl(
											job.id,
											pipelineHref(columns, column.id, column.page, firstStageId)
										)}
										aria-label={`Job #${job.id}: ${job.title} at ${job.company}`}
										title={`${job.title} · ${job.company}`}
									>
										<p class="truncate text-sm font-semibold">{job.title}</p>
										<p class="truncate text-sm text-muted-foreground">{job.company}</p>
									</a>
								</li>
							{/each}
						</ul>
					{:else}
						<p
							class="rounded-[var(--r-control)] border border-dashed p-3 text-sm text-muted-foreground"
						>
							No jobs in this stage.
						</p>
					{/if}
					<Pagination
						compact
						label={`${column.name} job pages`}
						page={column.page}
						totalPages={column.totalPages}
						previous={pipelineHref(columns, column.id, column.page - 1, firstStageId)}
						next={pipelineHref(columns, column.id, column.page + 1, firstStageId)}
					/>
				</section>
			{/each}
		</div>
		<p class="meta-text text-muted-foreground" role="status">
			{visibleCount === 1 ? 'Stage' : 'Stages'}
			{firstIndex + 1}{#if visibleCount > 1}–{firstIndex + visibleCount}{/if} of {columns.length}
		</p>
	</div>
	<Button
		variant="outline"
		size="icon"
		class="pipeline-arrow"
		href={firstIndex + visibleCount < columns.length ? stageHref(firstIndex + 1) : undefined}
		disabled={firstIndex + visibleCount >= columns.length}
		aria-label="Next stages"
		title="Next stages"
		aria-controls="pipeline-columns"
		data-sveltekit-keepfocus><ChevronRight aria-hidden="true" /></Button
	>
</div>
