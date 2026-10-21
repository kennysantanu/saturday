<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate, afterNavigate } from '$app/navigation';
	import { authNotice } from '$lib/auth-notice.svelte';
	import Notice from './notice.svelte';
	import { Button } from '$lib/components/ui/button';
	let { access } = $props();
	let checkRestored: (() => void) | undefined;
	beforeNavigate((navigation) => {
		if (navigation.type === 'popstate') authNotice.restoring = true;
	});
	afterNavigate((navigation) => {
		if (authNotice.retry && authNotice.retry.pathname !== navigation.to?.url.pathname)
			authNotice.retry = null;
		if (navigation.type === 'popstate') checkRestored?.();
	});
	onMount(() => {
		let lastSent = 0,
			stopped = false,
			checking = false;
		const check = async () => {
			if (window.location.pathname === '/signin') {
				authNotice.required = false;
				authNotice.restoring = false;
				return;
			}
			if (checking) return;
			checking = true;
			try {
				const response = await fetch('/auth/session', { cache: 'no-store' });
				const current = await response.json();
				if (stopped) return;
				if (!response.ok || !current.authenticated) authNotice.required = true;
				else {
					authNotice.required = false;
					authNotice.restoring = false;
				}
				return current;
			} catch {
				if (authNotice.restoring) authNotice.required = true;
			} finally {
				checking = false;
			}
		};
		checkRestored = () => {
			void check();
		};
		const activity = async (event: Event) => {
			if (
				!event.isTrusted ||
				document.visibilityState !== 'visible' ||
				!access?.password_enabled ||
				window.location.pathname === '/signin' ||
				Date.now() - lastSent < 30000
			)
				return;
			lastSent = Date.now();
			try {
				const policy = await check();
				if (
					!policy?.authenticated ||
					!policy.password_enabled ||
					policy.idle_timeout_seconds === null
				)
					return;
				const response = await fetch('/auth/activity', { method: 'POST' });
				if (response.status === 401) authNotice.required = true;
			} catch {
				/* A failed heartbeat never renews a session locally. */
			}
		};
		const restore = (event: PageTransitionEvent) => {
			if (event.persisted) {
				authNotice.restoring = true;
				void check();
			}
		};
		const hide = () => {
			authNotice.restoring = true;
		};
		const focus = () => {
			void check();
		};
		// Local carousels handle wheel gestures without native scrolling or navigation.
		const events = ['pointerdown', 'pointermove', 'keydown', 'input', 'scroll', 'wheel'];
		for (const name of events)
			document.addEventListener(name, activity, { passive: true, capture: true });
		window.addEventListener('pageshow', restore);
		window.addEventListener('pagehide', hide);
		window.addEventListener('focus', focus);
		return () => {
			checkRestored = undefined;
			stopped = true;
			for (const name of events) document.removeEventListener(name, activity, true);
			window.removeEventListener('pageshow', restore);
			window.removeEventListener('pagehide', hide);
			window.removeEventListener('focus', focus);
		};
	});
</script>

{#if (authNotice.required || authNotice.retry) && typeof window !== 'undefined' && window.location.pathname !== '/signin'}
	<div class="mx-auto max-w-2xl p-4">
		<Notice
			tone={authNotice.required ? 'error' : 'info'}
			title={authNotice.required
				? 'Session expired — sign in, then retry'
				: 'Upload ready to retry'}
		>
			<p>
				Your unsaved inputs remain in this tab. Sign in, return here, then retry the action
				yourself.
			</p>
			<a
				class="link mt-2 inline-block"
				href="/signin"
				target="_blank"
				rel="noopener"
				data-sveltekit-reload>Sign in in another tab</a
			>
			{#if authNotice.retry}
				<p class="mt-2 break-all">Selected file: {authNotice.retry.label}</p>
				<Button
					type="button"
					variant="outline"
					disabled={authNotice.required}
					onclick={() => {
						const retry = authNotice.retry;
						authNotice.retry = null;
						void retry?.run();
					}}>Retry upload</Button
				>
			{/if}
		</Notice>
	</div>
{:else if authNotice.restoring}
	<p role="status" class="p-4 text-center text-sm text-muted-foreground">Checking sign-in…</p>
{/if}
