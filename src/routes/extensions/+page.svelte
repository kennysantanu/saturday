<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { withPending, focusFirstError } from '$lib/forms';
	import { toast } from '$lib/toast.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import SectionCard from '$lib/components/app/section-card.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import Field from '$lib/components/app/field.svelte';
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import ActionMenu from '$lib/components/app/action-menu.svelte';
	import ConfirmDialog from '$lib/components/app/confirm-dialog.svelte';
	import RestorePreview from '$lib/components/app/restore-preview.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Archive from '@lucide/svelte/icons/archive';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Power from '@lucide/svelte/icons/power';
	let { data, form } = $props();
	let selected = $state<any>(null),
		operation = $state(''),
		removing = $state(false),
		restoring = $state(false),
		confirmRestore = $state(false),
		backupId = $state(''),
		uploading = $state(false),
		uploadError = $state('');
	let fileInput: HTMLInputElement;
	async function run(id: string, op: string) {
		selected = data.installed.find((e: any) => e.id === id);
		operation = op;
		await import('svelte').then(({ tick }) => tick());
		(document.getElementById('extension-action') as HTMLFormElement)?.requestSubmit();
	}
	const menu = (entry: any) => [
		{
			label: entry.enabled ? 'Disable' : 'Enable',
			icon: Power,
			onselect: () => run(entry.id, entry.enabled ? 'disable' : 'enable')
		},
		...(entry.manifest.database
			? [
					{ label: 'Back up', icon: Archive, onselect: () => run(entry.id, 'backup') },
					{
						label: 'Restore',
						icon: RotateCcw,
						onselect: () => {
							selected = entry;
							backupId = '';
							restoring = true;
						}
					}
				]
			: []),
		{
			label: 'Remove extension',
			icon: Trash2,
			separated: true,
			destructive: true,
			onselect: () => {
				selected = entry;
				operation = 'remove';
				removing = true;
			}
		}
	];
	async function upload(file: File) {
		uploading = true;
		uploadError = '';
		try {
			const r = await fetch('/extensions/import', {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: file
			});
			const v = await r.json();
			if (!r.ok) throw new Error(v.error);
			await invalidateAll();
			backupId = v.backup_id;
			toast.show('Extension backup imported.');
		} catch (e) {
			uploadError = (e as Error).message;
		} finally {
			uploading = false;
		}
	}
</script>

<PageShell title="Extensions">
	<PageHeader
		title="Extensions"
		description="Your installed custom pages and features."
		back={{ href: '/settings#extensions', label: 'settings' }}
	/>
	{#if !data.enabled}<Notice
			>Extensions are off. Enable them in Settings to open their pages and use their MCP tools. Data
			and recovery actions remain available.</Notice
		>{/if}
	{#if data.extensionError || form?.extensionError}<Notice
			tone="error"
			title="Extension action failed">{data.extensionError || form?.extensionError}</Notice
		>{/if}
	{#if !data.installed.length}<SectionCard title="No extensions installed"
			><p class="text-sm text-muted-foreground">
				Ask your coding agent to follow the extension guide, or install a trusted local folder or
				Git repository.
			</p>
			<pre
				class="inset-surface overflow-auto p-4">npm run extension -- install &lt;source&gt;</pre></SectionCard
		>{/if}
	{#each data.installed as entry (entry.id)}
		<SectionCard title={entry.manifest.name} description={entry.manifest.description}>
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<p class="text-sm text-muted-foreground">
						{entry.manifest.version} · {entry.pending_remove
							? 'Removal pending'
							: entry.available
								? 'Enabled'
								: (entry.reason ?? 'Unavailable')}
					</p>
					{#if entry.available}<a class="link" href={`/extensions/${entry.id}`}
							>Open {entry.manifest.name}</a
						>{/if}
				</div>
				<ActionMenu
					label={`More actions for ${entry.manifest.name}`}
					items={entry.pending_remove ? [] : menu(entry)}
				/>
			</div>
			{#if entry.pending_remove}<pre
					class="inset-surface overflow-auto p-3">npm run extension -- uninstall {entry.id}</pre>{/if}
			<details class="disclosure">
				<summary>Source details</summary>
				<p class="disclosure-body text-sm break-all">
					{entry.source?.type} · {entry.source?.reference}
					{entry.source?.commit ?? entry.fingerprint}
				</p>
			</details>
			{#each data.backups.filter((b) => b.extension_id === entry.id) as b (b.backup_id)}<p
					class="text-sm"
				>
					<a class="link" href={`/extensions/backup/${b.backup_id}`}
						>Download backup · {new Date(b.created_at).toLocaleString()}</a
					>
				</p>{/each}
		</SectionCard>
	{/each}
	{#if form?.preview}<SectionCard title="Review extension restore"
			><RestorePreview
				title="Extension database"
				rows={[
					{
						label: 'Extension version',
						current: form.preview.installed_version,
						incoming: form.preview.extension_version
					},
					...Object.keys(form.preview.incoming_counts).map((name) => ({
						label: name,
						current: form.preview.current_counts[name] ?? 0,
						incoming: form.preview.incoming_counts[name]
					})),
					{
						label: 'Schema version',
						current: form.preview.result_schema_version,
						incoming: form.preview.schema_version
					}
				]}
			/>
			{#if form.preview.backup_dataset_id !== form.preview.current_dataset_id}<Notice
					title="Core data differs"
					>Stored references to another core dataset remain unresolved. Restoration does not relink
					them.</Notice
				>{/if}
			<p class="text-sm">
				Only this extension’s data is replaced. A recovery backup is saved first; jobs and Documents
				are separate.
			</p>
			<form method="POST" action="?/run" id="restore-extension">
				<input type="hidden" name="operation" value="restore" /><input
					type="hidden"
					name="restore_id"
					value={form.preview.restore_id}
				/><input type="hidden" name="confirm" value="true" /><Button
					onclick={() => (confirmRestore = true)}>Restore extension</Button
				>
			</form></SectionCard
		>{/if}
</PageShell>
<form
	method="POST"
	action="?/run"
	id="extension-action"
	use:enhance={withPending(() => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type === 'redirect') {
			removing = false;
			confirmRestore = false;
		} else focusFirstError();
	})}
>
	<input type="hidden" name="id" value={selected?.id ?? ''} /><input
		type="hidden"
		name="operation"
		value={operation}
	/><input type="hidden" name="confirm" value="true" />
</form>
<ConfirmDialog
	bind:open={removing}
	title="Remove extension?"
	description="The extension will stop accepting operations immediately. Complete removal with the uninstall command after stopping Saturday. Its data and backups are kept."
	confirmLabel="Remove extension"
	formId="extension-action"
	destructive
	>{#if form?.extensionError}<Notice tone="error" title="Removal failed"
			>{form.extensionError}</Notice
		>{/if}</ConfirmDialog
>
<ConfirmDialog
	bind:open={confirmRestore}
	title="Restore extension data?"
	description="Replace only the previewed extension database. A recovery snapshot will be retained."
	confirmLabel="Restore extension"
	formId="restore-extension"
	destructive
/>
<Dialog.Root bind:open={restoring}
	><Dialog.Content class="sm:max-w-lg"
		><Dialog.Header
			><Dialog.Title>Restore {selected?.manifest.name ?? 'extension'}</Dialog.Title
			><Dialog.Description
				>Choose a matching saved backup or import an extension archive.</Dialog.Description
			></Dialog.Header
		>{#if uploadError}<Notice tone="error" title="Import failed">{uploadError}</Notice>{/if}
		<input
			type="file"
			class="hidden"
			aria-label="Import extension backup"
			accept=".zip"
			bind:this={fileInput}
			onchange={(e) => {
				const file = e.currentTarget.files?.[0];
				e.currentTarget.value = '';
				if (file) upload(file);
			}}
		/><Button variant="outline" disabled={uploading} onclick={() => fileInput.click()}
			>{uploading ? 'Importing…' : 'Import backup'}</Button
		>
		<form method="POST" action="?/run" class="space-y-4">
			<input type="hidden" name="operation" value="preview" /><input
				type="hidden"
				name="id"
				value={selected?.id ?? ''}
			/><Field id="extension-backup" label="Backup"
				>{#snippet control(attrs)}<NativeSelect {...attrs} name="backup_id" bind:value={backupId}
						><option value="">Choose a backup</option
						>{#each data.backups.filter((b) => b.extension_id === selected?.id) as b}<option
								value={b.backup_id}
								>{b.extension_version} · {new Date(b.created_at).toLocaleString()}</option
							>{/each}</NativeSelect
					>{/snippet}</Field
			><Dialog.Footer
				><Button variant="ghost" onclick={() => (restoring = false)}>Cancel</Button><Button
					type="submit"
					disabled={!backupId}>Preview restore</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content></Dialog.Root
>
