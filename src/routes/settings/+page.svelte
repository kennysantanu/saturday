<script lang="ts">
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/toast.svelte';
	import { enhance } from '$app/forms';
	import { withPending, enhanceWithFocus, focusFirstError } from '$lib/forms';
	import { page } from '$app/state';
	import { formatBytes, formatDateTime } from '$lib/format';
	import { documentDesignations } from '$lib/file-types';
	import Clipboard from '@lucide/svelte/icons/clipboard';
	import Check from '@lucide/svelte/icons/check';
	import Archive from '@lucide/svelte/icons/archive';
	import Pagination from '$lib/components/app/pagination.svelte';
	import BackupList from '$lib/components/app/backup-list.svelte';
	import ConfirmDialog from '$lib/components/app/confirm-dialog.svelte';
	import Field from '$lib/components/app/field.svelte';
	import NativeSelect from '$lib/components/app/native-select.svelte';
	import Notice from '$lib/components/app/notice.svelte';
	import PageHeader from '$lib/components/app/page-header.svelte';
	import PageShell from '$lib/components/app/page-shell.svelte';
	import RestorePreview from '$lib/components/app/restore-preview.svelte';
	import Checkbox from '$lib/components/app/checkbox.svelte';
	import SectionCard from '$lib/components/app/section-card.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let { data, form } = $props();
	let deleteOpen = $state(false);
	let confirmDelete = $state<{ id: string; contents: string } | null>(null);
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
	async function importArchive(e: Event, bundle = false) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		uploading = true;
		uploadError = '';
		try {
			const r = await fetch(`/settings/files/import${bundle ? '?bundle=true' : ''}`, {
				method: 'POST',
				headers: { 'content-type': 'application/zip' },
				body: file
			});
			const body = await r.json();
			if (!r.ok) throw new Error(body.error);
			toast.show('Backup imported. Choose it in Saved backup to preview restore.');
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
	const backupRows = $derived(
		data.backupHistory.map((b: any) => ({
			id: b.backup_id,
			kind: b.kind,
			createdAt: b.created_at,
			detail: `${b.status === 'partial' ? 'Incomplete set · ' : ''}${b.contents === 'files' ? `${b.file_count} files` : `${b.job_count} jobs`}${b.files ? ` · ${b.files.file_count} files` : ''} · ${formatBytes(b.bytes + (b.files?.bytes ?? 0))}`,
			href: `/settings/backups/${b.backup_id}?contents=${b.contents}`,
			status: b.status,
			scope: b.contents,
			filename: b.filename,
			contents:
				b.contents === 'all'
					? 'Database + files'
					: b.contents === 'files'
						? 'Files only'
						: 'Database only',
			downloadLabel: b.status === 'partial' ? 'Download available artifact' : 'Download'
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
		<a href="#storage">Storage</a><a href="#extensions">Extensions</a>
	</nav>

	<SectionCard
		id="extensions"
		title="Extensions"
		description="Trusted custom pages and MCP tools. Installed code runs with Saturday’s access."
	>
		{#if data.extensionsError}<Notice tone="error" title="Extensions unavailable"
				>{data.extensionsError}</Notice
			>{/if}
		{#if form?.extensionError}<Notice tone="error" title="Extension setting was not saved"
				>{form.extensionError}</Notice
			>{/if}
		<form method="POST" action="?/extensions" use:enhance={enhanceWithFocus} class="space-y-4">
			<Checkbox name="enabled" label="Enable extensions" checked={data.extensionsEnabled} />
			<div class="form-actions">
				<Button variant="outline" href="/extensions">Installed extensions and recovery</Button
				><Button type="submit">Save extension setting</Button>
			</div>
		</form>
		<p class="text-sm text-muted-foreground">
			Core database and file backups exclude extension databases. Back up each extension from its
			list actions.
		</p>
	</SectionCard>

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
			<li>
				Use the configuration below in a desktop client that accepts <code>mcpServers</code> JSON. ChatGPT
				Work desktop uses the same command, arguments and environment values in its TOML MCP settings.
			</li>
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
		description="Back up your Saturday database and documents together or separately. Extension databases have separate backups. Backups contain private data and are not encrypted."
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
		{#if data.filesError || form?.fileError || uploadError}<Notice
				tone="error"
				title="File operation failed">{data.filesError || form?.fileError || uploadError}</Notice
			>{/if}
		{#if data.fileSummary}
			{#if !data.fileSummary.dataset_matches_database && data.fileSummary.unmatched.length}
				<Notice title="Job attachments need a matching database">
					These files belong to another dataset. Restore matching database and file backups to use
					job attachments. User documents remain available, and existing files are kept for
					recovery.
				</Notice>
			{/if}
			<p class="text-sm text-muted-foreground">
				{data.fileSummary.count}
				{data.fileSummary.count === 1 ? 'file' : 'files'} · {formatBytes(data.fileSummary.bytes)}
			</p>
		{/if}

		<form method="POST" action="?/backup" use:enhance={enhanceWithFocus} class="space-y-4">
			<Field id="backup_contents" label="Include">
				{#snippet control(attrs)}<NativeSelect {...attrs} name="contents">
						<option value="all">Database and files</option><option value="files">Files only</option
						><option value="database">Database only</option>
					</NativeSelect>{/snippet}
			</Field>
			<div class="form-actions">
				<Button type="submit"><Archive data-icon="inline-start" />Back up now</Button>
			</div>
		</form>
		<p class="meta-text text-muted-foreground">
			Backups are saved locally and kept until you delete them. Download a copy to another drive to
			protect against disk failure.
		</p>
		<Field
			id="bundle_import"
			label={uploading ? 'Importing backup…' : 'Import a combined backup ZIP'}
		>
			{#snippet control(attrs)}<Input
					{...attrs}
					type="file"
					accept=".zip"
					disabled={uploading}
					onchange={(e) => importArchive(e, true)}
				/>{/snippet}
		</Field>
		{#if uploadError}<Notice tone="error" title="Backup import failed">{uploadError}</Notice>{/if}

		<form
			method="POST"
			action="?/prepare"
			enctype="multipart/form-data"
			use:enhance={enhanceWithFocus}
			class="space-y-4"
		>
			<h3 class="font-medium">Restore a backup</h3>

			<Field id="backup_id" label="Saved backup">
				{#snippet control(attrs)}
					<NativeSelect {...attrs} name="backup_id">
						<option value="">Choose a backup</option>
						{#each data.backupHistory as backup (backup.backup_id)}
							<option
								value={`${backup.status === 'partial' ? (backup.contents === 'files' ? 'files' : 'database') : backup.contents}:${backup.backup_id}`}
								>{formatDateTime(backup.created_at)} · {backup.status === 'partial'
									? `Partial — ${backup.contents === 'files' ? 'files only' : 'database only'}`
									: backup.contents === 'all'
										? 'Database and files'
										: backup.contents === 'files'
											? 'Files only'
											: 'Database only'}</option
							>
						{/each}
					</NativeSelect>
				{/snippet}
			</Field>
			<details class="disclosure">
				<summary>Import a database backup</summary>
				<div class="disclosure-body">
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
				</div>
			</details>
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
				description="All current jobs, people, relationships and history will be replaced. A complete recovery backup will be kept."
				confirmLabel="Replace records"
				formId="restore-backup-form"
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
				<p class="text-sm">{form.filePairPreview.database.warning}</p>
				<p class="text-sm">{form.filePairPreview.files.warning}</p>
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
					...Object.entries(documentDesignations).map(([key, definition]) => ({
						label: definition.label,
						current: form.filePreview.designations_before?.[key] ?? 'Not selected',
						incoming: form.filePreview.designations_after?.[key] ?? 'Not selected'
					}))
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

		<BackupList
			title="Saved backups"
			items={backupRows}
			note={`${data.backupTotal} saved backups. Delete only backups you no longer need.`}
		>
			{#snippet extra(item)}
				<form method="POST" action="?/prepare" use:enhance={enhanceWithFocus}>
					<input
						type="hidden"
						name="backup_id"
						value={`${item.status === 'partial' ? (item.scope === 'files' ? 'files' : 'database') : item.scope}:${item.id}`}
					/>
					<Button type="submit" variant="outline" size="sm">Restore</Button>
				</form>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => {
						confirmDelete = { id: item.id, contents: item.scope ?? 'database' };
						deleteOpen = true;
					}}>Delete</Button
				>
			{/snippet}
		</BackupList>
		<Pagination
			page={data.backupPage}
			totalPages={data.backupPages}
			label="Backup history pages"
			previous={`/settings?backup_page=${data.backupPage - 1}#backups`}
			next={`/settings?backup_page=${data.backupPage + 1}#backups`}
		/>
		<form
			method="POST"
			action="?/deleteBackup"
			id="delete-backup"
			use:enhance={withPending(() => async ({ update }) => {
				deleteOpen = false;
				await update();
				await tick();
				focusFirstError();
			})}
		>
			<input type="hidden" name="backup_id" value={confirmDelete?.id ?? ''} />
			<input type="hidden" name="contents" value={confirmDelete?.contents ?? ''} />
			<input type="hidden" name="confirm" value="true" />
		</form>
		<ConfirmDialog
			bind:open={deleteOpen}
			title="Delete this backup?"
			description="The selected backup artifacts will be permanently deleted. Your current records and documents will remain."
			confirmLabel="Delete backup"
			formId="delete-backup"
			destructive
		/>
		<details class="disclosure" open={Boolean(form?.fileError || uploadError)}>
			<summary>Advanced file recovery</summary>
			<div class="disclosure-body space-y-4">
				{#if data.fileSummary}<p class="inset-surface p-3 font-mono text-sm break-all">
						{data.fileSummary.root}
					</p>{/if}
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
				{#if data.pdfStatus}<p class="text-sm text-muted-foreground">
						{data.pdfStatus.message}
					</p>{/if}
			</div>
		</details>
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
		<details class="disclosure">
			<summary>Diagnostics</summary>
			<div class="disclosure-body space-y-4">
				<p class="text-sm text-muted-foreground">
					Select and copy these details when reporting a problem. Development builds remain
					unversioned until the 0.1.0 release.
				</p>
				<dl class="space-y-4 text-sm">
					{#each [['Development build', data.buildInfo.id], ['Database schema', data.diagnostics.databaseVersion], ['Database format', data.diagnostics.databaseFormat], ['File manifest version', data.diagnostics.manifestVersion ?? 'Unavailable'], ['File manifest format', data.diagnostics.manifestFormat ?? 'Unavailable'], ['Database', data.diagnostics.databasePaths.database], ['Database backups', data.diagnostics.databasePaths.backups], ['Database restore staging', data.diagnostics.databasePaths.restore], ['Files', data.diagnostics.filePaths.root], ['File backups', data.diagnostics.filePaths.backups], ['File recovery state', data.diagnostics.filePaths.state]] as [label, value] (label)}
						<div>
							<dt class="font-medium">{label}</dt>
							<dd class="mt-1 font-mono break-all text-muted-foreground select-text">{value}</dd>
						</div>
					{/each}
				</dl>
			</div>
		</details>
	</SectionCard>
</PageShell>
