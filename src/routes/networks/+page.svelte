<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import FilterBar from '$lib/components/app/filter-bar.svelte';
	import FilterChips from '$lib/components/app/filter-chips.svelte';
	import Pagination from '$lib/components/app/pagination.svelte';
	import PersonRow from '$lib/components/app/person-row.svelte';
	import Field from '$lib/components/app/field.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { page } from '$app/state';
	let { data } = $props();

	const followUpLabels: Record<string, string> = {
		overdue: 'Overdue',
		today: 'Today',
		upcoming: 'Upcoming',
		not_scheduled: 'Not scheduled'
	};
	// Each chip links to this list without that one filter; other filters and sorting stay.
	const chips = $derived.by(() => {
		const without = (...keys: string[]) => {
			const query = new URLSearchParams(page.url.searchParams);
			for (const key of ['page', ...keys]) query.delete(key);
			return '/networks' + (query.size ? `?${query}` : '');
		};
		const list: { key: string; label: string; href: string }[] = [];
		for (const [key, label] of [
			['name', 'Name contains'],
			['role', 'Role contains'],
			['organization', 'Organization contains']
		] as const) {
			const value = data.filters[key];
			if (value) list.push({ key, label: `${label}: ${value}`, href: without(key) });
		}
		const followUp = data.filters.follow_up;
		if (followUp && followUp !== 'all')
			list.push({
				key: 'follow_up',
				label: `Follow-up: ${followUpLabels[followUp] ?? followUp}`,
				href: without('follow_up')
			});
		return list;
	});
</script>

<PageShell title="Network">
	<PageHeader title="Network" description="People who can help with your search.">
		{#snippet actions()}<Button href="/networks/new" size="lg"
				><Plus data-icon="inline-start" />Add person</Button
			>{/snippet}
	</PageHeader>

	<FilterBar label="Filter people" action="/networks" clearHref="/networks">
		{#snippet before()}
			{#if data.errors.page}<Notice tone="error" title="Check the page number"
					>{data.errors.page}</Notice
				>{/if}
		{/snippet}
		<div class="grid gap-5 sm:grid-cols-3">
			<Field id="name" label="Name contains" error={data.errors.name}>
				{#snippet control(attrs)}<Input
						{...attrs}
						name="name"
						value={data.filters.name ?? ''}
						maxlength={200}
					/>{/snippet}
			</Field>
			<Field id="role" label="Role contains" error={data.errors.role}>
				{#snippet control(attrs)}<Input
						{...attrs}
						name="role"
						value={data.filters.role ?? ''}
						maxlength={200}
					/>{/snippet}
			</Field>
			<Field id="organization" label="Organization contains" error={data.errors.organization}>
				{#snippet control(attrs)}<Input
						{...attrs}
						name="organization"
						value={data.filters.organization ?? ''}
						maxlength={200}
					/>{/snippet}
			</Field>
		</div>
		<div class="grid gap-5 sm:grid-cols-2">
			<Field id="follow_up" label="Follow-up" error={data.errors.follow_up}>
				{#snippet control(attrs)}<NativeSelect
						{...attrs}
						name="follow_up"
						value={data.filters.follow_up ?? 'all'}
					>
						<option value="all">All</option>
						<option value="overdue">Overdue</option>
						<option value="today">Today</option>
						<option value="upcoming">Upcoming</option>
						<option value="not_scheduled">Not scheduled</option>
					</NativeSelect>{/snippet}
			</Field>
			<Field id="sort" label="Sort by" error={data.errors.sort}>
				{#snippet control(attrs)}<NativeSelect
						{...attrs}
						name="sort"
						value={data.filters.sort ?? 'name'}
					>
						<option value="name">Name</option>
						<option value="follow_up">Earliest follow-up</option>
						<option value="latest_interaction">Latest recorded interaction</option>
					</NativeSelect>{/snippet}
			</Field>
		</div>
	</FilterBar>

	<FilterChips {chips} />

	<div class="space-y-4">
		<p class="text-sm text-muted-foreground" aria-live="polite">
			{data.total}
			{data.total === 1 ? 'person' : 'people'}{data.filtered
				? ' matching filters'
				: ' in your network'}
		</p>
		{#if data.networks.length}
			<Card.Root class="gap-0 divide-y divide-border p-0">
				{#each data.networks as person (person.id)}
					<PersonRow
						recordNumber={person.id}
						href={`/networks/${person.id}`}
						name={person.name}
						role={person.role}
						organization={person.organization}
						followUpDate={person.follow_up_date}
						latestInteractionDate={person.latest_interaction_date}
						today={data.today}
					/>
				{/each}
			</Card.Root>
		{:else}
			<EmptyState
				title={data.filtered ? 'No matching people' : 'No people yet'}
				description={data.filtered
					? 'Try changing or clearing the filters.'
					: 'Add someone you know to get started.'}
			>
				{#snippet icon()}<Users class="size-5" />{/snippet}
				{#snippet actions()}
					<Button
						href={data.filtered ? '/networks' : '/networks/new'}
						variant={data.filtered ? 'outline' : 'default'}
						size="lg"
						>{#if !data.filtered}<Plus data-icon="inline-start" />{/if}{data.filtered
							? 'Clear filters'
							: 'Add person'}</Button
					>
				{/snippet}
			</EmptyState>
		{/if}
		<Pagination
			label="Network pages"
			page={data.page}
			totalPages={data.totalPages}
			previous={data.previous}
			next={data.next}
		/>
	</div>
</PageShell>
