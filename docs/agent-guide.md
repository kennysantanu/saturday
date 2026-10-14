# Agent setup guide

Use this guide when a user asks you to install Saturday from its GitHub repository into a folder they chose for a ChatGPT Work project.

## Clone and start Saturday

1. In a terminal, check the required tools. Node.js must be 22.13 or newer and npm must be 10 or newer.

   ```sh
   node -v
   npm -v
   git --version
   ```

2. Set `SATURDAY_DEST` to the absolute path of the folder the user selected. Create it if needed.

   ```sh
   SATURDAY_DEST="/absolute/path/to/selected/folder"
   mkdir -p "$SATURDAY_DEST"
   ```

   If that folder is empty, clone into it:

   ```sh
   git clone https://github.com/kennysantanu/saturday.git "$SATURDAY_DEST"
   cd "$SATURDAY_DEST"
   ```

   If it already contains files, clone into a new `saturday` subfolder instead:

   ```sh
   git clone https://github.com/kennysantanu/saturday.git "$SATURDAY_DEST/saturday"
   cd "$SATURDAY_DEST/saturday"
   ```

   Use only the branch that matches the selected folder. Stop if cloning fails; do not overwrite an existing `saturday` subfolder.

3. From the cloned repository, install, build, and migrate. If the user chose a custom database file, set `SATURDAY_DB_PATH` before these commands and keep it set when starting the app.

   ```sh
   npm ci
   npm run build
   npm run migrate
   ```

   Running `npm run migrate` again is safe. The default database is `data/saturday.db` in this clone.

4. Start or reuse this installation in the background and open its Dashboard:

   ```sh
   node scripts/start.mjs open --json
   node scripts/status.mjs --json
   ```

   `open` finishes after readiness and browser launch; the supervisor continues independently. Report the returned URL, including a fallback port when another app occupies the preferred port. For setup without opening a browser, use `node scripts/start.mjs --background --json`. Do not create another terminal-owned server or kill unrelated Node processes. `npm run start` remains a foreground developer option.

5. Resolve the paths for this clone from its repository folder. If using a new terminal and a custom `SATURDAY_DB_PATH`, set the same value there first:

   ```sh
   pwd -P
   node -p 'process.execPath'
   printf 'MCP entry: %s/build/mcp/index.js\n' "$(pwd -P)"
   node --input-type=module -e "import { getDatabasePath } from './src/lib/server/database.js'; console.log(getDatabasePath())"
   ```

   The final command prints the absolute database path. `SATURDAY_DB_PATH`, when set, may be absolute or relative to the repository folder. The path shown in **Settings** must match this result.

## Connect the desktop assistant

1. Open Saturday's **Settings** page and copy **Local desktop configuration**. It uses the absolute Node, MCP entry, and database paths resolved above. If the database path differs, check that the web process and the path commands used the same `SATURDAY_DB_PATH` value.
2. Configure `saturday` using the client's documented format. The Settings JSON is for clients that accept `mcpServers`; ChatGPT Work's local desktop configuration uses TOML instead (see the [assistant guide](assistant-guide.md#chatgpt-work-local-desktop)). Reconnect or restart the client.
3. Add a job in the web app, then ask the assistant to list the jobs in Saturday. Confirm that `list_jobs` returns that job's title and ID. This verifies that the desktop MCP process and the browser use the same database. Refresh Saturday after an assistant write to check that it appears there too.

The local desktop client starts the MCP process when it connects; it is not a second web server to start manually. Do not claim that MCP is connected until the client has called one of Saturday's tools. `list_jobs` and `get_job` read data; `create_job`, `edit_job`, `set_job_follow_up`, `set_job_score`, and `add_job_update` write data. Job details and follow-ups are shared between UI and MCP; assessment score/comment can be written only through MCP. Use `list_jobs` filters and pagination metadata to find the correct record before writing; it defaults to all jobs, while the Jobs page defaults to active jobs. See the [assistant guide](assistant-guide.md) for query options, optional fields, clearing semantics, and scoring.

## Report completion

Tell the user the local browser address, whether the app is answering, the database location shown in Settings, whether the desktop client has successfully called an MCP tool, and any remaining step that needs their action. The client may ask the user to approve MCP write calls.

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

Numeric schema baseline 1 includes people, job-person links and optional interaction history. Jobs, people and both histories use positive safe integer IDs; MCP IDs are JSON numbers. The central MCP entry exposes 42 tools, including twelve Network operations documented in the [assistant guide](assistant-guide.md#network-tools). UUID-era databases/backups and earlier unbound file manifests/pairs are unsupported. Never alter migration records or dataset IDs to bypass checks. File manifest `saturday.files.numeric` version 2 binds to the database dataset and validates Profile designations; version 1 upgrades while preserving existing files and Master CV; restore matching independent artifacts in either order, or a validated coordinated pair. A mismatch retains files and blocks normal job-attachment access. Stop and rebuild/restart all processes together after updates; setup never resets data automatically.

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
