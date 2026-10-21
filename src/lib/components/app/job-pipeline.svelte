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
	let { columns }: { columns: Column[] } = $props();
	let firstVisibleStageId = $state<number | null>(null);
	let ready = $state(false);
	let board: HTMLDivElement;
	let viewportWidth = $state(0);
	let boardHeight = $state(0);
	let desktop = $state(false);
	let reducedMotion = $state(false);
	let track = $state<HTMLDivElement>();
	let slide: Animation | undefined;
	let sliding = $state(false);
	let slideTarget = 0;
	let previousWindow: { index: number; count: number; width: number; offset: number } | undefined;
	const peek = $derived(desktop ? 32 : 24);
	const capacity = $derived.by(() => {
		if (!desktop) return 1;
		const fullFit = Math.max(1, Math.floor((viewportWidth + 12) / (256 + 12)));
		return fullFit >= columns.length
			? fullFit
			: Math.max(1, Math.floor((viewportWidth - 2 * (peek + 12) + 12) / (256 + 12)));
	});
	const loading = $derived(navigating.to?.url.pathname === '/');
	const visibleCount = $derived(Math.min(capacity, columns.length));
	const firstIndex = $derived(
		Math.max(
			0,
			Math.min(
				columns.findIndex((column) => column.id === firstVisibleStageId),
				columns.length - visibleCount
			)
		)
	);
	const previewStart = $derived(Math.max(0, firstIndex - 1));
	const renderedColumns = $derived(columns.slice(previewStart, firstIndex + visibleCount + 1));
	const gutter = $derived(columns.length > visibleCount ? peek + 12 : 0);
	const atEnd = $derived(firstIndex + visibleCount >= columns.length);
	const offset = $derived(firstIndex === 0 ? 0 : atEnd ? gutter * 2 : gutter);
	const previewWidth = $derived(Math.max(0, firstIndex === 0 || atEnd ? gutter * 2 - 12 : peek));
	$effect(() => {
		const current = { index: firstIndex, count: visibleCount, width: viewportWidth, offset };
		const previous = previousWindow;
		previousWindow = current;
		const remaining =
			slide?.playState === 'running' && track
				? new DOMMatrixReadOnly(getComputedStyle(track).transform).m41 - slideTarget
				: 0;
		slide?.cancel();
		sliding = false;
		if (
			!track ||
			reducedMotion ||
			!previous ||
			previous.count !== current.count ||
			previous.width !== current.width ||
			previous.index === current.index
		)
			return;
		const column = track.querySelector<HTMLElement>('.pipeline-column');
		if (!column) return;
		const distance =
			(current.index - previous.index) * (column.getBoundingClientRect().width + 12) +
			previous.offset -
			current.offset;
		slideTarget = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41;
		slide = track.animate(
			[
				{ transform: `translateX(${slideTarget + distance + remaining}px)` },
				{ transform: `translateX(${slideTarget}px)` }
			],
			{ duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
		);
		sliding = true;
		const currentSlide = slide;
		void slide.finished.then(
			() => {
				if (slide === currentSlide) sliding = false;
			},
			() => {}
		);
	});
	function browseBy(direction: number) {
		const index = firstIndex + direction;
		if (loading || index < 0 || index > columns.length - visibleCount) return;
		firstVisibleStageId = columns[index].id;
	}

	async function focusStage(stageId: number) {
		const index = columns.findIndex((column) => column.id === stageId);
		if (index < 0) return;
		if (index < firstIndex) firstVisibleStageId = stageId;
		else if (index >= firstIndex + visibleCount)
			firstVisibleStageId = columns[Math.max(0, index - visibleCount + 1)].id;
		await tick();
		return document.getElementById(`pipeline-stage-${stageId}`);
	}

	function navigateHeading(event: KeyboardEvent) {
		if (
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			(event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
		)
			return;
		const heading = (event.target as HTMLElement).closest<HTMLElement>('.pipeline-heading');
		if (!heading) return;
		event.preventDefault();
		if (loading) return;
		const current = columns.findIndex((column) => `pipeline-stage-${column.id}` === heading.id);
		const next = current + (event.key === 'ArrowRight' ? 1 : -1);
		if (next < 0 || next >= columns.length) return;
		void focusStage(columns[next].id).then((heading) => heading?.focus({ preventScroll: true }));
	}

	onMount(() => {
		ready = true;
		const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
		const motion = () => {
			reducedMotion = motionPreference.matches;
		};
		const measure = () => {
			desktop = window.matchMedia('(min-width: 48rem)').matches;
			if (viewportWidth !== board.clientWidth) boardHeight = 0;
			viewportWidth = board.clientWidth;
			// Short/empty stage windows must not pull the controls or page upward.
			boardHeight = Math.max(boardHeight, track?.getBoundingClientRect().height ?? 0);
		};
		motion();
		measure();
		motionPreference.addEventListener('change', motion);
		const observer = new ResizeObserver(measure);
		observer.observe(board);
		if (track) observer.observe(track);

		// One stage per horizontal gesture. Leave vertical scrolling and pinch zoom native.
		let gesture: { id: number; x: number; y: number; horizontal: boolean } | undefined;
		let suppressClickUntil = 0;
		const pointerDown = (event: PointerEvent) => {
			if (!event.isPrimary) {
				gesture = undefined;
				return;
			}
			if (event.pointerType === 'mouse' || loading) return;
			gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
		};
		const pointerMove = (event: PointerEvent) => {
			if (!gesture || event.pointerId !== gesture.id) return;
			const x = Math.abs(event.clientX - gesture.x);
			const y = Math.abs(event.clientY - gesture.y);
			if (!gesture.horizontal && Math.max(x, y) > 10) {
				if (x > y * 1.3) {
					gesture.horizontal = true;
					board.setPointerCapture(event.pointerId);
				} else if (y >= x) gesture = undefined;
			}
		};
		const pointerUp = (event: PointerEvent) => {
			if (!gesture || event.pointerId !== gesture.id) return;
			const { x, horizontal } = gesture;
			gesture = undefined;
			if (!horizontal) return;
			suppressClickUntil = performance.now() + 350;
			const distance = event.clientX - x;
			if (Math.abs(distance) >= 48) browseBy(distance < 0 ? 1 : -1);
		};
		const pointerCancel = () => {
			gesture = undefined;
		};
		const click = (event: MouseEvent) => {
			if (performance.now() >= suppressClickUntil) return;
			suppressClickUntil = 0;
			event.preventDefault();
			event.stopPropagation();
		};
		let wheelDistance = 0;
		let wheelMoved = false;
		let wheelReset: ReturnType<typeof setTimeout> | undefined;
		const wheel = (event: WheelEvent) => {
			if (
				event.ctrlKey ||
				Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.3 ||
				columns.length <= visibleCount
			)
				return;
			event.preventDefault();
			clearTimeout(wheelReset);
			wheelReset = setTimeout(() => {
				wheelDistance = 0;
				wheelMoved = false;
			}, 200);
			if (wheelMoved) return;
			const delta =
				event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportWidth : 1);
			if (Math.sign(delta) !== Math.sign(wheelDistance)) wheelDistance = 0;
			wheelDistance += delta;
			if (Math.abs(wheelDistance) >= 48) {
				wheelMoved = true;
				browseBy(wheelDistance > 0 ? 1 : -1);
			}
		};
		board.addEventListener('pointerdown', pointerDown);
		board.addEventListener('pointermove', pointerMove);
		board.addEventListener('pointerup', pointerUp);
		board.addEventListener('pointercancel', pointerCancel);
		board.addEventListener('click', click, true);
		board.addEventListener('wheel', wheel, { passive: false });
		board.addEventListener('keydown', navigateHeading);
		return () => {
			observer.disconnect();
			motionPreference.removeEventListener('change', motion);
			slide?.cancel();
			clearTimeout(wheelReset);
			board.removeEventListener('pointerdown', pointerDown);
			board.removeEventListener('pointermove', pointerMove);
			board.removeEventListener('pointerup', pointerUp);
			board.removeEventListener('pointercancel', pointerCancel);
			board.removeEventListener('click', click, true);
			board.removeEventListener('wheel', wheel);
			board.removeEventListener('keydown', navigateHeading);
		};
	});

	afterNavigate(({ to, complete }) => {
		if (!to || to.url.pathname !== '/') return;
		const match = to.url.hash.match(/^#pipeline-stage-([1-9]\d*)$/);
		// Horizontal browsing stays local. Only real page navigation resets/reveals a stage.
		firstVisibleStageId = null;
		if (!match) return;
		void complete.then(async () => {
			if (location.pathname !== '/' || location.hash !== to.url.hash) return;
			const heading = await focusStage(Number(match[1]));
			heading?.focus({ preventScroll: true });
			heading?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		});
	});
</script>

{#if loading}<p role="status" class="text-sm text-muted-foreground">Loading pipeline…</p>{/if}
<noscript
	><p class="text-sm text-muted-foreground">
		Use View all jobs to browse every stage without JavaScript.
	</p></noscript
>
<p id="pipeline-instructions" class="sr-only">
	Swipe horizontally or use the controls below to browse stages. When a stage name is focused, use
	the Left and Right arrow keys. View all jobs opens the complete job list.
</p>
<div class="pipeline-browser" aria-busy={loading}>
	<Button
		variant="outline"
		size="icon"
		class="pipeline-arrow pipeline-previous"
		onclick={() => browseBy(-1)}
		disabled={!ready || firstIndex === 0}
		aria-label="Previous stages"
		title="Previous stages"
		aria-controls="pipeline-columns"><ChevronLeft aria-hidden="true" /></Button
	>
	<div class="pipeline-window">
		<div
			bind:this={board}
			id="pipeline-columns"
			class="pipeline-board"
			style:min-height={`${boardHeight}px`}
			style={`--pipeline-columns: ${Math.max(1, visibleCount)}; --pipeline-gutter: ${gutter}px; --pipeline-offset: ${offset}px; --pipeline-peek: ${previewWidth}px; --pipeline-hidden: ${firstIndex - previewStart}`}
			role="region"
			aria-label="Job pipeline stages"
		>
			<div bind:this={track} class="pipeline-track" data-sliding={sliding}>
				{#each renderedColumns as column, index (column.id)}
					{@const preview =
						index + previewStart < firstIndex
							? 'before'
							: index + previewStart >= firstIndex + visibleCount
								? 'after'
								: null}
					<section
						class={preview ? 'pipeline-preview' : 'pipeline-column'}
						data-preview={preview}
						aria-hidden={preview ? true : undefined}
						inert={Boolean(preview)}
						aria-labelledby={preview ? undefined : `pipeline-stage-${column.id}`}
					>
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<h3
							id={preview ? undefined : `pipeline-stage-${column.id}`}
							tabindex={preview ? undefined : -1}
							class={preview
								? 'pipeline-preview-heading text-base font-semibold'
								: 'pipeline-heading text-base font-semibold'}
						>
							<a
								href={`/jobs?view=all&current_stage=${column.id}`}
								class="link"
								title={column.name}
								aria-describedby={preview ? undefined : 'pipeline-instructions'}>{column.name}</a
							>
							<span class="meta-text font-normal text-muted-foreground">({column.total})</span>
						</h3>
						{#if column.jobs.length}
							<ul class="pipeline-jobs" aria-label={`${column.name} jobs`}>
								{#each column.jobs as job (job.id)}
									<li>
										<a
											class={preview ? 'pipeline-preview-card' : 'pipeline-card'}
											href={jobDetailUrl(
												job.id,
												pipelineHref(columns, column.id, column.page).replace(
													/#.*$/,
													'#job-pipeline'
												)
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
							previous={pipelineHref(columns, column.id, column.page - 1)}
							next={pipelineHref(columns, column.id, column.page + 1)}
						/>
					</section>
				{/each}
			</div>
		</div>
	</div>
	<p class="pipeline-position meta-text text-muted-foreground" role="status">
		<span>
			{visibleCount === 1 ? 'Stage' : 'Stages'}
			{firstIndex + 1}{#if visibleCount > 1}–{firstIndex + visibleCount}{/if} of {columns.length}
		</span>
	</p>
	<Button
		variant="outline"
		size="icon"
		class="pipeline-arrow pipeline-next"
		onclick={() => browseBy(1)}
		disabled={!ready || atEnd}
		aria-label="Next stages"
		title="Next stages"
		aria-controls="pipeline-columns"><ChevronRight aria-hidden="true" /></Button
	>
</div>
