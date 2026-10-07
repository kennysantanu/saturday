<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { relativeDay } from '$lib/format';

	/** A follow-up or deadline date as text: overdue dates are flagged, today and future dates are not. */
	let { date, today, prefix = '' }: { date: string; today: string; prefix?: string } = $props();
	const overdue = $derived(date < today);
</script>

<Badge variant={overdue ? 'destructive' : 'secondary'}
	>{prefix}{overdue ? 'Overdue · ' : ''}{relativeDay(date, today)}</Badge
>
