<script lang="ts">
	import type { Snippet } from 'svelte';
	import { setContext, untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import FilterChips from './filter-chips.svelte';
	import { filterBarKey, type FilterBarContext } from './filter-bar-context';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { filterLabels } from '$lib/filter-labels.js';

	/**
	 * The filter toolbar for a list: one GET form in one card.
	 *
	 * - `children` is the primary row: search field, quick selects and Sort. With `advanced`, end
	 *   the row with `<FilterToggle />`.
	 * - `advanced` (optional) fills a panel under the row, opened by FilterToggle (`advancedLabel`,
	 *   `advancedCount` applied). It opens on its own when `advancedOpen` becomes true.
	 * - The footer shows the applied `chips` row, then Clear and Apply. With `advanced` the footer
	 *   appears only when it has something to do: chips or Clear, unapplied changes, or an open
	 *   panel. Without scripts it is always shown, as is the panel.
	 * - `unapplied` overrides the built-in "form was edited" tracking when the page knows better.
	 * - `before` sits above the card, such as an error notice.
	 *
	 * With `instant`, changing a control marked `data-instant` (a select or toggle) applies the form
	 * straight away, replacing the history entry and keeping focus and scroll. Text search and other
	 * fields still wait for Enter or Apply. With `navigate`, Apply and Enter load the new results
	 * client-side, keeping focus, scroll and any open dialog, instead of a full page load. The form
	 * stays a native GET form, so it works without JavaScript. Omit `action` to submit to the
	 * current page.
	 */
	let {
		label,
		action,
		clearHref,
		applyLabel = filterLabels.apply,
		clearLabel = filterLabels.clear,
		showClear = true,
		instant = false,
		navigate = false,
		unapplied,
		chips = [],
		advancedLabel = 'Filters',
		advancedCount = 0,
		advancedOpen = false,
		before,
		advanced,
		children
	}: {
		label: string;
		action?: string;
		clearHref?: string;
		applyLabel?: string;
		clearLabel?: string;
		showClear?: boolean;
		instant?: boolean;
		navigate?: boolean;
		unapplied?: boolean;
		chips?: { key: string; label: string; href: string; color?: string }[];
		advancedLabel?: string;
		advancedCount?: number;
		advancedOpen?: boolean;
		before?: Snippet;
		advanced?: Snippet;
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const panelId = `${uid}-panel`;
	let open = $state(untrack(() => advancedOpen));
	let dirty = $state(false);
	$effect(() => {
		open = advancedOpen;
	});
	// A new URL means the last edits were applied (or discarded).
	$effect(() => {
		void page.url.href;
		dirty = false;
	});
	const pending = $derived(unapplied ?? dirty);
	const showFooter = $derived(
		!advanced || chips.length > 0 || (showClear && !!clearHref) || pending || open
	);

	setContext<FilterBarContext>(filterBarKey, {
		get open() {
			return open;
		},
		get label() {
			return advancedLabel;
		},
		get count() {
			return advancedCount;
		},
		panelId,
		toggle() {
			open = !open;
			// The panel is tall on a phone: bring its top into view when it opens.
			if (open && window.matchMedia('(width < 48rem)').matches) {
				const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
				queueMicrotask(() =>
					document
						.getElementById(panelId)
						?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
				);
			}
		}
	});

	function queryOf(form: HTMLFormElement) {
		const params = new URLSearchParams();
		for (const [key, value] of new FormData(form))
			if (typeof value === 'string' && value !== '') params.append(key, value);
		return params;
	}

	function submitClientSide(event: SubmitEvent) {
		if (!navigate) return;
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const params = queryOf(form);
		const path = form.getAttribute('action') || page.url.pathname;
		void goto(`${path}${params.size ? `?${params}` : ''}`, { keepFocus: true, noScroll: true });
	}

	function applyInstantly(event: Event) {
		if (!instant) return;
		if (!(event.target as HTMLElement).closest('[data-instant]')) return;
		const form = event.currentTarget as HTMLFormElement;
		const params = queryOf(form);
		const path = form.getAttribute('action') || page.url.pathname;
		void goto(`${path}${params.size ? `?${params}` : ''}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function markDirty(event: Event) {
		if (!(event.target as HTMLElement).closest('[data-instant]')) dirty = true;
	}
</script>

<svelte:head>
	<noscript
		><style>
			.filter-panel[hidden],
			.filter-footer[hidden] {
				display: grid !important;
			}
			.filter-footer[hidden] {
				display: flex !important;
			}
			.filter-toggle {
				display: none !important;
			}
		</style></noscript
	>
</svelte:head>

<form
	method="GET"
	action={action || undefined}
	class="space-y-4"
	aria-label={label}
	onchange={applyInstantly}
	oninput={markDirty}
	onsubmit={submitClientSide}
>
	{@render before?.()}
	<Card.Root class="filter-card gap-0 overflow-visible py-0">
		<Card.Content class="space-y-4 py-5">
			<div class="filter-primary">{@render children()}</div>
			{#if advanced}
				<div id={panelId} class="filter-panel" hidden={!open}>{@render advanced()}</div>
			{/if}
		</Card.Content>
		{#if chips.length}<div class="filter-chips-row"><FilterChips {chips} /></div>{/if}
		<div class="filter-footer" hidden={!showFooter}>
			{#if pending}<p class="meta-text text-muted-foreground" role="status">
					Changes not applied yet
				</p>{/if}
			<div class="form-actions">
				{#if showClear && clearHref}<Button href={clearHref} variant="ghost">{clearLabel}</Button
					>{/if}
				<Button type="submit" variant="outline">{applyLabel}</Button>
			</div>
		</div>
	</Card.Root>
</form>
