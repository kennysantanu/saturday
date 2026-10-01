<script lang="ts">
	import { cn } from '$lib/utils.js';

	let { class: className }: { class?: string } = $props();
</script>

<a
	href="/"
	aria-label="Saturday Career Dashboard, home"
	class={cn('group flex items-center gap-3 rounded-lg', className)}
>
	<svg
		viewBox="0 0 40 40"
		class="size-10 shrink-0 drop-shadow-sm"
		aria-hidden="true"
		xmlns="http://www.w3.org/2000/svg"
	>
		<defs>
			<linearGradient id="logo-bg" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="oklch(0.66 0.17 259)" />
				<stop offset="1" stop-color="oklch(0.5 0.2 262)" />
			</linearGradient>
		</defs>
		<rect width="40" height="40" rx="10" fill="url(#logo-bg)" />
		<!-- Rising sun: the start of a free Saturday -->
		<path d="M10 25a10 10 0 0 1 20 0z" fill="oklch(0.99 0 0)" />
		<!-- Horizon and a path forward -->
		<rect x="8" y="27.5" width="24" height="2.5" rx="1.25" fill="oklch(0.99 0 0 / 0.75)" />
		<rect x="13" y="32" width="14" height="2" rx="1" fill="oklch(0.99 0 0 / 0.45)" />
	</svg>

	<span class="flex flex-col leading-none">
		<span class="text-xl font-semibold tracking-tight text-foreground">Saturday</span>
		<span class="mt-1.5 text-xs font-medium text-muted-foreground">Career Dashboard</span>
	</span>
</a>
