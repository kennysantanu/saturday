<script lang="ts">
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/toast.svelte';
	import { enhance } from '$app/forms';
	import { enhanceWithFocus } from '$lib/forms';
	import { page } from '$app/state';
	import ConfirmDialog from '$lib/components/app/confirm-dialog.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import Clipboard from '@lucide/svelte/icons/clipboard';
	import Check from '@lucide/svelte/icons/check';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';

	let { data, form } = $props();
	let confirmRestore = $state(false);
	let copied = $state<'path' | 'config' | null>(null);
	let copyError = $state('');

	async function copy(kind: 'path' | 'config', text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = kind;
			copyError = '';
			setTimeout(() => (copied = null), 2000);
		} catch {
			copyError = 'Select the text and copy it manually.';
		}
	}
	let pairConfirm = $state(false);
	let confirm = $state(false),
		uploading = $state(false),
		uploadError = $state('');
	async function importArchive(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		uploading = true;
		uploadError = '';
		try {
			const r = await fetch('/settings/files/import', {
				method: 'POST',
				headers: { 'content-type': 'application/zip' },
				body: file
			});
			const body = await r.json();
			if (!r.ok) throw new Error(body.error);
			toast.show('File backup imported. Choose it below to preview restore.');
			await invalidateAll();
		} catch (e) {
			uploadError = (e as Error).message;
		} finally {
			uploading = false;
		}
	}
</script>

<svelte:head><title>Settings · Saturday</title></svelte:head>

<div class="space-y-8">
	<PageHeader
		title="Settings"
		description="Backups, local storage, and your assistant connection."
	/>

	<Card.Root>
		<Card.Header>
			<Card.Title>Backup and restore</Card.Title>
			<Card.Description
				>Save a portable copy of your jobs and history. Backups contain private data and are not
				encrypted.</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-6">
			{#if form?.backupError}<Notice tone="error" title="Backup operation failed"
					>{form.backupError}</Notice
				>{/if}
			{#if page.url.searchParams.get('recovery')}
				<Notice tone="success" title="Backup restored"
					>Your previous records are saved in a recovery backup.
					<a class="underline" href={`/settings/backups/${page.url.searchParams.get('recovery')}`}
						>Download recovery backup</a
					>
				</Notice>
			{/if}
			<form method="POST" action="?/download" class="form-actions">
				<Button type="submit">Download backup</Button>
			</form>
			<form
				method="POST"
				action="?/schedule"
				use:enhance={enhanceWithFocus}
				class="inset-surface space-y-4 p-4"
			>
				<label class="flex items-center gap-3 font-medium"
					><input type="checkbox" name="enabled" checked={data.backupSettings.enabled} />Automatic
					backups</label
				>
				<p class="text-sm text-muted-foreground">
					Runs while Saturday is running and your computer is awake. One catch-up backup is made
					after downtime.
				</p>
				<div class="grid gap-4 sm:grid-cols-2">
					<label class="space-y-2 text-sm"
						><span>Every N hours</span><Input
							type="number"
							name="interval_hours"
							min="1"
							max="168"
							step="1"
							required
							value={data.backupSettings.interval_hours}
						/></label
					>
					<label class="space-y-2 text-sm"
						><span>Keep N automatic backups</span><Input
							type="number"
							name="keep_count"
							min="1"
							max="100"
							step="1"
							required
							value={data.backupSettings.keep_count}
						/></label
					>
				</div>
				<p class="text-sm text-muted-foreground">
					Older automatic backups are deleted after a new backup succeeds. Manual, imported, and
					recovery backups are kept. This limits file count, not total storage.
				</p>
				<div class="text-sm text-muted-foreground" aria-live="polite">
					<p>
						Last automatic backup: {data.backupSettings.last_success_at
							? new Date(data.backupSettings.last_success_at).toLocaleString()
							: 'None yet'}
					</p>
					<p>
						Next due: {data.backupSettings.enabled && data.backupSettings.next_due_at
							? new Date(data.backupSettings.next_due_at).toLocaleString()
							: 'Disabled'}
					</p>
					{#if data.backupSettings.last_error}<p role="alert">
							{data.backupSettings.last_error.message}
						</p>{/if}
				</div>
				<div class="form-actions">
					<Button type="submit" variant="outline">Save backup settings</Button>
				</div>
			</form>
			<form
				method="POST"
				action="?/prepare"
				enctype="multipart/form-data"
				use:enhance={enhanceWithFocus}
				class="space-y-4"
			>
				<h3 class="font-medium">Restore a backup</h3>
				<label class="block space-y-2 text-sm"
					><span>Upload a SQLite backup (up to 100 MiB)</span><Input
						type="file"
						name="backup_file"
						accept=".sqlite,.db"
					/></label
				>
				<label class="block space-y-2 text-sm"
					><span>Or select a saved backup</span>
					<select
						name="backup_id"
						class="w-full rounded-[var(--r-control)] border bg-background px-3 py-2"
					>
						<option value="">Choose a backup</option>
						{#each data.backups as backup (backup.backup_id)}<option value={backup.backup_id}
								>{backup.kind} · {new Date(backup.created_at).toLocaleString()} · {backup.job_count}
								{backup.job_count === 1 ? 'job' : 'jobs'}</option
							>{/each}
					</select>
				</label>
				<p class="text-sm text-muted-foreground">
					An uploaded file takes priority. Preview before replacing your current records.
				</p>
				<div class="form-actions">
					<Button type="submit" variant="outline">Preview restore</Button>
				</div>
			</form>
			{#if form?.preview}
				<div class="inset-surface space-y-3 p-4" role="status">
					<h3 class="font-medium">Restore preview</h3>
					<p>
						Current: {form.preview.current.job_count} jobs, {form.preview.current.update_count} job updates,
						{form.preview.current.network_count ?? 0} people, {form.preview.current
							.network_link_count ?? 0} relationships and {form.preview.current
							.network_update_count ?? 0} interactions.
					</p>
					<p>
						Backup: {form.preview.incoming.job_count} jobs, {form.preview.incoming.update_count} job updates,
						{form.preview.incoming.network_count ?? 0} people, {form.preview.incoming
							.network_link_count ?? 0} relationships and {form.preview.incoming
							.network_update_count ?? 0} interactions.
					</p>
					<p class="text-sm">{form.preview.warning}</p>
					{#if form.preview.unmatched_job_folders?.length}<p class="text-sm">
							{form.preview.unmatched_job_folders.length} job document folders will have no matching job
							after this restore. Their files will be kept.
						</p>{/if}
					<p class="text-sm text-muted-foreground">
						Expires {new Date(form.preview.expires_at).toLocaleTimeString()}. If records change,
						preview again.
					</p>
					<form method="POST" action="?/restore" id="restore-backup-form">
						<input type="hidden" name="restore_id" value={form.preview.restore_id} />
						<input type="hidden" name="confirm" value="true" />
						<Button type="button" variant="outline" onclick={() => (confirmRestore = true)}
							>Restore this backup</Button
						>
					</form>
					<ConfirmDialog
						bind:open={confirmRestore}
						title="Replace current records?"
						description="All current jobs, people, relationships and history will be replaced. Older backups clear Network data. A complete recovery backup will be kept."
						confirmLabel="Replace records"
						formId="restore-backup-form"
						destructive
					/>
				</div>
			{/if}
			{#if data.backups.length}
				<div class="space-y-2">
					<h3 class="font-medium">Saved backups</h3>
					<ul class="divide-y">
						{#each data.backups as backup (backup.backup_id)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
								<span
									>{backup.kind} · {new Date(backup.created_at).toLocaleString()} · {backup.job_count}
									jobs · {(backup.bytes / 1024).toFixed(0)} KiB</span
								>
								<a class="underline" href={`/settings/backups/${backup.backup_id}`}
									>Download<span class="sr-only"> {backup.filename}</span></a
								>
							</li>
						{/each}
					</ul>
					<p class="text-xs text-muted-foreground">
						Showing up to 50 recent backups. Refresh to see new automatic backups.
					</p>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root
		><Card.Header
			><Card.Title>File backups</Card.Title><Card.Description
				>Back up user documents, job attachments and the file manifest separately from SQLite.
				Archives contain private data and are not encrypted.</Card.Description
			></Card.Header
		><Card.Content class="space-y-5">
			{#if data.filesError || form?.fileError || uploadError}<Notice tone="error"
					>{data.filesError || form?.fileError || uploadError}</Notice
				>{/if}
			{#if data.fileSummary}<p class="text-sm text-muted-foreground">
					{data.fileSummary.count} files · {(data.fileSummary.bytes / 1024 / 1024).toFixed(1)} MiB
				</p>
				<p class="inset-surface p-3 font-mono text-sm break-all">{data.fileSummary.root}</p>{/if}
			<div class="form-actions">
				<form method="POST" action="?/fileBackup" use:enhance={enhanceWithFocus}>
					<Button type="submit" variant="outline">Back up files now</Button>
				</form>
				<form method="POST" action="?/pairBackup" use:enhance={enhanceWithFocus}>
					<Button type="submit" variant="outline">Back up database and files</Button>
				</form>
			</div>
			<form
				method="POST"
				action="?/fileSchedule"
				use:enhance={enhanceWithFocus}
				class="inset-surface space-y-4 p-4"
			>
				<label class="flex items-center gap-3"
					><input type="checkbox" name="enabled" checked={data.fileSettings.enabled} />Automatic
					file backups</label
				>
				<div class="grid gap-4 sm:grid-cols-2">
					<label class="space-y-2 text-sm"
						><span>Backup interval (hours)</span><Input
							type="number"
							name="interval_hours"
							min="1"
							max="168"
							step="1"
							required
							value={data.fileSettings.interval_hours}
						/></label
					><label class="space-y-2 text-sm"
						><span>Number of automatic backups retained</span><Input
							type="number"
							name="keep_count"
							min="1"
							max="100"
							step="1"
							required
							value={data.fileSettings.keep_count}
						/></label
					>
				</div>
				<p class="text-sm text-muted-foreground">
					Runs while Saturday is running and your computer is awake. Older automatic file backups
					are removed only after a new one succeeds. Manual and recovery backups stay.
				</p>
				<div class="space-y-1 text-sm text-muted-foreground" aria-live="polite">
					<p>
						Status: {data.fileSettings.running
							? 'Running'
							: data.fileSettings.last_error
								? 'Failed'
								: data.fileSettings.enabled
									? 'Scheduled'
									: 'Disabled'}
					</p>
					<p>
						Last success: {data.fileSettings.last_success_at
							? new Date(data.fileSettings.last_success_at).toLocaleString()
							: 'None yet'}
					</p>
					<p>
						Next run: {data.fileSettings.enabled
							? data.fileSettings.next_due_at
								? new Date(data.fileSettings.next_due_at).toLocaleString()
								: 'Due'
							: 'Disabled'}
					</p>
					{#if data.fileSettings.last_error}<p role="alert">
							{data.fileSettings.last_error.message}
						</p>{/if}
				</div>
				<div class="form-actions">
					<Button type="submit" variant="outline">Save file backup settings</Button>
				</div>
			</form>
			<label class="block space-y-2 text-sm"
				><span>{uploading ? 'Importing and validating archive…' : 'Import a file backup ZIP'}</span
				><Input type="file" accept=".zip" disabled={uploading} onchange={importArchive} /></label
			>
			<form method="POST" action="?/filePrepare" use:enhance={enhanceWithFocus} class="space-y-3">
				<label class="block space-y-2 text-sm"
					><span>Saved file backup</span><NativeSelect name="backup_id" required
						><option value="">Choose a backup</option>{#each data.fileBackups as b}<option
								value={b.backup_id}
								>{b.kind} · {new Date(b.created_at).toLocaleString()} · {b.file_count} files</option
							>{/each}</NativeSelect
					></label
				><label class="block space-y-2 text-sm"
					><span>Restore mode</span><NativeSelect name="mode"
						><option value="add">Add missing files</option><option value="replace"
							>Replace entire file collection</option
						></NativeSelect
					></label
				>
				<div class="form-actions">
					<Button type="submit" variant="outline">Preview file restore</Button>
				</div>
			</form>
			{#if form?.filePreview}<div class="inset-surface space-y-3 p-4">
					<h3 class="font-medium">File restore preview</h3>
					<p>
						Current: {form.filePreview.current_count} files. Backup: {form.filePreview
							.incoming_count} files. Result: {form.filePreview.result_count} files. Removed: {form
							.filePreview.removed}.
					</p>
					<p class="text-sm">{form.filePreview.warning}</p>
					<p class="text-sm">
						Master CV: {form.filePreview.master_cv_before ?? 'Not selected'} → {form.filePreview
							.master_cv_after ?? 'Not selected'}
					</p>
					<form method="POST" action="?/fileRestore" id="restore-files">
						<input type="hidden" name="restore_id" value={form.filePreview.restore_id} /><input
							type="hidden"
							name="confirm"
							value="true"
						/><Button variant="outline" type="button" onclick={() => (confirm = true)}
							>Restore files</Button
						>
					</form>
					<ConfirmDialog
						bind:open={confirm}
						title="Restore file backup?"
						description="Apply the previewed changes to your files. A complete recovery backup of the current files will be kept."
						confirmLabel="Restore files"
						formId="restore-files"
						destructive
					/>
				</div>{/if}
			{#if form?.filePairPreview}<div class="inset-surface space-y-3 p-4">
					<h3 class="font-medium">Coordinated restore preview</h3>
					<p>
						Database: {form.filePairPreview.database.current.job_count} current jobs → {form
							.filePairPreview.database.incoming.job_count} incoming jobs. Network: {form
							.filePairPreview.database.current.network_count ?? 0} current people → {form
							.filePairPreview.database.incoming.network_count ?? 0} incoming people; {form
							.filePairPreview.database.incoming.network_link_count ?? 0} relationships and {form
							.filePairPreview.database.incoming.network_update_count ?? 0} interactions.
					</p>
					<p>
						Files: {form.filePairPreview.files.current_count} current → {form.filePairPreview.files
							.result_count} incoming. Removed: {form.filePairPreview.files.removed}.
					</p>
					<p class="text-sm">
						Both collections will be replaced. Separate recovery artifacts are kept. An interrupted
						restore requires offline recovery before writes resume.
					</p>
					<form method="POST" action="?/filePairRestore" id="restore-file-pair">
						<input type="hidden" name="restore_id" value={form.filePairPreview.restore_id} /><input
							type="hidden"
							name="confirm"
							value="true"
						/><Button type="button" variant="outline" onclick={() => (pairConfirm = true)}
							>Restore database and files</Button
						>
					</form>
					<ConfirmDialog
						bind:open={pairConfirm}
						title="Replace database and files?"
						description="Apply both previewed snapshots. Recovery copies will be kept."
						confirmLabel="Restore both"
						formId="restore-file-pair"
						destructive
					/>
				</div>{/if}

			{#if data.fileBackups.length}<ul class="divide-y">
					{#each data.fileBackups as b}<li
							class="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
						>
							<span
								>{b.kind} · {new Date(b.created_at).toLocaleString()} · {b.file_count} files · {(
									b.bytes /
									1024 /
									1024
								).toFixed(1)} MiB{#if b.backup_set_id}
									· Paired{/if}</span
							><a class="underline" href={`/settings/files/${b.backup_id}`}
								>Download<span class="sr-only"> {b.filename}</span></a
							>
							{#if b.backup_set_id}<form
									method="POST"
									action="?/filePairPrepare"
									use:enhance={enhanceWithFocus}
								>
									<input type="hidden" name="file_backup_id" value={b.backup_id} /><Button
										variant="outline"
										size="sm"
										type="submit">Preview coordinated restore</Button
									>
								</form>{/if}
							>
						</li>{/each}
				</ul>{/if}
			{#if data.fileSummary?.unmatched.length}<div class="space-y-2">
					<h3 class="font-medium">Unmatched job folders</h3>
					<p class="text-sm text-muted-foreground">
						These files belong to jobs absent from the current database. They are preserved in
						backups.
					</p>
					{#each data.fileSummary.unmatched as id}<a
							class="block break-all underline"
							href={`/settings/files/recovery/${id}`}>{id}</a
						>{/each}
				</div>{/if}
			{#if data.pdfStatus}<p class="text-sm text-muted-foreground">{data.pdfStatus.message}</p>{/if}
		</Card.Content></Card.Root
	>
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Connect an assistant</Card.Title>
			<Card.Description
				>Let an assistant on this computer work with your jobs, network and documents in Saturday.</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-5">
			{#if data.mcpReady}
				<Notice tone="success" title="MCP entry point is built"
					>The desktop client will start this process when it connects.</Notice
				>
			{:else}
				<Notice tone="info" title="Build the MCP entry point first"
					>Run <code>npm run build:mcp</code> in this project folder.</Notice
				>
			{/if}
			<ol class="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
				<li>
					Build the MCP entry point with <code>npm run build:mcp</code>.
				</li>
				<li>Copy the configuration below into the desktop client's local MCP settings.</li>
				<li>Reconnect the client, then ask it to list your jobs to check the connection.</li>
			</ol>
			<div class="space-y-2">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<p class="text-sm font-medium" role="status">
						{copied === 'config' ? 'Configuration copied' : 'Local desktop configuration'}
					</p>
					<Button variant="outline" size="sm" onclick={() => copy('config', data.configuration)}>
						{#if copied === 'config'}<Check data-icon="inline-start" />Copied{:else}<Clipboard
								data-icon="inline-start"
							/>Copy config{/if}
					</Button>
				</div>
				<pre
					class="inset-surface overflow-x-auto bg-muted/50 p-4 text-xs leading-relaxed whitespace-pre"><code
						>{data.configuration}</code
					></pre>
				{#if copyError}<p class="text-sm text-muted-foreground">{copyError}</p>{/if}
				<p class="text-xs text-muted-foreground">
					This configuration points at the same database path shown below. It includes absolute
					paths for the current project and Node installation.
				</p>
			</div>
			<div class="inset-surface px-4 py-3 text-sm">
				<p class="font-medium">Connection check</p>
				<p class="mt-1 text-muted-foreground">
					In ChatGPT Work, ask: “List my jobs in Saturday.” A result from <code>list_jobs</code> confirms
					the local MCP process can read this database.
				</p>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Local database</Card.Title>
			<Card.Description
				>Saturday stores jobs and history locally. Backup files are saved beside the database.</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-3">
			<div class="flex flex-wrap items-center gap-3">
				<p
					class="min-w-0 flex-1 rounded-[var(--r-group)] bg-muted px-3 py-2.5 font-mono text-sm break-all text-muted-foreground"
				>
					{data.databasePath}
				</p>
				<Button
					variant="outline"
					size="sm"
					aria-label="Copy database path"
					onclick={() => copy('path', data.databasePath)}
				>
					{#if copied === 'path'}<Check data-icon="inline-start" />Copied{:else}<Clipboard
							data-icon="inline-start"
						/>Copy path{/if}
				</Button>
			</div>
			<p class="text-sm text-muted-foreground">
				Set <code>SATURDAY_DB_PATH</code> before starting Saturday to use another location.
			</p>
		</Card.Content>
	</Card.Root>
</div>
