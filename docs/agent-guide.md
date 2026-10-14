# Agent setup guide

Use this guide for authorized installation, opening, updating and optional assistant connection. First establish whether the assistant can run local processes and access the user's computer. A hosted-only chat must provide manual instructions; it cannot install a local stdio server by adding a URL. App/platform support and client execution capabilities are separate.

## Install and open Saturday

1. Read the repository README and inspect this revision's installer. Use the shared bootstrap, not a separate clone/build/migrate recipe. During development, download/extract the official repository archive and run `sh install.sh --source .` on macOS/Linux, or `install.bat --source .` in Windows Command Prompt. Use the remote installer path only once this revision is published. Do not replace global Node/npm or require Git merely for installation.
2. Preserve a detected descriptor and existing workspace. Repeat installation reopens/repairs it. Do not reset storage, relocate data, enable login startup or bypass OS restrictions without the user's instruction. PDF failure can continue without PDF; offer a retry later.
3. Wait for installation readiness. Report the actual returned URL, descriptor and data paths. The shared Open command and desktop shortcut reuse the owned background UI; closing the browser does not stop it. Do not create a terminal-owned server or kill unrelated processes.
4. For an existing install, use the descriptor's absolute Node path with `<code_root>/scripts/start.mjs open --json`; set `SATURDAY_INSTALLATION_PATH` to that descriptor. `scripts/status.mjs --json` verifies installation/build readiness. Source users can use `npm run setup` and `npm run open`. Start at login remains off unless chosen.

## Prepare an optional assistant connection

1. Obtain configuration from Settings or run the descriptor's Node with `<code_root>/scripts/assistant.mjs config --installation <absolute-descriptor> --format json` (JSON clients) or `--format toml` (supported local ChatGPT/Codex configuration). This generates configuration only, not a connected status. Use the same descriptor for web and MCP, including files, extensions and PDF cache.
2. Check the actual client's supported execution mode and configuration mechanism. See the [assistant guide](assistant-guide.md#chatgpt-work-local-desktop). Hosted-only chats have no supported local stdio registration here. A managed policy may deny a local server; report the denial rather than bypassing it.
3. For a JSON client such as Claude Desktop, inspect the existing client file and obtain authorization to modify its Saturday entry. Use `scripts/assistant.mjs connect --installation <descriptor> --config <absolute-client-json> --confirm`. This merges only `mcpServers.saturday`, retains unrelated settings/servers and saves a private recovery copy. A conflicting entry requires reviewed `--replace --confirm`. Invalid JSON and linked paths fail without overwriting the file. The helper does not discover/edit arbitrary client files.
4. For TOML, use the client's documented MCP controls/CLI or merge the generated tables after reviewing the existing configuration and retaining a private recovery copy. Do not paste JSON into TOML, append duplicate Saturday tables or replace the whole file. No dependency or custom TOML parser is required by Saturday.
5. Reconnect the client. Ask it to call `get_saturday_info`; compare `installation_id`, `dataset_id` and `build.id` with Settings. This works with zero jobs. For populated data, read a known numbered job and compare its title/history. Do not create a record merely to verify connectivity. Configuration preparation or an automated protocol test is not proof that this assistant connected.
6. Report client name/version/execution mode, actual tool result and whether identities matched. If no real client was available, explicitly report verification pending. Refresh the browser after authorized writes.

## Update, reconnect and remove configuration

Use Settings or the same `scripts/install.mjs check --installation <descriptor> --json`, then `update --check-id <reviewed-id> --confirm --installation <descriptor> --json`. Before publication, disconnect Saturday's MCP process in the client. Do not invoke the updater from a still-connected Saturday tool; the writer guard must reject that. Wait for the persisted terminal operation result; background acknowledgment is not completion. Reopen only through shared lifecycle commands and repeat the identity/read verification after reconnecting. If the Node path changed, regenerate configuration and review the updated Saturday entry before reconnecting.

For repair use `scripts/install.mjs repair --installation <descriptor> --json`; keep operation logs and recovery paths. Never blindly reset data or downgrade over migrations.

Before uninstall, disconnect the client. If authorized, remove the matching JSON entry with `scripts/assistant.mjs disconnect --installation <descriptor> --config <absolute-client-json> --confirm` while the application/runtime still exist. A changed entry is retained for manual review; TOML removal uses the client's documented controls or reviewed removal of only Saturday's tables. Recovery copies may contain private client settings; retain them securely and let the user decide when to delete them. App uninstall deliberately does not guess client locations or delete unrelated settings.

## Report completion

Report the local browser address, app readiness, data/descriptor location, prepared client configuration, actual tool-call verification or pending/unavailable status, and any policy or platform limitation. Real ChatGPT Work read/reconnect verification and Windows/Linux client execution remain Phase 7 gates; do not claim automated tests certify them.

## Backup and recovery commands

Use the same `SATURDAY_DB_PATH` as the web/MCP process. CLI file arguments resolve from the caller's working directory. Commands with `--json` emit one result on stdout; diagnostics go to stderr. Exit codes are 0 success, 2 invalid arguments, and 1 operational failure.

```sh
npm run backup -- --output ./career-backup.sqlite --json
npm run restore -- ./career-backup.sqlite --inspect --json
npm run restore -- --restore-id <preview-id> --confirm --json
```

When parsing program output, use `node scripts/backup.mjs ... --json` or `node scripts/restore.mjs ... --json` directly; npm may print its own script banner. Backup retains a managed copy even when exporting. Export never overwrites an existing file. Show the preview to the user and obtain authorization before committing a restore; record the recovery backup location returned on success. Never automatically retry after an uncertain response. Do not send backup contents or private paths to unrelated services.

Manual commands work without the UI server. `npm run backup -- --contents all --json` captures both; `--contents files` captures files only; omitted contents retains database-only behavior. Use `npm run backup -- list --json`, `export <id> --contents all --output <new-file>`, `import <combined.zip>`, or `delete <id> --contents all --confirm`. Delete requires explicit user authorization. Combined exports are importable ZIPs; existing file CLI and restore commands remain. There is no scheduler/retention. Extensions require independent backups. Documented web scripts support streaming imports; database multipart uploads retain their 100 MiB bound.

The current app rejects newer migration histories. Do not alter migration records to bypass this check: upgrade the app instead. In-app/CLI restore requires a healthy target database; offline replacement of a corrupt database requires stopping web/MCP processes first and preserving the original database and sidecars for recovery.

## File storage and recovery commands

`SATURDAY_FILES_PATH` defaults to `data/files/` relative to the project and is independent of SQLite. The root contains `manifest.json`, `documents/`, and lazy `jobs/<id>/` content. Do not edit files/manifest directly; use web/MCP to preserve hashes, identity and conflict tokens. State/journals stay in the private sibling `.state` directory. New file archives live under `backups/files/` beside the file store; older sibling `.backups` archives remain readable. Both are outside the backed-up root. Configure identical paths for web/CLI/MCP.

```sh
npm run setup:pdf
npm run files -- backup
npm run files -- list
npm run files -- import ./files.zip
npm run files -- export <backup-id> ./export.zip
npm run files -- prepare <backup-id> --replace
npm run files -- restore <preview-id> --confirm
npm run files -- pair
npm run files -- prepare-pair <file-backup-id>
npm run files -- restore-pair <preview-id> --confirm
```

Commands emit JSON; for parsing without npm's banner use `node scripts/files.mjs ...` directly. Preview expires after ten minutes and is single-use. Show it before authorization. File ZIPs have no total-size cap and stream to private staging, but disk space and upstream request constraints apply. Managed imports validate keys, exact contents and hashes. Manifest processing has a 16 MiB metadata bound; archive contents are never loaded whole into memory.

For a missing/malformed manifest, stop every web/MCP process, retain the original, then run `npm run files -- recover ./known-good.zip --confirm`. Recovery validates the archive first and preserves the damaged tree in private sibling recovery directories before replacement. Check the returned locations and recovered contents before deleting recovery copies or restarting. Newer manifest formats require an application upgrade instead. For an interrupted coordinated restore, stop all processes and run `npm run files -- recover-pair --confirm` to return both stores to their recovery snapshots. Never remove the blocking session marker to bypass recovery.

Puppeteer uses managed Chrome installed by `npm run setup` or `npm run setup:pdf`. Its cache must be readable by the same runtime user; install required Chrome platform libraries/fonts on Linux and retain the browser sandbox. Chrome is required only for PDF generation, not basic documents/jobs. Build/MCP externalize Puppeteer and ZIP packages, so deploy production `node_modules` too. Production startup permits streamed file archives without the former SQLite-sized request ceiling; document/provide upstream proxy allowances for large/long imports. Smaller upload/SQLite limits remain enforced in their handlers.

## Network upgrade and verification

Numeric schema baseline 1 includes people, job-person links and optional interaction history. Jobs, people and both histories use positive safe integer IDs; MCP IDs are JSON numbers. The central MCP entry exposes 43 tools, including twelve Network operations documented in the [assistant guide](assistant-guide.md#network-tools). UUID-era databases/backups and earlier unbound file manifests/pairs are unsupported. Never alter migration records or dataset IDs to bypass checks. File manifest `saturday.files.numeric` version 2 binds to the database dataset and validates Profile designations; version 1 upgrades while preserving existing files and Master CV; restore matching independent artifacts in either order, or a validated coordinated pair. A mismatch retains files and blocks normal job-attachment access. Stop and rebuild/restart all processes together after updates; setup never resets data automatically.

For support, Settings → Local database → Diagnostics exposes the captured development build ID, actual schema/manifest versions and resolved database/files/backup/recovery paths. It does not run Git at runtime or present the development package version as a released app version. Job/person references shown as #123 use JSON numbers in MCP, with separate sequences per table.

## Authoring extensions

For a requested custom feature, read the [extension guide](extension-guide.md) and design guide before copying Interview Practice. Use public imports and shared UI/MCP services, verify on disposable data, and obtain explicit trust before installing executable code. Installing code needs filesystem/process access; MCP data tools alone are insufficient. Preserve retained extension data and independent backups during disable/removal/update.

## Shared installation descriptor

Prefer `npm run setup -- --json` for source initialization/retry. Progress and command logs go to stderr; one final JSON result on stdout identifies installation, descriptor, data/log paths and step states. Pass the same `SATURDAY_INSTALLATION_PATH` to every process and use Settings-generated MCP configuration. Descriptor paths take precedence; conflicting legacy path overrides fail rather than switch workspaces. Never delete/change a descriptor to bypass missing-store errors. Source setup adopts existing paths without relocation. `scripts/setup.mjs --managed --root <absolute-root>` prepares the managed layout for bootstrap development; runtime and shortcut preparation are supplied by the bootstrap wrappers/engine. `--skip-dependencies`, `--skip-build`, and `--skip-pdf` are explicit development/test options, not proof those capabilities are ready. An optional PDF failure does not block the workspace.

Use `npm run status -- --json` to check the expected installation's `/health` response. It returns build/installation identity without record content. `SATURDAY_BUILD_COMMIT` supplies a validated full commit SHA when building a pinned source archive without Git. Setup locks serialize retries, stores retain initialized-state checks, and logs are capped at 1 MiB per setup attempt. Versioning still starts at 0.1.0.

## UI lifecycle commands

`node scripts/start.mjs stop --json` and `restart --json` acknowledge accepted operations; poll `node scripts/status.mjs --json` for readiness after restarting. Stop terminates only the owned web child and supervisor. Client-owned stdio MCP remains usable with web off. A lifecycle request refuses while shared data operations or backup streaming are active; wait for completion, inspect status, and retry the lifecycle request. Do not retry uncertain restore/write requests automatically.

Ownership, local controller credentials and operation admission state live under `<data_root>/server.state/`, outside archives. Treat `server.json` as private; never send its token in diagnostics. Settings shows status and the bounded `server.log` location. Failed readiness requires inspecting logs and reopening; no data reset is authorized. Desktop shortcuts, login registration and bootstrap installers are implemented; full platform verification remains pending. These commands require local process tools; MCP clients do not gain process execution merely by connecting.

## Managed bootstrap installation

Prefer this installer flow for a user who does not already have a source workspace. From this revision's extracted repository, run `sh install.sh --source .` on macOS/Linux or `install.bat --source .` in native Windows Command Prompt. These wrappers prepare private Node 24.21.0/npm, verify the official SHA-256 artifact hash, then call `scripts/install.mjs`. They never replace global tools, require Git for the app, enable login startup automatically, or change PowerShell policy. On Windows set `SATURDAY_NONINTERACTIVE=1` for an assistant-run command so an error does not wait at the window-close prompt.

Without `--source`, the engine resolves the official GitHub main to one commit, checks downloaded files against its Git tree/blob identities, builds in staging, then publishes with an interruption-recovery journal. Use the remote flow only when this revision is available on main; public standalone install links are not published yet. An existing descriptor reuses its installed code/data rather than performing an update. Existing source data is adopted in place when the selected source has `data/installation.json`; custom source paths should continue through their explicit descriptor and source setup, not an unrequested new managed workspace.

`SATURDAY_INSTALL_ROOT` selects an absolute custom installer root. Engine options include `--root`, `--source`, `--commit <full-sha>`, `--desktop <folder>` (macOS/Linux), `--no-open`, `--json`, `--skip-pdf`, and `--retry-pdf`. JSON output is one receipt on stdout; progress goes to stderr and a bounded `logs/installer.log`. Runtime/source downloads and setup failures retain data; retry the same command. Do not manually remove an unfamiliar lock, publication journal or data directory. PDF failure permits basic app use; `--retry-pdf` uses the managed cache and validates a real render. The Settings PDF status reflects availability.

The receipt reports the descriptor, data path, actual URL and optional shortcut. Preserve those absolute paths in client configuration. For manual reopen/control without relying on PATH, call the descriptor's Node and `<code_root>/scripts/start.mjs open --installation <descriptor>`. Add `--json` when parsing. `login --json` inspects actual registration; `login --enable` / `login --disable` changes only this installation's per-user startup. Change it only when asked. Login starts UI once after sign-in without opening a browser; no KeepAlive/automatic respawn follows Stop. Shortcut failure is a partial OS-integration result, not a failed app install; report its exact CLI fallback.

Targets and current verification limits are in README. Light macOS install/reinstall, managed PDF, temporary launcher and one-shot LaunchAgent checks do not certify reboot behavior, Windows/Linux runtime or actual assistant-client support. Keep installation readiness and real MCP connection verification separate.

## Update, repair and removal controller

Use `scripts/install.mjs check/update/repair/uninstall/status` through the installed Node or the OS bootstrap wrapper. `--installation <descriptor>` resolves the existing workspace; do not create a replacement descriptor. Check first, report the target/compatibility/local-change result, then invoke `update --check-id <id> --confirm --json` only within the user's update authorization. Without a check ID the CLI performs and prints a fresh check. UI and CLI use identical selection, integrity, staging, maintenance and recovery contracts. `--background` returns an operation receipt; poll `status --json` rather than claim completion. Never repeat an uncertain destructive request automatically.

The worker and its bounded log/state survive UI shutdown outside replaceable app/runtime. Source/dependency/extension builds finish before publication. Dirty source is blocked. A compatible private Node runtime is staged from the candidate's pinned official Node artifact metadata when required, preserving the old/system runtime. Disconnect/pause client-owned MCP; an alive lease produces Waiting for assistant disconnect rather than killing the client or publishing over it. Recheck afterward. Verified core recovery and separate extension snapshots precede live migration/publication. User identities, file tokens, counters, namespaces and login choice survive. A stopped UI remains stopped; a formerly running one is restarted and checked. Reconnect the assistant; refresh client configuration when the Node path changed. A protocol test is not a real-client success claim.

Interrupted publication leaves persistent maintenance and recovery artifacts. `repair` finishes compatible publication/setup; it never silently restores backups or downgrades over migrated data. For an unknown local snapshot, explicitly supply `--source <folder>`; its identity is a local code fingerprint. The repair command can be invoked from a retained controller or a reviewed extracted installer if application code is missing. Preserve logs/journals and report unsupported recovery rather than editing migration records or resetting data.

`uninstall --confirm` retains user stores/backups/extensions. `--delete-data --confirm` requires separate explicit user authorization for permanent deletion. UI presents unchecked deletion, exact paths and literal confirmation. Owned targets exclude system runtimes, exported external backups and unowned/shared source storage; linked deletion roots are rejected and child links are unlinked without following their targets. Partial cleanup retains its progress/ownership record for retry. Assistant configuration is retained; remove only the authorized Saturday entry through the supported client flow. Reinstall reuses retained stores; a previously confirmed data deletion permits a fresh dataset.
