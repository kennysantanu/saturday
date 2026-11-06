<script lang="ts">
	import { validTagSelection } from '$lib/tags.js';
	import { untrack } from 'svelte';
	import TagPicker from '$lib/components/app/tag-picker.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import RecentMenu from '$lib/components/app/recent-menu.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import EmptyState from '$lib/components/app/empty-state.svelte';
	import FilterBar from '$lib/components/app/filter-bar.svelte';
	import FilterToggle from '$lib/components/app/filter-toggle.svelte';
	import Pagination from '$lib/components/app/pagination.svelte';
	import PersonRow from '$lib/components/app/person-row.svelte';
	import Field from '$lib/components/app/field.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { page } from '$app/state';
	import { networkDetailUrl } from '$lib/network-navigation.js';
	import { buildChips, tagChips } from '$lib/filter-chips.js';
	import { reminderLabel, resultCount } from '$lib/filter-labels.js';
	let { data } = $props();

	let selectedTags = $state(untrack(() => validTagSelection(data.filters.tag_ids ?? [])));
	$effect(() => {
		selectedTags = validTagSelection(data.filters.tag_ids ?? []);
	});
	// Each chip links to this list without that one filter; other filters and sorting stay.
	const chips = $derived([
		...buildChips('/networks', page.url.searchParams, data.filters, [
			['name', 'Name contains'],
			['role', 'Role contains'],
			['organization', 'Organization contains'],
			['follow_up', 'Reminder', { skip: 'all', format: reminderLabel }]
		]),
		...tagChips('/networks', page.url.searchParams, data.tagOptions.selectedTags)
	]);
	const advancedKeys = ['role', 'organization', 'tag_ids'];
	const advancedCount = $derived(
		chips.filter((chip) => advancedKeys.includes(chip.key.split(':')[0])).length
	);
	const advancedOpen = $derived(
		advancedCount > 0 || advancedKeys.some((key) => (data.errors as Record<string, string>)[key])
	);
</script>

<PageShell title="Network">
	<PageHeader title="Network" description="People who can help with your search.">
		{#snippet actions()}
			<RecentMenu kind="people" enabled={Boolean(data.navigationSettings?.enabled)} />
			<Button href="/networks/new" size="lg"><Plus data-icon="inline-start" />Add person</Button
			>{/snippet}
	</PageHeader>

	<FilterBar
		label="Filter people"
		action="/networks"
		clearHref="/networks"
		showClear={data.filtered || Object.keys(data.errors).length > 0}
		instant
		{chips}
		advancedLabel="More filters"
		{advancedCount}
		{advancedOpen}
	>
		{#snippet before()}
			{#if data.errors.page}<Notice tone="error" title="Check the page number"
					>{data.errors.page}</Notice
				>{/if}
		{/snippet}
		<div class="filter-row">
			<div class="filter-row-search">
				<Field id="name" label="Name contains" error={data.errors.name}>
					{#snippet control(attrs)}<Input
							{...attrs}
							name="name"
							value={data.filters.name ?? ''}
							maxlength={200}
						/>{/snippet}
				</Field>
			</div>
			<div class="filter-row-one">
				<Field id="follow_up" label="Reminder" error={data.errors.follow_up}>
					{#snippet control(attrs)}<NativeSelect
							{...attrs}
							name="follow_up"
							value={data.filters.follow_up ?? 'all'}
							data-instant
						>
							<option value="all">{reminderLabel('all')}</option>
							<option value="overdue">{reminderLabel('overdue')}</option>
							<option value="today">{reminderLabel('today')}</option>
							<option value="upcoming">{reminderLabel('upcoming')}</option>
							<option value="not_scheduled">{reminderLabel('not_scheduled')}</option>
						</NativeSelect>{/snippet}
				</Field>
			</div>
			<div class="filter-row-two">
				<Field id="sort" label="Sort by" error={data.errors.sort}>
					{#snippet control(attrs)}<NativeSelect
							{...attrs}
							name="sort"
							value={data.filters.sort ?? 'name'}
							data-instant
						>
							<option value="name">Name</option>
							<option value="follow_up">Earliest reminder</option>
							<option value="latest_interaction">Latest recorded interaction</option>
						</NativeSelect>{/snippet}
				</Field>
			</div>
			<div class="filter-row-toggle"><FilterToggle /></div>
		</div>
		{#snippet advanced()}
			<div class="grid gap-4 sm:grid-cols-2">
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
			<section class="space-y-4">
				<TagPicker
					collection="person"
					initial={data.tagOptions}
					bind:selected={selectedTags}
					allowCreate={false}
					marker={false}
					error={data.errors.tag_ids}
				/>
			</section>
		{/snippet}
	</FilterBar>

	<div class="space-y-4">
		<p class="text-sm text-muted-foreground" aria-live="polite">
			{resultCount(data.total, {
				one: 'person',
				many: 'people',
				filtered: data.filtered,
				scope: 'in your network'
			})}
		</p>
		{#if data.networks.length}
			<Card.Root class="gap-0 divide-y divide-border p-0">
				{#each data.networks as person (person.id)}
					<PersonRow
						tags={person.tags}
						recordNumber={person.id}
						href={networkDetailUrl(person.id, page.url.pathname + page.url.search)}
						name={person.name}
						role={person.role}
						organization={person.organization}
						nextReminder={person.next_reminder_at}
						now={data.now}
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
