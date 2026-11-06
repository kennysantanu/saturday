<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import Bell from '@lucide/svelte/icons/bell';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Flag from '@lucide/svelte/icons/flag';
	import UserRound from '@lucide/svelte/icons/user-round';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { Badge } from '$lib/components/ui/badge/index.js';

	/**
	 * One row of the Dashboard's Needs attention and Coming up lists. The main part is a link to the
	 * record; `action` (optional) is a separate control such as Dismiss, so no button sits inside a
	 * link. The date chip sits at the end of the row from 40rem and under the text on a phone.
	 */
	let {
		href,
		kind,
		title,
		subtitle,
		comment,
		relative,
		absolute,
		overdue = false,
		action,
		actionArg
	}: {
		href: string;
		kind: 'job-reminder' | 'person-reminder' | 'deadline' | 'milestone';
		title: string;
		subtitle: string;
		comment?: string | null;
		relative: string;
		absolute: string;
		overdue?: boolean;
		/** Rendered beside the link, called with `actionArg`. */
		action?: Snippet<[T]>;
		actionArg?: T;
	} = $props();
	const kinds = {
		'job-reminder': { icon: Bell, label: 'Reminder' },
		'person-reminder': { icon: UserRound, label: 'Network reminder' },
		deadline: { icon: Flag, label: 'Deadline' },
		milestone: { icon: CalendarClock, label: 'Milestone' }
	};
	const Icon = $derived(kinds[kind].icon);
</script>

<div class="attention-row">
	<a {href} class="attention-link group">
		<span class="row-mark attention-mark" aria-hidden="true"><Icon class="size-5" /></span>
		<span class="attention-text">
			<span class="sr-only">{kinds[kind].label}: </span>
			<span class="block font-semibold">{title}</span>
			<span class="block text-sm text-muted-foreground">{subtitle}</span>
			{#if comment}<span
					class="line-clamp-2 text-sm break-words whitespace-pre-wrap text-muted-foreground"
					title={comment}>{comment}</span
				>{/if}
		</span>
		<span class="attention-when">
			<Badge variant={overdue ? 'destructive' : 'secondary'} title={absolute}>{relative}</Badge>
		</span>
		{#if !action}<ChevronRight
				class="attention-chevron size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
				aria-hidden="true"
			/>{/if}
	</a>
	{#if action}<div class="attention-action">{@render action(actionArg as T)}</div>{/if}
</div>
