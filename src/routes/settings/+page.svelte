<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/toast.svelte';
	import { enhance } from '$app/forms';
	import { enhanceWithFocus } from '$lib/forms';
	import { page } from '$app/state';
	import { formatBytes, formatDateTime } from '$lib/format';
	import Clipboard from '@lucide/svelte/icons/clipboard';
	import Check from '@lucide/svelte/icons/check';
	import Download from '@lucide/svelte/icons/download';
	import BackupList from '$lib/components/app/backup-list.svelte';
	import ConfirmDialog from '$lib/components/app/confirm-dialog.svelte';
	import Field from '$lib/components/app/field.svelte';
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import RestorePreview from '$lib/components/app/restore-preview.svelte';
	import SchedulePanel from '$lib/components/app/schedule-panel.svelte';
	import SectionCard from '$lib/components/app/section-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let { data, form } = $props();
	let confirmRestore = $state(false);
	let confirmFiles = $state(false);
	let confirmPair = $state(false);
	let copied = $state<'path' | 'config' | null>(null);
	let copyError = $state('');
	let uploading = $state(false),
		uploadError = $state('');

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
	const records = (counts: Record<string, number | undefined>) => ({
		jobs: counts.job_count ?? 0,
		updates: counts.update_count ?? 0,
		people: counts.network_count ?? 0,
		links: counts.network_link_count ?? 0,
		interactions: counts.network_update_count ?? 0
	});
	function databaseRows(
		current: Record<string, number | undefined>,
		incoming: Record<string, number | undefined>
	) {
		const a = records(current);
		const b = records(incoming);
		return [
			{ label: 'Jobs', current: a.jobs, incoming: b.jobs },
			{ label: 'Job updates', current: a.updates, incoming: b.updates },
			{ label: 'People', current: a.people, incoming: b.people },
			{ label: 'Relationships', current: a.links, incoming: b.links },
			{ label: 'Interactions', current: a.interactions, incoming: b.interactions }
		];
	}
	const databaseBackups = $derived(
		data.backups.map((b: any) => ({
			id: b.backup_id,
			kind: b.kind,
			createdAt: b.created_at,
			detail: `${b.job_count} ${b.job_count === 1 ? 'job' : 'jobs'} · ${formatBytes(b.bytes)}`,
			href: `/settings/backups/${b.backup_id}`,
			filename: b.filename
		}))
	);
	const fileBackups = $derived(
		data.fileBackups.map((b: any) => ({
			id: b.backup_id,
			kind: b.kind,
			createdAt: b.created_at,
			detail: `${b.file_count} ${b.file_count === 1 ? 'file' : 'files'} · ${formatBytes(b.bytes)}`,
			href: `/settings/files/${b.backup_id}`,
			filename: b.filename,
			paired: Boolean(b.backup_set_id)
		}))
	);
</script>

<PageShell title="Settings">
	<PageHeader
		title="Settings"
		description="Your assistant connection, backups, and local storage."
	/>

	<nav aria-label="Settings sections" class="section-nav">
		<a href="#assistant">Assistant</a>
		<a href="#backups">Backups</a>
		<a href="#files">Files</a>
		<a href="#storage">Storage</a>
	</nav>

	<SectionCard
		id="assistant"
		title="Connect an assistant"
		description="Let an assistant on this computer work with your jobs, network and documents in Saturday."
	>
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
			<li>Build the MCP entry point with <code>npm run build:mcp</code>.</li>
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
				class="inset-surface overflow-x-auto bg-muted/50 p-4 text-sm leading-relaxed whitespace-pre"><code
					>{data.configuration}</code
				></pre>
			{#if copyError}<p class="text-sm text-muted-foreground">{copyError}</p>{/if}
			<p class="meta-text text-muted-foreground">
				This configuration points at the same database path shown under Storage. It includes
				absolute paths for the current project and Node installation.
			</p>
		</div>
		<div class="inset-surface px-4 py-3 text-sm">
			<p class="font-medium">Connection check</p>
			<p class="mt-1 text-muted-foreground">
				In ChatGPT Work, ask: “List my jobs in Saturday.” A result from <code>list_jobs</code> confirms
				the local MCP process can read this database.
			</p>
		</div>
	</SectionCard>

	<SectionCard
		id="backups"
		title="Backup and restore"
		description="Save a portable copy of your jobs and history. Backups contain private data and are not encrypted."
	>
		{#if form?.backupError}<Notice tone="error" title="Backup operation failed"
				>{form.backupError}</Notice
			>{/if}
		{#if page.url.searchParams.get('recovery')}
			<Notice tone="success" title="Backup restored"
				>Your previous records are saved in a recovery backup.
				<a class="link" href={`/settings/backups/${page.url.searchParams.get('recovery')}`}
					>Download recovery backup</a
				>
			</Notice>
		{/if}
		<form method="POST" action="?/download" class="form-actions">
			<Button type="submit"><Download data-icon="inline-start" />Download backup</Button>
		</form>
		<SchedulePanel
			action="?/schedule"
			idPrefix="db_schedule"
			enabled={data.backupSettings.enabled}
			intervalHours={data.backupSettings.interval_hours}
			keepCount={data.backupSettings.keep_count}
			enabledLabel="Automatic backups"
			description="Runs while Saturday is running and your computer is awake. One catch-up backup is made after downtime. Older automatic backups are deleted after a new backup succeeds; manual, imported and recovery backups are kept. This limits file count, not total storage."
			saveLabel="Save backup settings"
		>
			{#snippet status()}
				<p>
					Last automatic backup: {data.backupSettings.last_success_at
						? formatDateTime(data.backupSettings.last_success_at)
						: 'None yet'}
				</p>
				<p>
					Next due: {data.backupSettings.enabled && data.backupSettings.next_due_at
						? formatDateTime(data.backupSettings.next_due_at)
						: 'Disabled'}
				</p>
				{#if data.backupSettings.last_error}<p role="alert" class="text-destructive">
						{data.backupSettings.last_error.message}
					</p>{/if}
			{/snippet}
		</SchedulePanel>

		<form
			method="POST"
			action="?/prepare"
			enctype="multipart/form-data"
			use:enhance={enhanceWithFocus}
			class="space-y-4"
		>
			<h3 class="font-medium">Restore a backup</h3>
			<Field
				id="backup_file"
				label="Upload a SQLite backup"
				hint="Up to 100 MiB. An uploaded file takes priority over a saved backup."
			>
				{#snippet control(attrs)}<Input
						{...attrs}
						type="file"
						name="backup_file"
						accept=".sqlite,.db"
					/>{/snippet}
			</Field>
			<Field id="backup_id" label="Or select a saved backup">
				{#snippet control(attrs)}
					<NativeSelect {...attrs} name="backup_id">
						<option value="">Choose a backup</option>
						{#each data.backups as backup (backup.backup_id)}
							<option value={backup.backup_id}
								>{backup.kind} · {formatDateTime(backup.created_at)} · {backup.job_count}
								{backup.job_count === 1 ? 'job' : 'jobs'}</option
							>
						{/each}
					</NativeSelect>
				{/snippet}
			</Field>
			<div class="form-actions">
				<Button type="submit" variant="outline">Preview restore</Button>
			</div>
		</form>
		{#if form?.preview}
			<RestorePreview
				title="Restore preview"
				rows={databaseRows(form.preview.current, form.preview.incoming)}
			>
				<p class="text-sm">{form.preview.warning}</p>
				{#if form.preview.unmatched_job_folders?.length}<p class="text-sm">
						{form.preview.unmatched_job_folders.length} job document folders will have no matching job
						after this restore. Their files will be kept.
					</p>{/if}
				<p class="text-sm text-muted-foreground">
					Expires {new Date(form.preview.expires_at).toLocaleTimeString()}. If records change,
					preview again.
				</p>
				<form method="POST" action="?/restore" id="restore-backup-form" class="form-actions">
					<input type="hidden" name="restore_id" value={form.preview.restore_id} />
					<input type="hidden" name="confirm" value="true" />
					<Button type="button" variant="outline" onclick={() => (confirmRestore = true)}
						>Restore this backup</Button
					>
				</form>
			</RestorePreview>
			<ConfirmDialog
				bind:open={confirmRestore}
				title="Replace current records?"
				description="All current jobs, people, relationships and history will be replaced. Older backups clear Network data. A complete recovery backup will be kept."
				confirmLabel="Replace records"
				formId="restore-backup-form"
				destructive
			/>
		{/if}
		<BackupList
			title="Saved backups"
			items={databaseBackups}
			note="Showing up to 50 recent backups. Refresh to see new automatic backups."
		/>
	</SectionCard>

	<SectionCard
		id="files"
		title="File backups"
		description="Back up user documents, job attachments and the file manifest separately from SQLite. Archives contain private data and are not encrypted."
	>
		{#if data.filesError || form?.fileError || uploadError}<Notice
				tone="error"
				title="File operation failed">{data.filesError || form?.fileError || uploadError}</Notice
			>{/if}
		{#if data.fileSummary}
			<p class="text-sm text-muted-foreground">
				{data.fileSummary.count}
				{data.fileSummary.count === 1 ? 'file' : 'files'} · {formatBytes(data.fileSummary.bytes)}
			</p>
			<p class="inset-surface p-3 font-mono text-sm break-all">{data.fileSummary.root}</p>
		{/if}
		<div class="form-actions">
			<form method="POST" action="?/fileBackup" use:enhance={enhanceWithFocus}>
				<Button type="submit" variant="outline">Back up files now</Button>
			</form>
			<form method="POST" action="?/pairBackup" use:enhance={enhanceWithFocus}>
				<Button type="submit" variant="outline">Back up database and files</Button>
			</form>
		</div>
		<SchedulePanel
			action="?/fileSchedule"
			idPrefix="file_schedule"
			enabled={data.fileSettings.enabled}
			intervalHours={data.fileSettings.interval_hours}
			keepCount={data.fileSettings.keep_count}
			enabledLabel="Automatic file backups"
			description="Runs while Saturday is running and your computer is awake. Older automatic file backups are removed only after a new one succeeds. Manual and recovery backups stay."
			saveLabel="Save file backup settings"
		>
			{#snippet status()}
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
						? formatDateTime(data.fileSettings.last_success_at)
						: 'None yet'}
				</p>
				<p>
					Next run: {data.fileSettings.enabled
						? data.fileSettings.next_due_at
							? formatDateTime(data.fileSettings.next_due_at)
							: 'Due'
						: 'Disabled'}
				</p>
				{#if data.fileSettings.last_error}<p role="alert" class="text-destructive">
						{data.fileSettings.last_error.message}
					</p>{/if}
			{/snippet}
		</SchedulePanel>
		<Field
			id="file_import"
			label={uploading ? 'Importing and validating archive…' : 'Import a file backup ZIP'}
		>
			{#snippet control(attrs)}<Input
					{...attrs}
					type="file"
					accept=".zip"
					disabled={uploading}
					onchange={importArchive}
				/>{/snippet}
		</Field>
		<form method="POST" action="?/filePrepare" use:enhance={enhanceWithFocus} class="space-y-4">
			<h3 class="font-medium">Restore file backup</h3>
			<Field id="file_backup_id" label="Saved file backup" required>
				{#snippet control(attrs)}
					<NativeSelect {...attrs} name="backup_id" required>
						<option value="">Choose a backup</option>
						{#each data.fileBackups as b (b.backup_id)}<option value={b.backup_id}
								>{b.kind} · {formatDateTime(b.created_at)} · {b.file_count} files</option
							>{/each}
					</NativeSelect>
				{/snippet}
			</Field>
			<Field id="file_restore_mode" label="Restore mode">
				{#snippet control(attrs)}
					<NativeSelect {...attrs} name="mode">
						<option value="add">Add missing files</option>
						<option value="replace">Replace entire file collection</option>
					</NativeSelect>
				{/snippet}
			</Field>
			<div class="form-actions">
				<Button type="submit" variant="outline">Preview file restore</Button>
			</div>
		</form>
		{#if form?.filePreview}
			<RestorePreview
				title="File restore preview"
				columns={['Current', 'After restore']}
				rows={[
					{
						label: 'Files',
						current: form.filePreview.current_count,
						incoming: form.filePreview.result_count
					},
					{
						label: 'Master CV',
						current: form.filePreview.master_cv_before ?? 'Not selected',
						incoming: form.filePreview.master_cv_after ?? 'Not selected'
					}
				]}
			>
				<p class="text-sm">
					The backup contains {form.filePreview.incoming_count} files; {form.filePreview.removed} will
					be removed.
				</p>
				<p class="text-sm">{form.filePreview.warning}</p>
				<form method="POST" action="?/fileRestore" id="restore-files" class="form-actions">
					<input type="hidden" name="restore_id" value={form.filePreview.restore_id} /><input
						type="hidden"
						name="confirm"
						value="true"
					/><Button variant="outline" type="button" onclick={() => (confirmFiles = true)}
						>Restore files</Button
					>
				</form>
			</RestorePreview>
			<ConfirmDialog
				bind:open={confirmFiles}
				title="Restore file backup?"
				description="Apply the previewed changes to your files. A complete recovery backup of the current files will be kept."
				confirmLabel="Restore files"
				formId="restore-files"
				destructive
			/>
		{/if}
		{#if form?.filePairPreview}
			<RestorePreview
				title="Coordinated restore preview"
				columns={['Current', 'After restore']}
				rows={[
					...databaseRows(
						form.filePairPreview.database.current,
						form.filePairPreview.database.incoming
					),
					{
						label: 'Files',
						current: form.filePairPreview.files.current_count,
						incoming: form.filePairPreview.files.result_count
					}
				]}
			>
				<p class="text-sm">
					Both collections will be replaced; {form.filePairPreview.files.removed} files will be removed.
					Separate recovery artifacts are kept. An interrupted restore requires offline recovery before
					writes resume.
				</p>
				<form method="POST" action="?/filePairRestore" id="restore-file-pair" class="form-actions">
					<input type="hidden" name="restore_id" value={form.filePairPreview.restore_id} /><input
						type="hidden"
						name="confirm"
						value="true"
					/><Button type="button" variant="outline" onclick={() => (confirmPair = true)}
						>Restore database and files</Button
					>
				</form>
			</RestorePreview>
			<ConfirmDialog
				bind:open={confirmPair}
				title="Replace database and files?"
				description="Apply both previewed snapshots. Recovery copies will be kept."
				confirmLabel="Restore both"
				formId="restore-file-pair"
				destructive
			/>
		{/if}

		<BackupList title="Saved file backups" items={fileBackups}>
			{#snippet extra(item)}
				{#if item.paired}
					<form method="POST" action="?/filePairPrepare" use:enhance={enhanceWithFocus}>
						<input type="hidden" name="file_backup_id" value={item.id} /><Button
							variant="outline"
							size="sm"
							type="submit">Preview coordinated restore</Button
						>
					</form>
				{/if}
			{/snippet}
		</BackupList>
		{#if data.fileSummary?.unmatched.length}
			<div class="space-y-2">
				<h3 class="font-medium">Unmatched job folders</h3>
				<p class="text-sm text-muted-foreground">
					These files belong to jobs absent from the current database. They are preserved in
					backups.
				</p>
				{#each data.fileSummary.unmatched as id (id)}<a
						class="link block break-all"
						href={`/settings/files/recovery/${id}`}>{id}</a
					>{/each}
			</div>
		{/if}
		{#if data.pdfStatus}<p class="text-sm text-muted-foreground">{data.pdfStatus.message}</p>{/if}
	</SectionCard>

	<SectionCard
		id="storage"
		title="Local database"
		description="Saturday stores jobs and history locally. Backup files are saved beside the database."
	>
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
	</SectionCard>
</PageShell>
