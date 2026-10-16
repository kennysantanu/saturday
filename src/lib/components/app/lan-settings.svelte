<script lang="ts">
	import { enhance, applyAction } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import { withPending } from '$lib/forms';
	import SectionCard from './section-card.svelte';
	import Notice from './notice.svelte';
	import ConfirmDialog from './confirm-dialog.svelte';
	import Field from './field.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	let {
		network,
		local,
		controlsAvailable,
		setupRequired = false,
		error,
		saved,
		lifecycle = ''
	} = $props();
	let allowing = $state(false),
		restarting = $state(false),
		copyMessage = $state('');
	const warning =
		'Allow devices on your network to connect to Saturday? Keep this computer awake and use trusted Wi-Fi. Without password login, anyone who can reach Saturday can read and edit your records, documents, and backups. Password login is optional and can be enabled separately. HTTP does not encrypt passwords, sessions, or records. All IPv4 network interfaces may be reachable, including VPN interfaces. This does not change firewall or router settings.';
	const save: SubmitFunction =
		() =>
		async ({ update, result }) => {
			allowing = false;
			await update();
			await tick();
			if (result.type === 'success' && network.restart_required) restarting = true;
		};
	async function copy(url: string) {
		try {
			await navigator.clipboard.writeText(url);
			copyMessage = 'Phone address copied.';
		} catch {
			copyMessage = 'Select the address text and copy it manually.';
		}
	}
</script>

<SectionCard
	id="lan"
	title="LAN access"
	description="Open Saturday from your phone on the same trusted network."
>
	{#if error}<Notice tone="error" title="LAN setting was not saved">{error}</Notice>{/if}
	{#if saved}<Notice title="LAN startup setting saved"
			>{network.restart_required
				? 'Restart Saturday to apply this change.'
				: 'The saved preference matches the running mode.'}</Notice
		>{/if}
	<p class="text-sm">
		Saved startup preference: <strong
			>{network.saved_allow_lan ? 'Allow LAN access' : 'This computer only'}</strong
		>
	</p>
	{#if lifecycle}<Notice title="Server connection changing"
			>Reopen Saturday with the desktop shortcut to check the running mode and current phone
			addresses.</Notice
		>
	{:else}<p class="text-sm">
			Running mode: <strong
				>{network.effective_allow_lan === null
					? 'Unavailable — open Saturday with the desktop shortcut'
					: network.effective_allow_lan
						? 'LAN access allowed'
						: 'This computer only'}</strong
			>
		</p>{/if}
	{#if network.restart_required && !lifecycle}<Notice title="Restart required"
			>{network.effective_allow_lan
				? 'Phone access continues until Saturday restarts.'
				: 'Phone access starts after Saturday restarts.'} Choosing Later keeps the saved preference for
			the next restart. Opening an already-running instance does not apply the change.</Notice
		>{/if}
	{#if !local}<p class="text-sm text-muted-foreground">
			Change access settings and restart Saturday from Open Saturday on the server computer.
		</p>{/if}
	{#if setupRequired}<Notice title="Finish Saturday setup"
			>Reload Settings after setup to configure LAN access.</Notice
		>{/if}
	{#if !network.saved_allow_lan}
		<Button
			type="button"
			variant="outline"
			disabled={!local || setupRequired || Boolean(lifecycle)}
			onclick={() => (allowing = true)}>Allow LAN access</Button
		>
		<form id="allow-lan" method="POST" action="?/lan" use:enhance={withPending(save)}>
			<input type="hidden" name="operation" value="enable" /><input
				type="hidden"
				name="confirm"
				value="true"
			/>
			<noscript
				><p class="text-sm">{warning}</p>
				<Button type="submit" disabled={!local || setupRequired}>Confirm allowing LAN access</Button
				></noscript
			>
		</form>
		<ConfirmDialog
			bind:open={allowing}
			title="Allow LAN access?"
			description={warning}
			confirmLabel="Allow LAN access"
			formId="allow-lan"
		/>
	{:else}
		<form method="POST" action="?/lan" use:enhance={withPending(save)}>
			<input type="hidden" name="operation" value="disable" />
			<Button type="submit" variant="outline" disabled={!local || Boolean(lifecycle)}
				>Disable LAN access</Button
			>
		</form>
	{/if}
	{#if network.restart_required && !lifecycle}
		<form
			id="lan-restart"
			method="POST"
			action="?/serverControl"
			use:enhance={withPending(() => async ({ result }) => {
				restarting = false;
				await applyAction(result);
			})}
		>
			<input type="hidden" name="operation" value="restart" />
			<Button type="submit" variant="outline" disabled={!controlsAvailable}>Restart now</Button>
		</form>
		{#if local && !controlsAvailable}<p class="text-sm text-muted-foreground">
				Close the development server, then use the Open Saturday desktop shortcut to apply the saved
				preference.
			</p>{/if}
	{/if}
	{#if network.effective_allow_lan && !lifecycle}
		{#if !network.phone_addresses.length}<Notice title="No phone address found"
				>Connect this computer to Wi-Fi or Ethernet, then reload Settings.</Notice
			>{/if}
		{#each network.phone_addresses as candidate, index}
			<Field
				id={`phone-address-${index}`}
				label={`Phone address · ${candidate.interface}${candidate.virtual ? ' (VPN/virtual)' : ''}`}
			>
				{#snippet control(attrs)}<Input
						{...attrs}
						value={candidate.url}
						readonly
						onclick={(event) => event.currentTarget.select()}
					/>{/snippet}
			</Field>
			<Button type="button" variant="outline" size="sm" onclick={() => copy(candidate.url)}
				>Copy phone address</Button
			>
		{/each}
		{#if copyMessage}<p role="status" class="text-sm text-muted-foreground">{copyMessage}</p>{/if}
		<p class="text-sm text-muted-foreground">
			Use the address matching this computer’s Wi-Fi/Ethernet network. VPN and virtual addresses may
			not work from your phone. Addresses can change; reload Settings to refresh them. Keep the
			computer awake. If connection fails, check Wi-Fi isolation and the computer’s firewall.
		</p>
	{/if}
	<Dialog.Root bind:open={restarting}
		><Dialog.Content class="sm:max-w-md">
			<Dialog.Header
				><Dialog.Title>Restart Saturday to apply this change?</Dialog.Title><Dialog.Description
					>The saved LAN preference applies when the server restarts. Password-protected browsers
					must sign in again.</Dialog.Description
				></Dialog.Header
			>
			<Dialog.Footer
				><Button type="button" variant="ghost" onclick={() => (restarting = false)}>Later</Button
				><Button type="submit" form="lan-restart" disabled={!controlsAvailable}>Restart now</Button
				></Dialog.Footer
			>
		</Dialog.Content></Dialog.Root
	>
</SectionCard>
