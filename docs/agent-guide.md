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

4. Check whether the app is already answering on port 3000:

   ```sh
   npm run status
   ```

   If it is Saturday, keep that process running and open <http://127.0.0.1:3000>. Otherwise, start the web server:

   ```sh
   npm run start
   ```

   Leave that terminal open. In another terminal, change to the cloned repository, run `npm run status`, and open <http://127.0.0.1:3000>. If port 3000 is occupied by another app, stop the failed start and use `PORT=3100 npm run start`, then check with `PORT=3100 npm run status` and open <http://127.0.0.1:3100>. Saturday binds to `127.0.0.1`.

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
2. Add that JSON as the local `saturday` MCP server in the ChatGPT Work desktop client, then reconnect the client.
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
npm run backup -- schedule show --json
npm run backup -- schedule set --enabled true --contents all --interval-hours 24 --keep 10 --json
```

When parsing program output, use `node scripts/backup.mjs ... --json` or `node scripts/restore.mjs ... --json` directly; npm may print its own script banner. Backup retains a managed copy even when exporting. Export never overwrites an existing file. Show the preview to the user and obtain authorization before committing a restore; record the recovery backup location returned on success. Never automatically retry after an uncertain response. Do not send backup contents or private paths to unrelated services.

The main schedule accepts `--contents all` (database and files) or `--contents database`; new schedules default to all and existing schedules without this field retain database-only behavior. Retention counts complete sets and removes both automatic artifacts after a successful replacement. The manual `backup` command remains database-only; use the file CLI pair command for a complete set. Enabling/changing automatic backup retention requires user authorization to delete older automatic sets under that policy. Manual/imported/recovery backups remain. Start the web app through the documented npm scripts to run the scheduler; MCP alone does not schedule backups. Custom launches of `build/index.js` must set `BODY_SIZE_LIMIT=105906176` to support the documented 100 MiB uploads, and do not automatically start the scheduler.

The current app rejects newer migration histories. Do not alter migration records to bypass this check: upgrade the app instead. In-app/CLI restore requires a healthy target database; offline replacement of a corrupt database requires stopping web/MCP processes first and preserving the original database and sidecars for recovery.

## File storage and recovery commands

`SATURDAY_FILES_PATH` defaults to `data/files/` relative to the project and is independent of SQLite. The root contains `manifest.json`, `documents/`, and lazy `jobs/<id>/` content. Do not edit files/manifest directly; use web/MCP to preserve hashes, identity and conflict tokens. State/journals and backup archives are private sibling directories `.state` and `.backups`, outside the backed-up root. Configure identical paths for web/worker/MCP.

```sh
npm run setup:pdf
npm run files -- backup
npm run files -- list
npm run files -- import ./files.zip
npm run files -- export <backup-id> ./export.zip
npm run files -- prepare <backup-id> --replace
npm run files -- restore <preview-id> --confirm
npm run files -- schedule set --enabled true --contents all --interval-hours 24 --keep 10
npm run files -- pair
npm run files -- prepare-pair <file-backup-id>
npm run files -- restore-pair <preview-id> --confirm
```

Commands emit JSON; for parsing without npm's banner use `node scripts/files.mjs ...` directly. Preview expires after ten minutes and is single-use. Show it before authorization. File ZIPs have no total-size cap and stream to private staging, but disk space and upstream request constraints apply. Managed imports validate keys, exact contents and hashes. Manifest processing has a 16 MiB metadata bound; archive contents are never loaded whole into memory.

For a missing/malformed manifest, stop every web/MCP/worker process, retain the original, then run `npm run files -- recover ./known-good.zip --confirm`. Recovery validates the archive first and preserves the damaged tree in private sibling recovery directories before replacement. Check the returned locations and recovered contents before deleting recovery copies or restarting. Newer manifest formats require an application upgrade instead. For an interrupted coordinated restore, stop all processes and run `npm run files -- recover-pair --confirm` to return both stores to their recovery snapshots. Never remove the blocking session marker to bypass recovery.

Puppeteer uses managed Chrome installed by `npm run setup` or `npm run setup:pdf`. Its cache must be readable by the same runtime user; install required Chrome platform libraries/fonts on Linux and retain the browser sandbox. Chrome is required only for PDF generation, not basic documents/jobs. Build/MCP externalize Puppeteer and ZIP packages, so deploy production `node_modules` too. Production startup permits streamed file archives without the former SQLite-sized request ceiling; document/provide upstream proxy allowances for large/long imports. Smaller upload/SQLite limits remain enforced in their handlers.

## Network upgrade and verification

Numeric schema baseline 1 includes people, job-person links and optional interaction history. Jobs, people and both histories use positive safe integer IDs; MCP IDs are JSON numbers. The central MCP entry exposes 40 tools, including twelve Network operations documented in the [assistant guide](assistant-guide.md#network-tools). UUID-era databases/backups and earlier unbound file manifests/pairs are unsupported. Never alter migration records or dataset IDs to bypass checks. File manifest `saturday.files.numeric` version 1 binds to the database dataset; restore matching independent artifacts in either order, or a validated coordinated pair. A mismatch retains files and blocks normal job-attachment access. Stop and rebuild/restart all processes together after updates; setup never resets data automatically.

For support, Settings → Local database → Diagnostics exposes the captured development build ID, actual schema/manifest versions and resolved database/files/backup/recovery paths. It does not run Git at runtime or present the development package version as a released app version. Job/person references shown as #123 use JSON numbers in MCP, with separate sequences per table.
