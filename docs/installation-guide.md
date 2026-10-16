# Installation and maintenance

Use this guide to install, open, update, repair, or remove Saturday. For assistant-led execution, also read the [agent guide](agent-guide.md). For connecting a client after installation, use the [assistant guide](assistant-guide.md).

Saturday is in development toward `0.1.0`. Setup preserves existing data, but compatibility between development builds is not guaranteed. See the [development policy](contributing.md#development-toward-010) and [provisional support matrix](contributing.md#provisional-support-matrix).

## Requirements

The development installer targets macOS 14+ (Apple silicon/x64), Windows 11 x64, and Ubuntu 22.04/24.04 x64 with graphical GNOME. Limited macOS checks are recorded; full platform, reboot/login, and accessibility verification remains pending.

Installation needs network access for runtime/dependency downloads. The bootstrap provisions a verified private Node/npm runtime without replacing global tools or requiring administrator access. Git is unnecessary for app installation, but required for Git-sourced extensions.

| Platform           | Shell prerequisites                                                |
| ------------------ | ------------------------------------------------------------------ |
| macOS              | curl, tar, shasum                                                  |
| Linux              | curl, tar, sha256sum                                               |
| Windows            | curl.exe, tar.exe, certutil.exe; Windows Script Host for shortcuts |
| Source development | Node.js 22.13+ and npm 10+; Git to clone the repository            |

## Development installer

Download and extract the selected repository revision, then open Terminal or Command Prompt in that folder:

```sh
# macOS or Linux
sh install.sh --source .
```

```bat
rem Windows Command Prompt
install.bat --source .
```

The installer prepares its private runtime, installs dependencies, builds web/MCP, initializes or validates storage, prepares optional PDF export, and opens Dashboard after readiness. It reports the actual URL, data/descriptor paths, and desktop shortcut or exact reopen command.

Use **Open Saturday** on the desktop afterward. Linux may require **Allow Launching** on the generated desktop file. If shortcut creation is blocked, use the printed fallback; installation does not bypass OS protections. Closing the browser or launch terminal leaves the background UI running.

Repeating installation reuses the installed code, data, and login settings. Use the [update workflow](#updates) to change builds. After uninstall, reinstall reuses retained data, or creates a fresh workspace if data was explicitly deleted.

Without `--source`, the installer resolves official GitHub `main` to one exact commit and verifies the downloaded source against its Git tree/blob identities. That route requires the installer revision to be available upstream.

### Installer options and retries

`SATURDAY_INSTALL_ROOT` selects an absolute custom root. Supported options include `--root`, `--source`, `--commit <full-sha>`, `--no-open`, `--json`, `--skip-pdf`, and `--retry-pdf`; macOS/Linux also support `--desktop <folder>`. Set `SATURDAY_NONINTERACTIVE=1` in Windows for assistant-run commands so errors do not wait at the window-close prompt.

PDF setup can fail without preventing basic app use. Rerun the same installer with `--retry-pdf` to download/validate Chrome, or `--skip-pdf` to omit it deliberately. Managed Chrome uses the installation's shared cache. Linux also needs Chrome's platform libraries/fonts; retain its sandbox.

Repeat the same command after an interrupted setup. Downloads/setup failures retain data. Preserve unfamiliar locks, publication journals, and recovery directories rather than deleting them to force progress. Missing initialized storage requires recovery; recreating the descriptor is not a repair.

## Source checkout

For development:

```sh
git clone https://github.com/kennysantanu/saturday.git
cd saturday
npm run setup
npm run open
```

Setup installs dependencies, prepares optional PDF support, builds both web/MCP, and initializes or validates storage. Repeating it preserves data and records step results/logs for retry. `npm run dev` starts the loopback development server; `npm run open` opens the production build in the background.

`npm run setup:pdf` installs Puppeteer's Chrome. Source setup options `--skip-dependencies`, `--skip-build`, and `--skip-pdf` deliberately skip those steps; they do not establish readiness. Production needs its runtime dependencies, including Puppeteer/ZIP packages, alongside the build. Development and verification commands are in [Contributing](contributing.md#commands-and-verification).

## Data locations and installation descriptor

Managed installations separate app, runtime, and data under these per-user roots:

| OS      | Installation root                                                                             |
| ------- | --------------------------------------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Saturday`                                                      |
| Windows | `%LOCALAPPDATA%\Saturday`                                                                     |
| Linux   | `$XDG_DATA_HOME/saturday` when XDG_DATA_HOME is absolute; otherwise `~/.local/share/saturday` |

Source setup defaults to `data/saturday.db` and `data/files/` inside the repository. Before initial source setup, use `SATURDAY_DB_PATH` and `SATURDAY_FILES_PATH` to select other locations; relative values resolve from the project root. Extension paths can also be configured as described in the [extension guide](extension-guide.md#independent-backup-and-restore). Source setup preserves existing paths without relocation.

`installation.json` records installation identity, runtime/code/storage paths, build, port, and setup state. Source setup stores it beside the database; managed bootstrap stores it at the installation root. Use the same `SATURDAY_INSTALLATION_PATH` for web, CLI, and MCP. Descriptor paths take precedence; conflicting path overrides fail. Do not delete/edit the descriptor to bypass missing-store errors.

**Settings → Local database** shows actual storage locations and Open folder. Diagnostics includes build, storage versions, descriptor, backup/recovery, and log paths. Data and local backups are unencrypted; download copies elsewhere. See [backup and restore](user-guide.md#backup-and-restore) for UI workflows and the [agent recovery commands](agent-guide.md#backup-and-recovery-commands) for CLI/offline recovery.

### Running commands for a managed installation

Use the descriptor's absolute `node_path` with scripts under `code_root`, rather than assuming global Node points to this installation. Replace the placeholders below with actual paths:

```sh
"<node_path>" "<code_root>/scripts/start.mjs" open --installation "<descriptor>" --json
"<node_path>" "<code_root>/scripts/assistant.mjs" config --installation "<descriptor>" --format json
```

`start.mjs`, `install.mjs`, `assistant.mjs`, and `access.mjs` accept `--installation`. For scripts without that option (including status, backup, restore, files, and extension commands), set `SATURDAY_INSTALLATION_PATH` in their environment. Use absolute script paths outside `code_root`.

Maintenance examples below use `node scripts/...` for readability; substitute managed paths as above. When parsing output, invoke scripts directly because npm may add a banner. Setup's `--json` emits one final result on stdout and progress/logs on stderr.

## Open, stop, and restart

Use the desktop shortcut, the installer's reopen command, or these source-checkout commands:

| Command                    | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `npm run open`             | Start/reuse the background UI and open Dashboard after readiness |
| `npm run status -- --json` | Verify installation/build readiness and report the actual URL    |
| `npm run restart`          | Request a UI restart                                             |
| `npm run stop`             | Stop only this installation's UI                                 |
| `npm run start`            | Production start with foreground control when creating a server  |

Open reuses an existing owned UI. Occupied preferred ports fall back to another local port without stopping unrelated apps. Closing the browser leaves the background server running. Ctrl-C stops a server created by foreground `npm run start`.

**Settings → Saturday server** provides Restart and confirmed Stop. Active data operations or backup streaming can block these controls; wait for completion before retrying. Stop/restart acknowledge requests; after restarting, use `node scripts/status.mjs --json` to verify `/health` readiness and identity. The UI polls readiness and reloads, or shows log/reopen guidance on timeout. Without JavaScript, reopen/reload after readiness.

The supervisor owns only the UI. Stopping or restarting it does not stop client-owned MCP or require an MCP reconnect. Code updates do require reconnecting MCP to load new code. Ownership/credentials/state live under `<data_root>/server.state/`; keep `server.json` private and never share controller tokens.

## Password login and local recovery

Configure optional browser protection through **Settings → Password login**, after opening the installed desktop shortcut. See the [user guide](user-guide.md#password-login) for inactivity, No expiration, logout, and restart behavior. Source developers must run setup to persist an installation descriptor before changing sign-in settings.

Access preferences and the password verifier live in `<data_root>/access.json`, with an initialization marker in `installation.json`. Sessions exist only in the web process. These settings are independent of career database migrations and excluded from career database/file/extension backups. Repeated setup, retained-data reinstall, and ordinary updates retain them; deleting owned user data during uninstall removes them. Missing or corrupt initialized access settings block UI startup rather than opening unprotected records.

The following local-owner maintenance commands are for an authorized agent or technical support, not ordinary startup. Substitute the managed installation's `node_path`, `code_root`, and `--installation <descriptor>` as described above:

```sh
node scripts/access.mjs status --json
node scripts/access.mjs timeout --hours 2 --json
node scripts/access.mjs timeout --no-expiration --json
node scripts/access.mjs disable --confirm --json
node scripts/access.mjs recover --confirm --json
```

Mutating commands stop an owned UI and verify it has exited, then hold the lifecycle maintenance guard while saving. A competing operation/shutdown failure refuses the change. An independently launched development/preview UI must be stopped first; current local MCP may remain connected. Older runtimes without an identified process role must be stopped once before access maintenance. The command leaves the UI stopped; use **Open Saturday** afterward. `recover --confirm` explicitly clears password protection, repairs the access settings file, and saves LAN off while retaining career data. It refuses linked settings files. No browser endpoint can reset a forgotten password.

`set-password --stdin` accepts JSON containing `password` and `confirm_password` through protected standard input. It follows the same stop/save rules. Never put passwords in command-line arguments, shell history, diagnostics, or assistant configuration. Results are JSON with account-enabled status and inactivity hours; no verifier, cookie, or plaintext password is returned.

### Locked out of Saturday

If you are signed in and know the current password, use **Settings → Password login → Disable password login** on the server computer and confirm. This takes effect immediately without stopping Saturday.

Forgotten-password recovery is command-line-only. Run the command on the computer hosting Saturday, using an OS account allowed to manage that installation. Saturday's MCP tools cannot disable, reset, or change browser authentication. An AI agent must have a separate terminal/process capability on the server computer; a connection to Saturday through MCP is insufficient. There is no browser recovery endpoint or recovery desktop launcher.

1. Open a terminal on the server computer (Command Prompt on Windows). Locate its `installation.json` using [Data locations](#data-locations-and-installation-descriptor). Source setup normally keeps it in `<Saturday folder>/data/installation.json`; custom database paths keep it beside the database.
2. Read `node_path` and `code_root` from that descriptor. Run the following command there, replacing all three placeholders with absolute paths:

   ```sh
   "<node_path>" "<code_root>/scripts/access.mjs" disable --installation "<descriptor>" --confirm --json
   ```

   For a source checkout with Node available, run `node scripts/access.mjs disable --confirm --json` from the Saturday folder instead. The old password is not required. Do not send passwords to an AI agent or paste them into this command.

3. Confirm the result reports `ok: true` and `password_enabled: false`. The command stops the owned UI, clears password protection, saves LAN off and leaves Saturday stopped. If it refuses because an independently launched development/preview server is still running, stop that server and retry. Wait for any installation operation to finish rather than removing its locks.
4. Open the **Open Saturday** desktop shortcut again. It opens without a password. Optionally enable a new password through Settings. Career records, documents, and backups are preserved.

If access settings are missing/corrupt, use the same invocation with `recover --confirm` instead of `disable --confirm`. Recovery also resets inactivity to its default and keeps LAN off. Preserve `installation.json`; do not delete credentials/settings files or edit initialization markers to bypass protection. A missing/invalid installation descriptor needs setup repair, not password recovery.

With protection enabled, updates must advertise `saturday.access_api: 1`; an incompatible candidate is refused rather than silently dropping login protection. The installer’s optional password support adds no npm dependency or career database migration. It does not add LAN binding or HTTPS.

## Start at login

**Settings → Saturday server → Start at login** is off by default. Save the checkbox to start the UI after sign-in without opening a browser. Reinstall preserves actual startup registration. Stop leaves Saturday stopped until you reopen it or sign in again; it does not automatically respawn.

From the installation's runtime:

```sh
node scripts/start.mjs login --json
node scripts/start.mjs login --enable
node scripts/start.mjs login --disable
```

The first command reads actual OS registration. Enable/disable affects only this installation's per-user startup. If the OS reports the feature unavailable, use the shortcut/CLI and retain the diagnostic message.

## Updates

Use **Settings → Updates and installation → Check for updates**, review the target, then confirm **Update Saturday**. Checks and updates are manual. Disconnect Saturday's MCP connection before publication; an alive client lease blocks it. A failed/stale check or local source change does not mean the app is up to date.

Source-checkout shortcuts:

```sh
npm run update:check
npm run update -- --confirm
```

The update command performs a fresh check. To pin the exact reviewed check, use the controller:

```sh
node scripts/install.mjs check --installation <descriptor> --json
node scripts/install.mjs update --installation <descriptor> --check-id <reviewed-id> --confirm --json
node scripts/install.mjs status --installation <descriptor> --json
```

Wait for persisted status `complete`. `--background` returns an operation receipt, not completion. `install.mjs status` reports installation operations; `status.mjs` checks UI readiness. With password login off, progress remains available through the external local controller while the UI is stopped, and readiness reloads the UI. With password login on, the separate browser progress gateway is disabled; the operation continues, and **Open Saturday** followed by sign-in shows its durable result. CLI status and local logs remain available. Keep operation logs/recovery paths if reopening fails.

Development updates compare exact `main` commits. Stable-release selection uses verified release metadata and version ordering; released installations never silently fall back to `main`. Dirty source checkouts block updates. Successful source updates retain the previous HEAD/build and switch to a pinned detached checkout. Managed updates retain previous code and independent database/file/extension recovery snapshots. Updates never silently reset development data or downgrade over migrated storage.

After completion, reconnect MCP and [verify installation/dataset/build identities](assistant-guide.md#verify-the-connection). Regenerate configuration if runtime paths changed.

## Repair

**Repair installation** retries compatible setup without resetting records. From a source checkout, use `npm run repair -- --retry-pdf`; for an explicit installation:

```sh
node scripts/install.mjs repair --installation <descriptor> --retry-pdf --json
```

Interrupted publication stays guarded until repair resolves it. Keep displayed operation logs and recovery paths; use the CLI if the UI cannot start. Repair does not blindly restore recovery snapshots or downgrade over migrations. `repair --source <local-source>` explicitly rebuilds a local snapshot when its original commit is unknown, using a local fingerprint identity.

Missing/corrupt stores need [data recovery](agent-guide.md#backup-and-recovery-commands), not an empty replacement. Unsupported schemas/manifests need a compatible build; never edit migration records or dataset IDs to bypass validation.

## Uninstall

Disconnect MCP first. Remove Saturday's client entry separately, preferably while its runtime still exists; the [assistant guide](assistant-guide.md#client-configuration-formats) describes the JSON disconnect helper and TOML handling.

**Settings → Updates and installation → Uninstall Saturday** confirms removal of owned application/runtime files, shortcuts, and login registration. Data, backups, and extensions are kept by default. CLI equivalent:

```sh
node scripts/install.mjs uninstall --installation <descriptor> --confirm --json
```

**Delete all Saturday data** is a separate unchecked UI option with a directory preview and literal `DELETE DATA` confirmation. The CLI requires explicit `--delete-data --confirm`; review exact directories and authorize deletion first. Download backups elsewhere before deletion.

Shared/external storage and unowned source checkouts are retained with cleanup guidance. Partial cleanup reports remaining work. Reinstall reuses retained data, or creates a fresh workspace after explicitly confirmed deletion. App uninstall does not discover or delete arbitrary assistant-client configuration.

## Troubleshooting

- **Dashboard does not open:** use the shortcut or Open command, check actual readiness/address, and inspect the reported server log. Do not kill unrelated processes using a preferred port.
- **Setup interrupted:** repeat the same command. For interrupted update publication, use Repair and preserve journals/logs.
- **PDF unavailable:** retry the installer with `--retry-pdf`, or source setup with `npm run setup:pdf`. Check platform libraries/fonts and that the same runtime user can read Chrome's cache.
- **Missing initialized storage or unsupported format:** preserve the original stores and use compatible recovery. Deleting the descriptor or editing dataset/migration metadata bypasses safeguards and is not a repair.
- **Assistant fails or shows different records:** follow [assistant troubleshooting](assistant-guide.md#troubleshooting), recopy configuration, reconnect, and compare identities.
