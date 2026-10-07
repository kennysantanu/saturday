<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import Field from '$lib/components/app/field.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { formatDate } from '$lib/format';
	let { data } = $props();
</script>

<svelte:head><title>Network · Saturday</title></svelte:head>
<div class="space-y-8">
	<PageHeader
		title="Network"
		description={`${data.total} ${data.total === 1 ? 'person' : 'people'}${data.filtered ? ' matching' : ' in your network'}`}
	>
		{#snippet actions()}<Button href="/networks/new"
				><Plus data-icon="inline-start" />Add person</Button
			>{/snippet}
	</PageHeader>
	<Card.Root
		><Card.Content class="space-y-5 py-2">
			<form method="GET" action="/networks" class="space-y-5">
				<div class="grid gap-5 sm:grid-cols-3">
					<Field id="name" label="Name" error={data.errors.name}
						>{#snippet control(attrs)}<Input
								{...attrs}
								name="name"
								value={data.filters.name ?? ''}
								maxlength={200}
							/>{/snippet}</Field
					>
					<Field id="role" label="Role" error={data.errors.role}
						>{#snippet control(attrs)}<Input
								{...attrs}
								name="role"
								value={data.filters.role ?? ''}
								maxlength={200}
							/>{/snippet}</Field
					>
					<Field id="organization" label="Organization" error={data.errors.organization}
						>{#snippet control(attrs)}<Input
								{...attrs}
								name="organization"
								value={data.filters.organization ?? ''}
								maxlength={200}
							/>{/snippet}</Field
					>
				</div>
				<div class="grid gap-5 sm:grid-cols-2">
					<Field id="follow_up" label="Follow-up" error={data.errors.follow_up}
						>{#snippet control(attrs)}<NativeSelect
								{...attrs}
								name="follow_up"
								value={data.filters.follow_up ?? 'all'}
								><option value="all">All</option><option value="overdue">Overdue</option><option
									value="today">Today</option
								><option value="upcoming">Upcoming</option><option value="not_scheduled"
									>Not scheduled</option
								></NativeSelect
							>{/snippet}</Field
					>
					<Field id="sort" label="Sort" error={data.errors.sort}
						>{#snippet control(attrs)}<NativeSelect
								{...attrs}
								name="sort"
								value={data.filters.sort ?? 'name'}
								><option value="name">Name</option><option value="follow_up"
									>Earliest follow-up</option
								><option value="latest_interaction">Latest recorded interaction</option
								></NativeSelect
							>{/snippet}</Field
					>
				</div>
				{#if data.errors.page}<Notice tone="error" title="Check the page number"
						>{data.errors.page}</Notice
					>{/if}
				<div class="flex flex-wrap gap-3">
					<Button type="submit" variant="outline">Apply filters</Button><Button
						href="/networks"
						variant="ghost">Clear filters</Button
					>
				</div>
			</form>
		</Card.Content></Card.Root
	>
	{#if data.networks.length}
		<Card.Root
			><Card.Content class="divide-y py-0">
				{#each data.networks as person (person.id)}
					<div class="grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
						<div class="min-w-0 space-y-1">
							<a
								class="font-semibold break-words text-primary underline-offset-4 hover:underline"
								href={`/networks/${person.id}`}>{person.name}</a
							>
							<p class="text-sm break-words text-muted-foreground">
								{[person.role, person.organization].filter(Boolean).join(' · ')}
							</p>
						</div>
						<dl class="space-y-2 text-sm">
							<div>
								<dt class="text-muted-foreground">Last recorded interaction</dt>
								<dd>
									{person.latest_interaction_date
										? formatDate(person.latest_interaction_date)
										: 'None recorded'}
								</dd>
							</div>
							<div>
								<dt class="text-muted-foreground">Follow-up</dt>
								<dd
									class:text-destructive={person.follow_up_date &&
										person.follow_up_date < data.today}
								>
									{person.follow_up_date
										? formatDate(person.follow_up_date)
										: 'Not scheduled'}{person.follow_up_date && person.follow_up_date < data.today
										? ' · Overdue'
										: person.follow_up_date === data.today
											? ' · Today'
											: ''}
								</dd>
							</div>
						</dl>
					</div>
				{/each}
			</Card.Content></Card.Root
		>
	{:else}
		<div class="empty-state space-y-3">
			<Users class="mx-auto size-8 text-muted-foreground" />
			<h2 class="text-xl font-semibold">
				{data.filtered ? 'No matching people' : 'No people yet'}
			</h2>
			<p class="text-muted-foreground">
				{data.filtered
					? 'Try changing or clearing the filters.'
					: 'Add someone you know to get started.'}
			</p>
			<Button href={data.filtered ? '/networks' : '/networks/new'} variant="outline"
				>{data.filtered ? 'Clear filters' : 'Add person'}</Button
			>
		</div>
	{/if}
	{#if data.totalPages > 1}<nav
			aria-label="Network pages"
			class="flex flex-wrap items-center justify-between gap-3"
		>
			<Button variant="outline" href={data.previous ?? undefined} disabled={!data.previous}
				>Previous</Button
			><span class="text-sm">Page {data.page} of {data.totalPages}</span><Button
				variant="outline"
				href={data.next ?? undefined}
				disabled={!data.next}>Next</Button
			>
		</nav>{/if}
</div>
