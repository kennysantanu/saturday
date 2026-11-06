<script lang="ts">
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import { initialOf } from '$lib/format';
	import LinkPicker, { type PickerChoice } from './link-picker.svelte';

	type Person = { id: number; name: string; role?: string | null; organization?: string | null };
	let {
		data,
		form
	}: {
		data: {
			job: { id: number; title: string; company: string };
			selectedPerson: Person | null;
			personPicker: { networks: Person[]; page: number; totalPages: number; total: number } | null;
			linkedPersonIds: number[];
			returnTo: string;
			networkQuery: Record<string, string>;
			networkErrors: object;
		};
		form?: {
			action: string;
			errors?: Record<string, string>;
			values?: Record<string, string>;
		} | null;
	} = $props();
	const choice = (person: Person): PickerChoice => ({
		id: person.id,
		title: person.name,
		initial: initialOf(person.name),
		meta: [person.role, person.organization].filter(Boolean).join(' · ') || undefined,
		linked: data.linkedPersonIds.includes(person.id)
	});
</script>

<LinkPicker
	title="Link person"
	description="Choose someone from your network and add an optional note."
	noun="person"
	nouns="people"
	choices={(data.personPicker?.networks ?? []).map(choice)}
	page={data.personPicker?.page ?? 1}
	totalPages={data.personPicker?.totalPages ?? 1}
	total={data.personPicker?.total ?? 0}
	initialSelected={data.selectedPerson ? choice(data.selectedPerson) : null}
	queryValue={data.networkQuery.person_query ?? ''}
	queryParam="person_query"
	pageParam="person_page"
	closeKeys={['link_person', 'person', 'person_page', 'person_query']}
	searchAction={`/jobs/${data.job.id}`}
	searchHidden={{ link_person: '1', return_to: data.returnTo }}
	searchId="person_query"
	searchLabel="Search people"
	searchPlaceholder="Name, role or organization"
	noteId="new_network_relationship_note"
	formId="job-person-link"
	pagerLabel="Person picker pages"
	fieldName="network_id"
	failureAction="network-linked"
	actionName="networkLink"
	{form}
	searchErrors={Object.values(data.networkErrors)}
	addHref={`/networks/new?${new URLSearchParams({ job_id: String(data.job.id), return_to: data.returnTo })}`}
	addLabel="Add person"
	AddIcon={UserPlus}
	emptyHint="Add a person or change the search."
	noteHint="Optional. Describe this person's connection to this job."
/>
