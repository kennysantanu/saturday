<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { formatReminder } from '$lib/format';
	let { schedule, now }: { schedule: string; now: string } = $props();
</script>

<Badge variant={schedule < now ? 'destructive' : 'secondary'}
	>{schedule < now ? 'Overdue · ' : ''}{formatReminder(schedule)}</Badge
>
