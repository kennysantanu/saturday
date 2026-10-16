<script lang="ts">
	import { enhance } from '$app/forms';
	import { enhanceWithFocus } from '$lib/forms';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import SectionCard from '$lib/components/app/section-card.svelte';
	import Field from '$lib/components/app/field.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	let { data, form } = $props();
</script>

<PageShell title="Sign in" width="form">
	<PageHeader title="Sign in to Saturday" description="Enter Saturday’s password." />
	<SectionCard title="Password login">
		{#if form?.loginError}<Notice tone="error" title="Could not sign in">{form.loginError}</Notice
			>{/if}
		<form method="POST" use:enhance={enhanceWithFocus} class="space-y-5">
			<p class="required-note">* Required</p>
			<Field id="signin-password" label="Password" required>
				{#snippet control(attrs)}<Input
						{...attrs}
						name="password"
						type="password"
						autocomplete="current-password"
						required
						maxlength={1024}
					/>{/snippet}
			</Field>
			<div class="form-actions"><Button type="submit">Sign in</Button></div>
		</form>
		<details class="disclosure">
			<summary>Forgot your password?</summary>
			<div class="disclosure-body space-y-3 text-sm text-muted-foreground">
				<p>
					If you cannot sign in, recover access using a terminal on the computer running Saturday.
					You or an authorized AI agent must have command-line access to that computer. Saturday’s
					MCP tools cannot disable or reset password protection, and there is no browser reset for a
					forgotten password. If you are already signed in and know the current password, you can
					disable password login in Settings on the server computer.
				</p>
				<p>For an installed copy, run:</p>
				<pre class="max-w-full break-all whitespace-pre-wrap"><code
						>{'"<node_path>" "<code_root>/scripts/access.mjs" disable --installation "<descriptor>" --confirm'}</code
					></pre>
				<p>
					Replace the placeholders using the installation’s <code>installation.json</code>. For a
					source checkout, run <code>node scripts/access.mjs disable --confirm</code>
					from the Saturday folder on the server computer. See
					<code>docs/installation-guide.md</code> for installation locations and damaged-settings recovery.
				</p>
				<p>
					The command stops Saturday and preserves your records and documents. Reopen
					<strong>Open Saturday</strong> afterward, then optionally set a new password in Settings.
				</p>
			</div>
		</details>
	</SectionCard>
</PageShell>
