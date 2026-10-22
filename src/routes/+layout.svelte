<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { initializeTheme } from '$lib/theme.svelte';
	import favicon from '$lib/assets/favicon.svg';
	import { afterNavigate, onNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { setLucideProps } from '@lucide/svelte';
	import Logo from '$lib/components/app/logo.svelte';
	import SessionActivity from '$lib/components/app/session-activity.svelte';
	import { authNotice } from '$lib/auth-notice.svelte';
	import Toast from '$lib/components/app/toast.svelte';
	import { SAVED_MESSAGES, toast } from '$lib/toast.svelte';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Users from '@lucide/svelte/icons/users';
	import Folder from '@lucide/svelte/icons/folder';
	import Puzzle from '@lucide/svelte/icons/puzzle';
	import Settings from '@lucide/svelte/icons/settings';

	let { children, data } = $props();
	onMount(initializeTheme);

	// Explicit imports keep the bundle limited to the icons this app uses.
	setLucideProps({ size: 20, strokeWidth: 2, color: 'currentColor' });

	const links = $derived([
		{ href: '/', label: 'Dashboard', icon: LayoutDashboard },
		{ href: '/jobs', label: 'Jobs', icon: Briefcase },
		{ href: '/networks', label: 'Network', icon: Users },
		{ href: '/documents', label: 'Documents', icon: Folder },
		...(data.extensionsEnabled ? [{ href: '/extensions', label: 'Extensions', icon: Puzzle }] : []),
		{ href: '/settings', label: 'Settings', icon: Settings }
	]);

	function isCurrent(href: string) {
		const path = page.url.pathname;
		if (href === '/documents' && path === '/profile') return true;
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
		// Dashboard stage paging has its own horizontal slide rather than a route cross-fade.
		if (navigation.from?.url.pathname === '/' && navigation.to?.url.pathname === '/') return;
		// URL-backed person picking owns dialog motion, not a whole-page route cross-fade.
		if (
			navigation.from?.url.pathname === navigation.to?.url.pathname &&
			/^\/jobs\/[1-9]\d*$/.test(navigation.to?.url.pathname ?? '') &&
			(navigation.from?.url.searchParams.has('link_person') ||
				navigation.to?.url.searchParams.has('link_person'))
		)
			return;
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
	<title>Saturday</title>
</svelte:head>

<a
	href="#main"
	class="sr-only z-50 rounded-[var(--r-control)] bg-card px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
	>Skip to content</a
>

<div class="scroll-edge" aria-hidden="true"></div>

<SessionActivity access={data.access} />
<div class="app-shell" style:visibility={authNotice.restoring ? 'hidden' : undefined}>
	<header class="app-topbar glass-surface">
		<Logo class="topbar-brand" />
		{#if page.url.pathname !== '/signin'}<nav aria-label="Primary" class="desktop-navigation">
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
			</nav>{/if}
	</header>

	<main id="main" tabindex="-1" class="app-main">
		{@render children()}
	</main>
	<footer class="app-footer">Your job search stays on the computer running Saturday.</footer>
</div>

<!-- Below 48rem the same destinations move to a floating tab bar. -->
{#if page.url.pathname !== '/signin' && !authNotice.restoring}<nav
		aria-label="Primary"
		class="tab-bar glass-surface"
	>
		{#each links as link (link.href)}
			<a href={link.href} aria-current={isCurrent(link.href) ? 'page' : undefined} class="tab-item">
				<link.icon class="size-5" />
				<span>{link.label}</span>
			</a>
		{/each}
	</nav>{/if}

<Toast />
