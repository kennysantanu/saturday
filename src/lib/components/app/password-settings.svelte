<script lang="ts">
	import { enhance } from '$app/forms';
	import { enhanceWithFocus } from '$lib/forms';
	import SectionCard from './section-card.svelte';
	import Field from './field.svelte';
	import Notice from './notice.svelte';
	import Checkbox from './checkbox.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	let { access, error, setupRequired = false } = $props();
	let noExpiration = $state(false);
	let logoutAll = $state(false),
		disablePassword = $state(false);
	$effect(() => {
		noExpiration = access.idle_timeout_seconds === null;
	});
</script>

{#snippet newPasswordFields(prefix: string)}
	<Field id={`${prefix}-password`} label="New password" required>
		{#snippet control(attrs)}<Input
				{...attrs}
				name="password"
				type="password"
				autocomplete="new-password"
				maxlength={1024}
				required
			/>{/snippet}
	</Field>
	<Field id={`${prefix}-confirm`} label="Confirm password" required>
		{#snippet control(attrs)}<Input
				{...attrs}
				name="confirm_password"
				type="password"
				autocomplete="new-password"
				maxlength={1024}
				required
			/>{/snippet}
	</Field>
{/snippet}

<SectionCard
	id="password"
	title="Password login"
	description="Optional password protection for this installation’s browser UI."
>
	{#if error}<Notice tone="error" title="Sign-in setting was not saved">{error}</Notice>{/if}
	{#if setupRequired}
		<Notice title="Finish Saturday setup">
			Reload Settings after setup to enable password login. Setup preserves existing records and
			files.
		</Notice>
	{/if}
	<p class="text-sm text-muted-foreground">
		Password login is {access.password_enabled ? 'enabled' : 'off'}. Your local assistant connection
		works independently.
	</p>
	{#if !access.local}<p class="text-sm text-muted-foreground">
			Change sign-in settings from Open Saturday on the host computer.
		</p>{/if}
	{#if !access.password_enabled}
		<form method="POST" action="?/password" use:enhance={enhanceWithFocus} class="space-y-4">
			<input type="hidden" name="operation" value="enable" />
			<p class="required-note">* Required</p>
			{@render newPasswordFields('enable')}
			<div class="form-actions">
				<Button type="submit" disabled={!access.local || setupRequired}
					>Enable password login</Button
				>
			</div>
		</form>
	{:else if access.authenticated}
		<form method="POST" action="?/password" use:enhance={enhanceWithFocus} class="space-y-4">
			<input type="hidden" name="operation" value="timeout" />
			<Field
				id="idle-hours"
				label="Sign out after inactivity (hours)"
				hint="0.25–720 hours. Activity keeps you signed in; restarting Saturday signs you out."
			>
				{#snippet control(attrs)}<Input
						{...attrs}
						name="hours"
						type="number"
						min="0.25"
						max="720"
						step="any"
						value={access.idle_timeout_seconds === null ? 1 : access.idle_timeout_seconds / 3600}
						disabled={noExpiration || !access.local}
						required={!noExpiration}
					/>{/snippet}
			</Field>
			<Checkbox
				name="no_expiration"
				value="on"
				label="No expiration"
				bind:checked={noExpiration}
				disabled={!access.local}
			/>
			<p class="text-sm text-muted-foreground">
				No expiration turns off inactivity logout. Closing the browser may end the session; logout,
				a password change, or a server restart always ends it. At most 100 devices/sessions can be
				signed in; a new login at that limit signs out the oldest.
			</p>
			<div class="form-actions">
				<Button type="submit" variant="outline" disabled={!access.local}
					>Save inactivity setting</Button
				>
			</div>
		</form>
		<details class="disclosure">
			<summary>Change password</summary>
			<form
				method="POST"
				action="?/password"
				use:enhance={enhanceWithFocus}
				class="disclosure-body space-y-4"
			>
				<input type="hidden" name="operation" value="change" />
				<p class="required-note">* Required</p>
				<Field id="change-current" label="Current password" required>
					{#snippet control(attrs)}<Input
							{...attrs}
							name="current_password"
							type="password"
							autocomplete="current-password"
							maxlength={1024}
							required
						/>{/snippet}
				</Field>
				{@render newPasswordFields('change')}
				<p class="text-sm text-muted-foreground">Changing the password signs out other sessions.</p>
				<div class="form-actions">
					<Button type="submit" disabled={!access.local}>Change password</Button>
				</div>
			</form>
		</details>
		<details class="disclosure">
			<summary>Disable password login</summary>
			<form
				id="disable-password"
				method="POST"
				action="?/password"
				class="disclosure-body space-y-4"
				data-sveltekit-reload
			>
				<input type="hidden" name="operation" value="disable" />
				<input type="hidden" name="confirm" value="true" />
				<Field id="disable-current" label="Current password" required>
					{#snippet control(attrs)}<Input
							{...attrs}
							name="current_password"
							type="password"
							autocomplete="current-password"
							maxlength={1024}
							required
						/>{/snippet}
				</Field>
				<p class="text-sm text-muted-foreground">
					Saturday will open without asking for a password.
				</p>
				<div class="form-actions">
					<Button
						type="button"
						variant="outline"
						disabled={!access.local}
						onclick={() => {
							const form = document.getElementById('disable-password') as HTMLFormElement;
							if (form.reportValidity()) disablePassword = true;
						}}>Disable password login</Button
					>
				</div>
				<noscript
					><Button type="submit" disabled={!access.local}>Confirm disabling password login</Button
					></noscript
				>
			</form>
		</details>
		<ConfirmDialog
			bind:open={disablePassword}
			title="Disable password login?"
			description="Saturday will open without a password, and all existing sessions will be revoked."
			confirmLabel="Disable password login"
			formId="disable-password"
		/>
		<div class="form-actions">
			<form method="POST" action="?/logout" data-sveltekit-reload>
				<Button type="submit" variant="outline">Log out</Button>
			</form>
			<Button type="button" variant="outline" onclick={() => (logoutAll = true)}
				>Log out all devices</Button
			>
		</div>
		<form id="logout-all" method="POST" action="?/logout" data-sveltekit-reload>
			<input type="hidden" name="all" value="true" /><input
				type="hidden"
				name="confirm"
				value="true"
			/>
			<noscript
				><p class="text-sm text-muted-foreground">
					This signs out this browser and every other device.
				</p>
				<Button type="submit" variant="outline">Confirm logging out all devices</Button></noscript
			>
		</form>
		<ConfirmDialog
			bind:open={logoutAll}
			title="Log out all devices?"
			description="Every session will be revoked, including this browser. You will need to sign in again."
			confirmLabel="Log out all devices"
			formId="logout-all"
		/>
	{/if}
</SectionCard>
