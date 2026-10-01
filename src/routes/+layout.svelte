<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { afterNavigate, onNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { setLucideProps } from '@lucide/svelte';
	import Logo from '$lib/components/app/logo.svelte';
	import Toast from '$lib/components/app/toast.svelte';
	import { SAVED_MESSAGES, toast } from '$lib/toast.svelte';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Settings from '@lucide/svelte/icons/settings';

	let { children } = $props();

	// Explicit imports keep the bundle limited to the icons this app uses.
	setLucideProps({ size: 20, strokeWidth: 2, color: 'currentColor' });

	const links = [
		{ href: '/', label: 'Dashboard', icon: LayoutDashboard },
		{ href: '/jobs', label: 'Jobs', icon: Briefcase },
		{ href: '/settings', label: 'Settings', icon: Settings }
	];

	function isCurrent(href: string) {
		const path = page.url.pathname;
		return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
	}

	// Pages confirm a save by redirecting with ?saved=<key>. Show it once as a toast, then
	// remove the parameter so a reload does not repeat it.
	afterNavigate((navigation) => {
		const url = navigation.to?.url ?? page.url;
		const key = url.searchParams.get('saved');
		if (!key) return;
		if (SAVED_MESSAGES[key]) toast.show(SAVED_MESSAGES[key]);
		const clean = new URL(url);
		clean.searchParams.delete('saved');
		try {
			replaceState(clean, page.state);
		} catch {
			// The router is not ready yet; the parameter is harmless.
		}
	});

	// A short cross-fade between routes, skipped when the user prefers reduced motion.
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Saturday: Career Dashboard</title>
</svelte:head>

<a
	href="#main"
	class="sr-only z-50 rounded-lg bg-card px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
	>Skip to content</a
>

<div class="scroll-edge" aria-hidden="true"></div>

<div class="app-shell">
	<header class="app-topbar glass-surface">
		<Logo class="topbar-brand" />
		<nav aria-label="Primary" class="desktop-navigation">
			{#each links as link (link.href)}
				<a
					href={link.href}
					aria-current={isCurrent(link.href) ? 'page' : undefined}
					class="navigation-item"
				>
					<link.icon class="size-5" />
					<span>{link.label}</span>
				</a>
			{/each}
		</nav>
	</header>

	<main id="main" tabindex="-1" class="app-main">
		{@render children()}
	</main>
	<footer class="app-footer">Saturday keeps your job search on this computer.</footer>
</div>

<!-- Below 48rem the same three destinations move to a floating tab bar. -->
<nav aria-label="Primary" class="tab-bar glass-surface">
	{#each links as link (link.href)}
		<a href={link.href} aria-current={isCurrent(link.href) ? 'page' : undefined} class="tab-item">
			<link.icon class="size-5" />
			<span>{link.label}</span>
		</a>
	{/each}
</nav>

<Toast />
