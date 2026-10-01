<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { cn } from '$lib/utils.js';
	import type { StatusInfo, StatusTone } from '$lib/status';

	let { status, class: className }: { status: StatusInfo; class?: string } = $props();

	const tones: Record<StatusTone, string> = {
		neutral: 'bg-secondary text-secondary-foreground',
		info: 'bg-accent text-accent-foreground',
		progress: 'bg-warning-soft text-warning',
		success: 'bg-success-soft text-success',
		danger: 'bg-destructive/10 text-destructive',
		muted: 'bg-muted text-muted-foreground'
	};
</script>

<Badge variant="secondary" class={cn('h-6 px-2.5', tones[status.tone], className)}>
	{status.label}
</Badge>
