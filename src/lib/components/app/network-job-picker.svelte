<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import { initialOf } from '$lib/format';
	import type { StatusInfo } from '$lib/status';
	import LinkPicker, { type PickerChoice } from './link-picker.svelte';

	type Job = {
		id: number;
		title: string;
		company: string;
		isActive: boolean;
		status?: StatusInfo;
	};
	let {
		data,
		form
	}: {
		data: {
			person: { id: number; name: string };
			selectedJob: Job | null;
			picker: { jobs: Job[]; page: number; totalPages: number; total: number } | null;
			linkedIds: number[];
			returnTo: string;
			query: Record<string, string>;
			errors: object;
		};
		form?: {
			action: string;
			errors?: Record<string, string>;
			values?: Record<string, string>;
		} | null;
	} = $props();
	const choice = (job: Job): PickerChoice => ({
		id: job.id,
		title: job.title,
		initial: initialOf(job.company),
		meta: job.company + (job.isActive ? '' : ' · Closed'),
		status: job.status,
		closed: !job.isActive,
		linked: data.linkedIds.includes(job.id)
	});
</script>

<LinkPicker
	title="Link to job"
	description={`Choose a job for ${data.person.name} and add an optional note. Closed jobs are included.`}
	noun="job"
	nouns="jobs"
	choices={(data.picker?.jobs ?? []).map(choice)}
	page={data.picker?.page ?? 1}
	totalPages={data.picker?.totalPages ?? 1}
	total={data.picker?.total ?? 0}
	initialSelected={data.selectedJob ? choice(data.selectedJob) : null}
	queryValue={data.query.job_query ?? ''}
	queryParam="job_query"
	pageParam="picker_page"
	closeKeys={['link_job', 'job', 'picker_page', 'job_query']}
	searchAction={`/networks/${data.person.id}`}
	searchHidden={{ link_job: '1', return_to: data.returnTo }}
	searchId="job_query"
	searchLabel="Search jobs"
	searchPlaceholder="Title or company"
	noteId="link_notes"
	formId="network-job-link"
	pagerLabel="Job picker pages"
	fieldName="job_id"
	failureAction="network-linked"
	actionName="link"
	{form}
	searchErrors={Object.values(data.errors)}
	addHref={`/jobs/new?person_id=${data.person.id}`}
	addLabel="Add job"
	AddIcon={Plus}
	emptyHint="Add a job or change the search."
	noteHint="Optional. Describe this person's connection to this job."
/>
