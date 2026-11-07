<script lang="ts">
	import TagCollectionSettings from '$lib/components/app/tag-collection-settings.svelte';
	import ThemeSettings from '$lib/components/app/theme-settings.svelte';
	import NavigationSettings from '$lib/components/app/navigation-settings.svelte';
	import WorkflowSettings from '$lib/components/app/workflow-settings.svelte';
	import { checkAuthResponse } from '$lib/auth-notice.svelte';
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/toast.svelte';
	import { applyAction, enhance } from '$app/forms';
	import { withPending, enhanceWithFocus, focusFirstError, trackChanges } from '$lib/forms';
	import { page } from '$app/state';
	import { formatBytes, formatDateTime } from '$lib/format';
	import { documentDesignations } from '$lib/file-types';
	import Clipboard from '@lucide/svelte/icons/clipboard';
	import Check from '@lucide/svelte/icons/check';
	import Archive from '@lucide/svelte/icons/archive';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import TagIcon from '@lucide/svelte/icons/tag';
	import Bot from '@lucide/svelte/icons/bot';
	import Puzzle from '@lucide/svelte/icons/puzzle';
	import HardDrive from '@lucide/svelte/icons/hard-drive';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Wifi from '@lucide/svelte/icons/wifi';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ServerIcon from '@lucide/svelte/icons/server';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import PasswordSettings from '$lib/components/app/password-settings.svelte';
	import LanSettings from '$lib/components/app/lan-settings.svelte';
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
	// Saves that finish with a result (not a redirect) confirm with a toast; it repeats for every save.
	$effect(() => {
		if (form?.navigationMessage) toast.show(form.navigationMessage);
		if (form?.workflowSaved)
			toast.show('Workflow saved. Refresh other open windows to see the changes.');
	});
	let updateDialog = $state(false),
		uninstallDialog = $state(false),
		deleteUserData = $state(false);
	let installationProgress = $state<any>(null);
	const installationActive = [
		'queued',
		'staging',
		'waiting_for_disconnect',
		'backing_up',
		'publishing',
		'migrating',
		'restarting',
		'removing'
	];
	let deleteOpen = $state(false);
	let confirmDelete = $state<{ id: string; contents: string } | null>(null);
	let stopDialog = $state(false),
		serverState = $state(''),
		serverMessage = $state('');
	let confirmRestore = $state(false);
	let confirmFiles = $state(false);
	let confirmPair = $state(false);
	let copied = $state<'path' | 'config' | 'toml' | null>(null);
	let copyError = $state('');
	let uploading = $state(false),
		uploadError = $state('');

	// Grouped for the section navigation; the page renders sections in this order.
	const sectionGroups = [
		{
			label: 'General',
			sections: [{ id: 'preferences', label: 'Preferences', icon: SlidersHorizontal }]
		},
		{
			label: 'Job search',
			sections: [
				{ id: 'workflow', label: 'Workflow', icon: ListOrdered },
				{ id: 'tags', label: 'Tags', icon: TagIcon }
			]
		},
		{
			label: 'Assistant',
			sections: [
				{ id: 'assistant', label: 'Assistant', icon: Bot },
				{ id: 'extensions', label: 'Extensions', icon: Puzzle }
			]
		},
		{
			label: 'Data',
			sections: [
				{ id: 'backups', label: 'Backups', icon: Archive },
				{ id: 'storage', label: 'Storage', icon: HardDrive }
			]
		},
		{
			label: 'Security and access',
			sections: [
				{ id: 'password', label: 'Password', icon: KeyRound },
				{ id: 'lan', label: 'LAN access', icon: Wifi }
			]
		},
		{
			label: 'Application',
			sections: [
				{ id: 'updates', label: 'Updates', icon: RefreshCw },
				{ id: 'server', label: 'Server', icon: ServerIcon },
				{ id: 'uninstall', label: 'Uninstall', icon: Trash2 }
			]
		}
	];
	const sections = sectionGroups.flatMap((group) => group.sections);
	// Hash links to the two preference areas still land on them.
	const setupRequired = $derived(!data.installation.descriptor_path);
	let startupDirty = $state<boolean | null>(null);
	let extensionsDirty = $state<boolean | null>(null);
	let activeSection = $state('preferences');
	let pickerOpen = $state(false);
	let pickerBar = $state<HTMLElement>();
	const currentGroup = $derived(
		sectionGroups.find((group) => group.sections.some((section) => section.id === activeSection))
	);
	const currentSection = $derived(sections.find((section) => section.id === activeSection));
	// Opening the sheet brings the current section into view.
	$effect(() => {
		if (pickerOpen)
			document
				.querySelector('.section-picker-sheet a[aria-current="location"]')
				?.scrollIntoView({ block: 'center' });
	});
	function closePicker(refocus = false) {
		pickerOpen = false;
		if (refocus) pickerBar?.focus();
	}

	function updateActiveSection() {
		const root = document.documentElement;
		// The last short section never reaches the top, so the page bottom selects it.
		if (window.scrollY > 0 && window.innerHeight + window.scrollY >= root.scrollHeight - 4) {
			activeSection = sections[sections.length - 1].id;
			return;
		}
		let current = sections[0].id;
		for (const section of sections) {
			const top = document.getElementById(section.id)?.getBoundingClientRect().top;
			if (top !== undefined && top <= 260) current = section.id;
		}
		activeSection = current;
	}
	$effect(() => {
		updateActiveSection();
	});

	async function copy(kind: 'path' | 'config' | 'toml', text: string) {
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
		await uploadArchive(file, bundle);
	}
	async function uploadArchive(file: File, bundle: boolean) {
		uploading = true;
		uploadError = '';
		try {
			const r = await fetch(`/settings/files/import${bundle ? '?bundle=true' : ''}`, {
				method: 'POST',
				headers: { 'content-type': 'application/zip' },
				body: file
			});
			checkAuthResponse(r, { label: file.name, run: () => uploadArchive(file, bundle) });
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
	async function reconnectServer(operation: any) {
		serverState = operation.operation === 'stop' ? 'stopped' : 'restarting';
		serverMessage =
			operation.operation === 'stop'
				? 'The UI server is stopped. Use the Saturday desktop shortcut to return. Your assistant connection remains independent.'
				: 'Restarting Saturday…';
		if (operation.operation !== 'restart') return;
		const deadline = Date.now() + 25000;
		while (Date.now() < deadline) {
			try {
				const response = await fetch('/health', {
					cache: 'no-store',
					signal: AbortSignal.timeout(1500)
				});
				const health = await response.json();
				if (
					response.ok &&
					health.status === 'ready' &&
					health.installation_id === operation.installation_id &&
					health.server_generation === operation.generation
				) {
					window.location.reload();
					return;
				}
			} catch {}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		serverState = 'failed';
		serverMessage =
			'Saturday has not reconnected. Its address may have changed or restart may have failed. Use the Saturday desktop shortcut to reopen the actual server, then check Diagnostics.';
	}
	$effect(() => {
		if (form?.serverOperation) void reconnectServer(form.serverOperation);
	});
	async function pollInstallation(initial: any, cancelled: () => boolean) {
		if (data.access.password_enabled) {
			installationProgress = {
				...initial,
				step: 'Operation continues. Reopen Saturday to sign in and check the result in Settings.'
			};
			return;
		}
		let operation = initial;
		const deadline = Date.now() + 20 * 60 * 1000;
		while (!cancelled() && Date.now() < deadline) {
			installationProgress = operation;
			if (operation.error || !installationActive.includes(operation.status)) {
				if (operation.status === 'complete' && operation.operation !== 'uninstall' && operation.url)
					window.location.assign(`${operation.url}/settings#updates`);
				return;
			}
			await new Promise((r) => setTimeout(r, 750));
			try {
				const response = await fetch(operation.poll_url || '/settings/installation', {
					credentials: 'include',
					cache: 'no-store',
					signal: AbortSignal.timeout(2000)
				});
				if (response.ok) operation = await response.json();
			} catch {
				/* The retained controller continues across UI shutdown. */
			}
		}
		if (!cancelled())
			installationProgress = {
				...operation,
				error:
					'Progress timed out. Inspect the installation log or run the installation status command; do not repeat an uncertain operation.'
			};
	}
	$effect(() => {
		const operation = form?.installationOperation || data.installationOperation;
		if (operation && installationActive.includes(operation.status) && !operation.error) {
			let cancelled = false;
			void pollInstallation(operation, () => cancelled);
			return () => {
				cancelled = true;
			};
		}
	});
	const records = (counts: Record<string, number | undefined>) => ({
		jobs: counts.job_count ?? 0,
		updates: counts.update_count ?? 0,
		people: counts.network_count ?? 0,
		links: counts.network_link_count ?? 0,
		interactions: counts.network_update_count ?? 0,
		reminders: counts.reminder_count ?? 0,
		jobTags: counts.job_tag_count ?? 0,
		peopleTags: counts.network_tag_count ?? 0,
		tagLinks: (counts.job_tag_assignment_count ?? 0) + (counts.network_tag_assignment_count ?? 0)
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
			{ label: 'Interactions', current: a.interactions, incoming: b.interactions },
			{ label: 'Reminders', current: a.reminders, incoming: b.reminders },
			{ label: 'Job tags', current: a.jobTags, incoming: b.jobTags },
			{ label: 'People tags', current: a.peopleTags, incoming: b.peopleTags },
			{ label: 'Tag assignments', current: a.tagLinks, incoming: b.tagLinks }
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

{#snippet sectionLinks(closeOnPick: boolean)}
	{#each sectionGroups as group (group.label)}
		<div class="section-nav-group" role="group" aria-label={group.label}>
			<p class="section-nav-heading" aria-hidden="true">{group.label}</p>
			{#each group.sections as section (section.id)}
				<a
					href={`#${section.id}`}
					aria-current={activeSection === section.id ? 'location' : undefined}
					onclick={() => {
						if (closeOnPick) pickerOpen = false;
					}}><section.icon aria-hidden="true" /><span>{section.label}</span></a
				>
			{/each}
		</div>
	{/each}
{/snippet}

<svelte:window
	onscroll={updateActiveSection}
	onresize={updateActiveSection}
	onkeydown={(event) => {
		if (event.key === 'Escape' && pickerOpen) {
			event.preventDefault();
			closePicker(true);
		}
	}}
/>

<PageShell title="Settings">
	<PageHeader
		title="Settings"
		description="Preferences, your job-search workflow, assistant, backups and storage, security, and updates."
	/>

	<div class="settings-layout">
		<nav aria-label="Settings sections" class="section-nav">
			{@render sectionLinks(false)}
		</nav>
		<div class="section-picker">
			<details class="section-picker-details" bind:open={pickerOpen}>
				<summary class="section-picker-bar" bind:this={pickerBar}>
					<span class="section-picker-label">
						<span class="sr-only">Jump to section: </span>
						<span class="section-picker-group">{currentGroup?.label}</span>
						<span aria-hidden="true" class="section-picker-group">·</span>
						<strong>{currentSection?.label}</strong>
					</span>
					<ChevronDown aria-hidden="true" />
				</summary>
				{#if pickerOpen}<button
						type="button"
						class="section-picker-backdrop"
						tabindex="-1"
						aria-hidden="true"
						onclick={() => closePicker(true)}
					></button>{/if}
				<nav aria-label="Settings sections" class="section-picker-sheet">
					{@render sectionLinks(true)}
				</nav>
			</details>
		</div>

		<div class="settings-sections space-y-10">
			{#if setupRequired}
				<Notice title="Finish Saturday setup">
					Reload Settings after setup to use the host controls: updates, server, password login and
					LAN access. Setup preserves existing records and files.
				</Notice>
			{:else if !data.server.controlsAvailable}
				<Notice title="Some controls are host-only">
					Updates, restart and stop, login startup and uninstall are available from the Saturday
					shortcut on the server computer.
				</Notice>
			{/if}
			<div class="settings-group" role="group" aria-labelledby="group-general">
				<p class="settings-group-label" id="group-general">General</p>
				<SectionCard
					id="preferences"
					title="Preferences"
					description="How Saturday looks in this browser and what it remembers about your recent work."
				>
					<ThemeSettings />
					<NavigationSettings settings={data.navigationSettings} error={form?.navigationError} />
				</SectionCard>
				<a class="settings-top-link" href="#main">Back to top</a>
			</div>
			<div class="settings-group" role="group" aria-labelledby="group-job-search">
				<p class="settings-group-label" id="group-job-search">Job search</p>
				<WorkflowSettings
					stages={data.workflowStages}
					unavailable={data.workflowError}
					form={form ?? undefined}
				/>
				<SectionCard
					id="tags"
					title="Tags"
					description="Organize jobs and people with separate colored tag collections."
				>
					{#if data.tagCollections}<div class="space-y-8">
							<TagCollectionSettings
								collection="job"
								initial={data.tagCollections.job}
							/><TagCollectionSettings collection="person" initial={data.tagCollections.person} />
						</div>{:else}<Notice tone="error" title="Tags unavailable"
							>Repair storage before editing tags.</Notice
						>{/if}
				</SectionCard>
				<a class="settings-top-link" href="#main">Back to top</a>
			</div>
			<div class="settings-group" role="group" aria-labelledby="group-assistant">
				<p class="settings-group-label" id="group-assistant">Assistant</p>
				<SectionCard
					id="assistant"
					title="Assistant"
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
					<div class="inset-surface px-4 py-3 text-sm">
						<p class="font-medium">Connection verification pending</p>
						<p class="mt-1 text-muted-foreground">
							Ask the client to call <code>get_saturday_info</code>, even when you have no jobs.
							Compare installation
							<code class="break-all">{data.installation.installation_id}</code>, dataset
							<code class="break-all">{data.diagnostics.datasetId}</code>, and build
							<code>{data.buildInfo.id}</code>. Then read a known job with <code>get_job</code>.
							Copying configuration does not verify a connection. Repeat after updates or changing
							clients.
						</p>
					</div>

					<div class="space-y-2">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<p class="text-sm font-medium" role="status">
								{copied === 'config' ? 'Configuration copied' : 'Local desktop configuration'}
							</p>
							<Button onclick={() => copy('config', data.configuration)}>
								{#if copied === 'config'}<Check data-icon="inline-start" />Copied{:else}<Clipboard
										data-icon="inline-start"
									/>Copy configuration{/if}
							</Button>
						</div>
						{#if copyError}<p class="text-sm text-muted-foreground">{copyError}</p>{/if}
						<details class="disclosure disclosure-quiet text-sm">
							<summary>Show configuration</summary>
							<div class="disclosure-body">
								<pre
									class="inset-surface bg-muted/50 p-4 text-sm leading-relaxed break-all whitespace-pre-wrap"><code
										>{data.configuration}</code
									></pre>
								<p class="meta-text text-muted-foreground">
									This configuration points at the same database path shown under Storage. It
									includes absolute paths for the current project and Node installation.
								</p>
							</div>
						</details>
					</div>
					<details class="disclosure disclosure-quiet text-sm">
						<summary>ChatGPT / Codex local configuration (TOML)</summary>
						<div class="mt-3 space-y-3">
							<p class="text-muted-foreground">
								Merge into the client’s supported config.toml, preserving other settings. If
								saturday already exists, review and replace only its tables. Reconnect after
								changes.
							</p>
							<Button
								variant="outline"
								size="sm"
								onclick={() => copy('toml', data.configurationToml)}
								>{copied === 'toml' ? 'Copied' : 'Copy TOML'}</Button
							>
							<pre class="overflow-x-auto text-sm whitespace-pre"><code
									>{data.configurationToml}</code
								></pre>
							<a
								class="link"
								href="https://learn.chatgpt.com/docs/extend/mcp"
								target="_blank"
								rel="noreferrer">Client setup documentation</a
							>
						</div>
					</details>

					<details class="disclosure disclosure-quiet text-sm">
						<summary>Setup steps</summary>
						<ol class="mt-3 list-decimal space-y-1.5 pl-5 text-muted-foreground">
							<li>
								If the entry point is missing, use Repair installation or <code
									>npm run build:mcp</code
								>.
							</li>
							<li>
								Use the configuration above in a desktop client that accepts <code>mcpServers</code> JSON.
								Local ChatGPT/Codex clients use the TOML snippet above where their execution mode permits
								local MCP. Hosted-only chats cannot launch this stdio server.
							</li>
							<li>
								Preserve other server entries. Reconnect, then ask for <code>get_saturday_info</code
								> and compare the identities below.
							</li>
						</ol>
					</details>
				</SectionCard>
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
					<form
						method="POST"
						action="?/extensions"
						use:enhance={withPending(() => async ({ update }) => {
							await update({ reset: false });
							await tick();
							focusFirstError();
						})}
						use:trackChanges={{
							set: (value) => (extensionsDirty = value),
							key: data.extensionsEnabled
						}}
						class="space-y-4"
					>
						<Checkbox name="enabled" label="Enable extensions" checked={data.extensionsEnabled} />
						<div class="form-actions">
							<Button variant="outline" href="/extensions">Installed extensions and recovery</Button
							><Button type="submit" disabled={extensionsDirty === false}
								>Save extension setting</Button
							>
						</div>
					</form>
					<p class="text-sm text-muted-foreground">
						Core database and file backups exclude extension databases. Back up each extension from
						its list actions.
					</p>
				</SectionCard>
				<a class="settings-top-link" href="#main">Back to top</a>
			</div>
			<div class="settings-group" role="group" aria-labelledby="group-data">
				<p class="settings-group-label" id="group-data">Data</p>
				<SectionCard
					id="backups"
					title="Backups"
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
							title="File operation failed"
							>{data.filesError || form?.fileError || uploadError}</Notice
						>{/if}
					{#if data.fileSummary && !data.fileSummary.dataset_matches_database && data.fileSummary.unmatched.length}
						<Notice title="Job attachments need a matching database">
							These files belong to another dataset. Restore matching database and file backups to
							use job attachments. User documents remain available, and existing files are kept for
							recovery.
						</Notice>
					{/if}
					<h3 class="text-sm font-semibold">Create a backup</h3>
					<form method="POST" action="?/backup" use:enhance={enhanceWithFocus} class="space-y-4">
						<Field id="backup_contents" label="Include">
							{#snippet control(attrs)}<NativeSelect {...attrs} name="contents">
									<option value="all">Database and files</option><option value="files"
										>Files only</option
									><option value="database">Database only</option>
								</NativeSelect>{/snippet}
						</Field>
						<div class="form-actions">
							<Button type="submit"><Archive data-icon="inline-start" />Back up now</Button>
						</div>
					</form>
					<p class="meta-text text-muted-foreground">
						Backups are saved locally and kept until you delete them. Download a copy to another
						drive to protect against disk failure.
					</p>
					{#if form?.preview}
						<RestorePreview
							title="Restore preview"
							rows={databaseRows(form.preview.current, form.preview.incoming)}
						>
							<p class="text-sm">{form.preview.warning}</p>
							{#if form.preview.unmatched_job_folders?.length}<p class="text-sm">
									{form.preview.unmatched_job_folders.length} job document folders will have no matching
									job after this restore. Their files will be kept.
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
							description="All current jobs, people, relationships, tags, reminders and history will be replaced. A complete recovery backup will be kept."
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
								Both collections will be replaced; {form.filePairPreview.files.removed} files will be
								removed. Separate recovery artifacts are kept. An interrupted restore requires offline
								recovery before writes resume.
							</p>
							<p class="text-sm">{form.filePairPreview.database.warning}</p>
							<p class="text-sm">{form.filePairPreview.files.warning}</p>
							<form
								method="POST"
								action="?/filePairRestore"
								id="restore-file-pair"
								class="form-actions"
							>
								<input
									type="hidden"
									name="restore_id"
									value={form.filePairPreview.restore_id}
								/><input type="hidden" name="confirm" value="true" /><Button
									type="button"
									variant="outline"
									onclick={() => (confirmPair = true)}>Restore database and files</Button
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
								The backup contains {form.filePreview.incoming_count} files; {form.filePreview
									.removed} will be removed.
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
					{#if !backupRows.length}<p class="text-sm text-muted-foreground">
							No saved backups yet. Choose Back up now to create the first one.
						</p>{/if}
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
					<details class="disclosure disclosure-quiet" open={uploading}>
						<summary>Import a backup</summary>
						<div class="disclosure-body space-y-6">
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
							<form
								method="POST"
								action="?/prepare"
								enctype="multipart/form-data"
								use:enhance={enhanceWithFocus}
								class="space-y-4"
							>
								<Field
									id="backup_file"
									label="Import a database backup"
									hint="A SQLite file up to 100 MiB. Choose it, then preview the restore."
								>
									{#snippet control(attrs)}<Input
											{...attrs}
											type="file"
											name="backup_file"
											accept=".sqlite,.db"
										/>{/snippet}
								</Field>
								<div class="form-actions">
									<Button type="submit" variant="outline">Preview restore</Button>
								</div>
							</form>
						</div>
					</details>
					{#if uploadError}<Notice tone="error" title="Backup import failed">{uploadError}</Notice
						>{/if}
					<details
						class="disclosure disclosure-quiet"
						open={Boolean(form?.fileError || uploadError)}
					>
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
							<form
								method="POST"
								action="?/filePrepare"
								use:enhance={enhanceWithFocus}
								class="space-y-4"
							>
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
										These files belong to jobs absent from the current database. They are preserved
										in backups.
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
					title="Storage"
					description="Where Saturday keeps your jobs, history and documents on this computer."
				>
					{#if form?.storageError}<Notice tone="error" title="Folder could not be opened"
							>{form.storageError}</Notice
						>{/if}
					<dl class="space-y-4">
						<div class="space-y-2">
							<div class="status-row">
								<dt>Data directory</dt>
								<dd>
									<form method="POST" action="?/openFolder" use:enhance={enhanceWithFocus}>
										<Button
											type="submit"
											variant="outline"
											disabled={!data.folderSupported || !data.access.local}>Open folder</Button
										>
									</form>
								</dd>
							</div>
							<p
								id="data_path"
								class="rounded-[var(--r-group)] bg-muted px-3 py-2.5 font-mono text-sm break-all text-muted-foreground select-text"
							>
								{data.installation.data_root}
							</p>
						</div>
						<div class="space-y-2">
							<div class="status-row">
								<dt>Database file</dt>
								<dd>
									<Button
										variant="outline"
										aria-label="Copy database path"
										onclick={() => copy('path', data.databasePath)}
									>
										{#if copied === 'path'}<Check data-icon="inline-start" />Copied{:else}<Clipboard
												data-icon="inline-start"
											/>Copy path{/if}
									</Button>
								</dd>
							</div>
							<p
								class="rounded-[var(--r-group)] bg-muted px-3 py-2.5 font-mono text-sm break-all text-muted-foreground select-text"
							>
								{data.databasePath}
							</p>
						</div>
						{#if data.fileSummary}
							<div class="status-row">
								<dt>Documents</dt>
								<dd class="status-value">
									{data.fileSummary.count}
									{data.fileSummary.count === 1 ? 'file' : 'files'} · {formatBytes(
										data.fileSummary.bytes
									)}
								</dd>
							</div>
						{/if}
					</dl>
					<p class="text-sm text-muted-foreground">
						Setup preserves existing storage paths. Managed installations share their installation
						descriptor across the web app, CLI and MCP.
					</p>
					<details class="disclosure disclosure-quiet">
						<summary>Diagnostics</summary>
						<div class="disclosure-body space-y-4">
							<p class="text-sm text-muted-foreground">
								Select and copy these details when reporting a problem. Development builds remain
								unversioned until the 0.1.0 release.
							</p>
							<dl class="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
								{#each [['Installation', data.installation.installation_id], ['Installation descriptor', data.installation.descriptor_path ?? 'Source workspace; run npm run setup to persist identity'], ['Logs', data.installation.logs], ['Development build', data.buildInfo.id], ['Database schema', data.diagnostics.databaseVersion], ['Database format', data.diagnostics.databaseFormat], ['File manifest version', data.diagnostics.manifestVersion ?? 'Unavailable'], ['File manifest format', data.diagnostics.manifestFormat ?? 'Unavailable'], ['Database', data.diagnostics.databasePaths.database], ['Database backups', data.diagnostics.databasePaths.backups], ['Database restore staging', data.diagnostics.databasePaths.restore], ['Files', data.diagnostics.filePaths.root], ['File backups', data.diagnostics.filePaths.backups], ['File recovery state', data.diagnostics.filePaths.state]] as [label, value] (label)}
									<div class="min-w-0">
										<dt class="font-medium">{label}</dt>
										<dd class="mt-1 font-mono break-all text-muted-foreground select-text">
											{value}
										</dd>
									</div>
								{/each}
							</dl>
						</div>
					</details>
				</SectionCard>
				<a class="settings-top-link" href="#main">Back to top</a>
			</div>
			<div class="settings-group" role="group" aria-labelledby="group-security">
				<p class="settings-group-label" id="group-security">Security and access</p>
				<PasswordSettings
					access={data.access}
					error={form?.accessError}
					setupRequired={!data.installation.descriptor_path}
					lanActive={data.network.effective_allow_lan === true}
				/>
				<LanSettings
					network={data.network}
					local={data.access.local}
					controlsAvailable={data.server.controlsAvailable}
					setupRequired={!data.installation.descriptor_path}
					error={form?.lanError}
					saved={form?.lanSaved}
					lifecycle={serverState}
				/>
				<a class="settings-top-link" href="#main">Back to top</a>
			</div>
			<div class="settings-group" role="group" aria-labelledby="group-application">
				<p class="settings-group-label" id="group-application">Application</p>
				<SectionCard
					id="updates"
					title="Updates"
					description="Check manually. Updates preserve your workspace; reconnect your assistant afterward."
				>
					<div class="status-row">
						<p class="status-label">Installed</p>
						<p class="status-value select-text">
							{data.installation.release || data.installation.build?.id || data.buildInfo.id}
						</p>
					</div>
					{#if form?.installationError}<Notice tone="error" title="Installation operation failed"
							>{form.installationError}</Notice
						>{/if}
					{#if data.updateCheck?.error}<Notice tone="error" title="Update check failed"
							>{data.updateCheck.error}</Notice
						>{/if}
					{#if installationProgress || data.installationOperation}
						{@const operation = installationProgress || data.installationOperation}
						<Notice
							tone={operation.error ? 'error' : 'info'}
							title={operation.operation === 'uninstall' && operation.status === 'complete'
								? 'Saturday uninstalled'
								: 'Installation status'}
						>
							{operation.step}{#if operation.error && operation.error !== operation.step}<p
									class="mt-2"
								>
									{operation.error}
								</p>{/if}
							{#if operation.logs}<p class="mt-2 text-sm break-all">Log: {operation.logs}</p>{/if}
							{#if operation.status === 'complete' && operation.operation === 'uninstall'}<p
									class="mt-2"
								>
									The UI is stopped. {operation.retained_paths?.length
										? 'Your data and backups are retained for reinstall.'
										: 'The confirmed owned data was removed.'}
								</p>{/if}
						</Notice>
					{/if}
					{#if data.updateCheck?.target}
						<p class="text-sm">
							{data.updateCheck.target.available
								? data.updateCheck.target.kind === 'release'
									? 'Release available'
									: 'Latest main available'
								: 'You’re up to date'}:
							<a class="link" href={data.updateCheck.target.url} target="_blank" rel="noreferrer"
								>{data.updateCheck.target.release ||
									data.updateCheck.target.commit?.slice(0, 12)}</a
							>
						</p>
						{#if data.updateCheck.local?.dirty}<Notice title="Local changes retained"
								>Local source changes block updating. Commit or preserve them before checking again.</Notice
							>{/if}
						{#if data.updateCheck.local?.unknown}<Notice title="Source identity unknown"
								>The original source fingerprint is unknown. Review the selected snapshot; your
								current code will be retained in recovery.</Notice
							>{/if}
						{#if data.updateCheck.target.notes}<details class="disclosure">
								<summary>Update notes</summary>
								<p class="mt-3 text-sm whitespace-pre-wrap">{data.updateCheck.target.notes}</p>
							</details>{/if}
					{/if}
					{#if data.server.controlsAvailable}
						<div class="flex flex-wrap gap-2">
							<form
								method="POST"
								action="?/checkUpdates"
								use:enhance={withPending(() => async ({ update }) => {
									await update();
									await tick();
									focusFirstError();
								})}
							>
								<Button type="submit" variant="outline" disabled={!data.server.controlsAvailable}
									>Check for updates</Button
								>
							</form>
							{#if data.updateCheck?.target?.available && !data.updateCheck.local?.dirty}<Button
									variant="outline"
									disabled={!data.server.controlsAvailable}
									onclick={() => (updateDialog = true)}>Update Saturday</Button
								>{/if}
							<form
								method="POST"
								action="?/installationOperation"
								use:enhance={withPending(() => async ({ result }) => {
									await applyAction(result);
									await tick();
									focusFirstError();
								})}
							>
								<input type="hidden" name="operation" value="repair" /><Button
									type="submit"
									variant="outline"
									disabled={!data.server.controlsAvailable}>Repair installation</Button
								>
							</form>
						</div>
					{:else}<p class="text-sm text-muted-foreground">
							Check for and install updates from the Saturday shortcut on the server computer.
						</p>{/if}
					<form
						id="update-saturday"
						method="POST"
						action="?/installationOperation"
						use:enhance={withPending(() => async ({ result }) => {
							updateDialog = false;
							await applyAction(result);
							await tick();
							focusFirstError();
						})}
					>
						<input type="hidden" name="operation" value="update" /><input
							type="hidden"
							name="check_id"
							value={data.updateCheck?.id || ''}
						/><input type="hidden" name="confirm" value="true" />
					</form>
					<ConfirmDialog
						bind:open={updateDialog}
						title="Update Saturday?"
						description={`Install ${data.updateCheck?.target?.release || data.updateCheck?.target?.commit?.slice(0, 12) || 'the checked build'} after staging and verified recovery backups. Disconnect your assistant before publication. Data will be preserved.`}
						confirmLabel="Update Saturday"
						formId="update-saturday"
					/>
				</SectionCard>
				<SectionCard
					id="server"
					title="Server"
					description="Control the UI server. MCP is managed separately by your assistant."
				>
					{#if form?.serverError}<Notice tone="error" title="Server operation failed"
							>{form.serverError}</Notice
						>{/if}
					{#if serverState || form?.serverOperation}
						<Notice
							title={serverState === 'restarting'
								? 'Restarting Saturday'
								: serverState === 'failed'
									? 'Reconnect needed'
									: 'Saturday stopped'}
							>{serverMessage ||
								'The server operation was accepted. Refresh after restart, or use the Saturday shortcut to start it again.'}</Notice
						>
					{:else}
						<p class="text-sm text-muted-foreground">
							{data.server.controlsAvailable
								? 'The UI server stays running when you close the browser.'
								: 'Use the Saturday shortcut on the server computer to operate these controls.'}
						</p>
						{#if data.server.error}<Notice title="Server status">{data.server.error}</Notice>{/if}
						{#if data.server.controlsAvailable}
							<div class="flex flex-wrap gap-2">
								<form
									method="POST"
									action="?/serverControl"
									use:enhance={withPending(() => async ({ result }) => {
										await applyAction(result);
										await tick();
										focusFirstError();
									})}
								>
									<input type="hidden" name="operation" value="restart" /><Button
										type="submit"
										variant="outline"
										disabled={!data.server.controlsAvailable}>Restart server</Button
									>
								</form>
								<Button
									variant="outline"
									disabled={!data.server.controlsAvailable}
									onclick={() => (stopDialog = true)}>Stop server</Button
								>
							</div>
							<form
								method="POST"
								action="?/serverControl"
								id="stop-server"
								use:enhance={withPending(() => async ({ result }) => {
									stopDialog = false;
									await applyAction(result);
									await tick();
									focusFirstError();
								})}
							>
								<input type="hidden" name="operation" value="stop" /><input
									type="hidden"
									name="confirm"
									value="true"
								/>
							</form>
							<ConfirmDialog
								bind:open={stopDialog}
								title="Stop Saturday’s UI server?"
								description="The dashboard will become unavailable. Use the Saturday shortcut or npm run open to start it again. Your assistant’s MCP connection will remain independent."
								confirmLabel="Stop server"
								destructive
								formId="stop-server"
							/>
						{/if}
					{/if}
					{#if form?.loginSaved}<Notice title="Startup setting saved"
							>Login startup now matches the setting below.</Notice
						>{/if}
					{#if form?.loginError}<Notice tone="error" title="Startup setting failed"
							>{form.loginError}</Notice
						>{/if}
					{#if data.loginStartup.error}<Notice title="Login startup unavailable"
							>{data.loginStartup.error}</Notice
						>{/if}
					{#if data.server.controlsAvailable && data.loginStartup.available}
						<form
							method="POST"
							action="?/loginStartup"
							use:enhance={withPending(() => async ({ update }) => {
								await update({ reset: false });
								await tick();
								focusFirstError();
							})}
							use:trackChanges={{
								set: (value) => (startupDirty = value),
								key: data.loginStartup.enabled
							}}
						>
							<Checkbox name="enabled" label="Start at login" checked={data.loginStartup.enabled} />
							<p class="mt-2 text-sm text-muted-foreground">
								Start the UI server after you sign in, without opening a browser. Stopping Saturday
								keeps it stopped until you reopen it or sign in again.
							</p>
							<div class="mt-3">
								<Button type="submit" variant="outline" disabled={startupDirty === false}
									>Save startup setting</Button
								>
							</div>
						</form>
					{:else}
						<div class="status-row">
							<p class="status-label">Start at login</p>
							<p class="status-value">
								<strong class="text-foreground">{data.loginStartup.enabled ? 'On' : 'Off'}</strong>
							</p>
						</div>
						<p class="text-sm text-muted-foreground">
							Change this from the Saturday shortcut on the server computer.
						</p>
					{/if}
				</SectionCard>
				<SectionCard
					id="uninstall"
					title="Uninstall Saturday"
					class="settings-danger"
					description="Removes the application. Your data and backups are kept unless you choose to delete them."
				>
					{#if data.server.controlsAvailable}
						<div>
							<Button
								variant="outline"
								class="text-destructive"
								onclick={() => (uninstallDialog = true)}>Uninstall Saturday</Button
							>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">
							Uninstall from the Saturday shortcut on the server computer.
						</p>
					{/if}
					<form
						id="uninstall-saturday"
						method="POST"
						action="?/installationOperation"
						use:enhance={withPending(() => async ({ result }) => {
							uninstallDialog = false;
							await applyAction(result);
							await tick();
							focusFirstError();
						})}
					>
						<input type="hidden" name="operation" value="uninstall" /><input
							type="hidden"
							name="confirm"
							value="true"
						/>
					</form>
					<ConfirmDialog
						bind:open={uninstallDialog}
						title={deleteUserData ? 'Delete data and uninstall Saturday?' : 'Uninstall Saturday?'}
						description="Disconnect your assistant first. The UI will stop; owned application files, shortcuts and login registration will be removed. Data and backups are kept unless you select deletion."
						confirmLabel={deleteUserData ? 'Delete data and uninstall' : 'Uninstall Saturday'}
						formId="uninstall-saturday"
						destructive
					>
						<Checkbox
							form="uninstall-saturday"
							name="delete_data"
							label="Delete all Saturday data"
							bind:checked={deleteUserData}
							disabled={Boolean(data.deletionUnavailable)}
						/>
						{#if data.deletionUnavailable}<p class="text-sm text-muted-foreground">
								{data.deletionUnavailable}
							</p>{/if}
						{#if deleteUserData}<Notice tone="error" title="Permanent deletion"
								>This permanently deletes your jobs, network, documents, Profile designations,
								settings, local backups and extension data. This cannot be undone. Download any
								backups you want to keep first.</Notice
							>
							<ul class="list-disc space-y-1 pl-5 text-sm">
								{#each data.deleteDataPaths as path}<li class="break-all">{path}</li>{/each}
							</ul>
							<Field id="delete_data_confirmation" label="Type DELETE DATA to confirm"
								>{#snippet control(attrs)}<Input
										{...attrs}
										form="uninstall-saturday"
										name="confirmation"
										required
										autocomplete="off"
									/>{/snippet}</Field
							>{/if}
					</ConfirmDialog>
				</SectionCard>
				<a class="settings-top-link" href="#main">Back to top</a>
			</div>
		</div>
	</div>
</PageShell>
