# Saturday: Career Dashboard

Saturday is a career dashboard for managing your job search, career pivot, or next step up. It keeps your opportunities, notes, and progress together in one place on your own computer.

**What makes it different from a typical job tracker:** Saturday is built to work alongside a personal AI assistant. Most trackers are a spreadsheet you have to maintain by hand. Saturday keeps your records in a structured form that your assistant can read and update when you ask, so it has lasting context about your search instead of starting from scratch in every chat. Over time, this is meant to be the foundation for an assistant that works as your career agent.

You do not need AI to use Saturday. The app works fully on its own, and connecting an assistant is optional.

## Contents

- [What Saturday can do today](#what-saturday-can-do-today)
- [Install and start](#install-and-start)
- [Updating](#updating)
- [Your data and privacy](#your-data-and-privacy)
- [Connect your assistant](#connect-your-assistant-optional)
- [Troubleshooting](#troubleshooting)
- [Where Saturday is headed](#where-saturday-is-headed)
- [Contributing](#contributing)
- [License](#license)

## What Saturday can do today

- **Keep each opportunity together.** Save a job title and company, then add location, work arrangement, employment type, compensation, source, a posting link, description, or notes. Star jobs for easy recognition.
- **Know what needs attention.** Schedule a follow-up with a comment, reschedule or clear it, and see overdue follow-ups and upcoming application deadlines on Dashboard.
- **Remember what happened.** Record applications, prescreens, interviews, offers, outcomes, and general notes in a dated history. You can correct a mistaken update later.
- **See where things stand.** The Dashboard shows active jobs, recent activity, upcoming dated updates, and how many jobs reached each step. The Jobs list starts with active jobs; Activity → All also shows dismissed, accepted, and rejected jobs. Search title/company/location separately, combine advanced filters, sort results, and page through all matches.
- **Focus on the jobs you still want.** Dismiss an opportunity you are no longer pursuing and reopen it if things change.
- **Keep your network close.** Save people, search by name/role/organization, link them to jobs with relationship notes, record optional interactions, and find due follow-ups.
- **Keep career documents together.** Create/edit Markdown, edit HTML/TXT source, manage CV, templates, and assistant context in Profile, attach independent files to jobs, and generate PDFs from HTML. Back up files separately from SQLite.
- **Work with your assistant.** Give an assistant on your computer access to your jobs, people, and documents so it can find an opportunity, add one, or record progress when you ask. Its changes appear in the app for you to review.

To get started in the app, choose **Add job**. Only the job title and company are required. Open that job later to add an update or review its history. The [user guide](docs/user-guide.md) explains statuses, counts, and corrections.

## Install and start

Saturday is in unversioned development toward `0.1.0`. Breaking changes may require an explicit data reset; development databases and backups have no cross-build compatibility guarantee. Formal release versioning and supported migrations begin at `0.1.0`. See the [development policy and provisional support matrix](docs/contributing.md#development-toward-010) before testing with important data.

The development installer prepares a private Node/npm runtime, builds Saturday, prepares optional PDF export and opens the Dashboard. No paid license, administrator access, global Node replacement or Git installation is required for this installer. Git is needed separately for Git-sourced extensions.

**Install with your assistant:** give an assistant with local process/filesystem access this repository and the following request:

> Read Saturday's README and docs/agent-guide.md. Install Saturday using the installer for my OS, preserve any existing workspace, and open the Dashboard. Help me connect my assistant using its supported local MCP configuration. Report the local address, data path and whether a real get_saturday_info call matched the installation, dataset and build shown in Settings. If local MCP is unavailable in this client, say so and leave app installation usable.

**Install manually:** download this revision's repository archive, extract it, and open Terminal or Command Prompt in that folder. During development, use its local source snapshot:

```sh
# macOS or Linux
sh install.sh --source .
```

```bat
rem Windows Command Prompt
install.bat --source .
```

The first install still uses a terminal. The installer creates an **Open Saturday** desktop shortcut where the OS permits it; use that shortcut for daily access. If shortcut creation is blocked, the installer reports an exact reopen command. Linux desktops may require **Allow Launching** for the generated desktop file. Installation never bypasses OS protections. A failed PDF setup can continue without PDF; rerun the same installer with `--retry-pdf` to download and validate Chrome again. `--skip-pdf` deliberately omits PDF setup.

Without `--source`, installation resolves official GitHub `main` to one exact commit and verifies the downloaded source against its Git blob hashes. Use this remote path after this installer revision is available on `main`; public standalone download commands are not published yet. Reinstall reopens/repairs the existing installation without replacing its code, relocating data, or changing login startup. Manual updates are implemented; unattended updates remain out of scope.

Initial implementation targets are macOS 14+ (Apple silicon/x64), Windows 11 x64, and Ubuntu 22.04/24.04 x64 with a graphical GNOME session. macOS has light disposable-install evidence; Windows/Linux runtime, reboot/login, desktop launch and full accessibility certification remain pending. Other architectures, distributions and headless sessions are not advertised installer targets yet. Shell prerequisites: curl/tar and shasum (macOS) or sha256sum (Linux); Windows requires curl.exe, tar.exe, certutil.exe and Windows Script Host for shortcuts. Restricted devices receive a fallback/error, not elevated installation.

**Source development:** Node.js 22.13+ and npm 10+ are still supported for the existing source commands:

```sh
git clone https://github.com/kennysantanu/saturday.git
cd saturday
npm run setup
npm run open
```

`npm run setup` safely prepares existing/missing stores and persists an installation descriptor; repeat setup preserves data. `npm run open` starts or reuses Saturday in the background and opens your browser after readiness. Closing the browser or launch terminal leaves it running. `npm run start` retains foreground developer use; Ctrl-C stops the server it created.

```sh
npm run status     # this installation's actual address and readiness
npm run restart    # request a restart; status confirms readiness
npm run stop       # stop only this installation's UI server
```

Settings → Saturday server provides Restart, confirmed Stop, and **Start at login**, off by default. Login startup starts web after you sign in without opening the browser; Stop leaves it stopped until you reopen or sign in again. Active data operations block lifecycle controls. Client-owned MCP remains available with web off. Occupied preferred ports fall back to another local port without stopping unrelated apps.

## Updating

**Update with your assistant:**

> Read Saturday's README and agent guide. Check for updates using my existing installation descriptor, show me the target, and update after my confirmation. Preserve my workspace. Disconnect Saturday's MCP before publication; report the completed operation and help me reconnect and verify the same installation, dataset and build with get_saturday_info.

**Update manually:**

Use **Settings → Updates and installation → Check for updates**, review the selected release or main commit, then confirm **Update Saturday**. There are no unattended checks or updates. Disconnect Saturday's MCP connection before publication; reconnect afterward to load the new code. The page shows progress through the external controller and reloads after readiness. If the Node path changes, copy the current assistant configuration from Settings too.

Manual and assistant commands use the same controller. From a source checkout:

```sh
npm run update:check
npm run update -- --confirm
npm run repair -- --retry-pdf
```

For a managed install, use your OS installer with `check`, `update --confirm`, or `repair --retry-pdf`, or the descriptor's Node with `<code_root>/scripts/install.mjs`. Pass `--installation <absolute-descriptor>` when operating outside the installation. `check --json` returns a check ID; `update --check-id <id> --confirm --json` pins that reviewed check. `status --json` reports the persisted result. Background acknowledgment is not completion.

Until releases exist, checks compare exact main SHAs; a changed head is not a promise of newer chronology. Installable stable releases are selected using verified release metadata and version order. Released installations never silently fall back to main. Stale checks, offline/rate-limit failures, incompatible storage, unsupported runtime artifacts and changed source produce readable errors. Source working-tree changes block updates; clean source updates retain the previous Git HEAD/build and use a pinned detached checkout. Managed previous code and verified database/file/extension recovery snapshots are retained. Updating never resets development data or blindly rolls back over migrated storage.

**Repair installation** retries the compatible staged setup without resetting stores. An interrupted publication stays guarded until repair completes. Keep the displayed operation log/recovery paths; use the CLI if the UI cannot start. `repair --source <local-source>` explicitly rebuilds a local snapshot when its original commit is unknown, with a local fingerprint build identity. First installation/reinstall preserves existing data; reinstall after confirmed data deletion creates a fresh workspace.

**Uninstall Saturday** stops the owned UI and removes owned application/runtime files, shortcuts and login registration. Data, backups and extension packages/data are kept by default. **Delete all Saturday data** additionally requires the directory preview and typing `DELETE DATA` in the UI (CLI: explicit `--delete-data --confirm`). Download backups elsewhere first. External/shared storage and unowned source checkouts are retained with cleanup guidance; a partial cleanup is reported. Disconnect/remove Saturday's entry in your assistant settings separately.

Formal versioning still begins at `0.1.0`; no version bump is part of these installation features.

## Your data and privacy

Managed installation keeps code, runtime and data separate: macOS uses `~/Library/Application Support/Saturday`, Windows `%LOCALAPPDATA%\Saturday`, and Linux `${XDG_DATA_HOME:-~/.local/share}/saturday`. Source setup keeps `data/saturday.db` inside the cloned repository. **Settings** shows the file's full path. To choose another location, set `SATURDAY_DB_PATH` before setup and startup. An absolute path is used as given; a relative path is resolved from the repository folder. The `data/` folder is excluded from Git.

Your data stays on your computer, and Saturday does not collect anything. If you connect an assistant, the privacy of what it reads depends on that assistant's provider, so review their terms before sharing sensitive details.

Use **Settings → Backup and restore → Back up now** to save database and files together. Choose **Database only** for a smaller backup, or use **Back up files only** separately. Saved backups appear in one history, with separate database and ZIP downloads for complete sets. Restoring replaces current jobs, people, relationships and history and creates a recovery backup first. Backups are unencrypted; store downloaded copies somewhere safe. The [user guide](docs/user-guide.md#backup-and-restore) covers the full workflow.

Backups are on demand: choose Database and files, Database only, or Files only in Settings. Saved entries show Download, Restore and confirmed Delete. A complete combined download is one importable ZIP; the underlying database/file formats stay independent. New archives live under `backups/database/` and `backups/files/` beside their respective stores (normally `data/backups/`); older adjacent backup folders remain readable. Restore staging remains separate. Backups are kept until explicitly deleted; there is no automatic backup worker or retention policy. Download copies to another drive to protect against disk failure. Extension databases require separate extension backups.

## Connect your assistant (optional)

Saturday includes a local MCP connection so an assistant can use the same job records you see in the browser. Open **Settings → Connect an assistant**, choose JSON or the local ChatGPT/Codex TOML snippet for your supported client, preserve existing settings and reconnect. Ask it to call `get_saturday_info` and compare the installation, dataset and build identities displayed in Settings; then read a known job. Configuration prepared does not mean connection verified. The assistant's app starts the connection itself; you do not need to run another server. The web app and the assistant share one database, so changes from either appear in both. Refresh the browser to see an assistant's latest changes.

An assistant can find and read jobs, create or edit job details, schedule follow-ups, and add a dated update. It can also set a numeric assessment and explanation, which are read-only in the UI. Its records are labeled **Added by assistant**. It can also create/list/export/delete manual backups, and preview/confirm a restore. Ask it to show the restore preview before authorizing replacement. Job history corrections/removals, dismissal and reopening remain in the browser. Network tools also find/edit people, link jobs, manage follow-ups and add/correct/delete scoped interactions. The web app does not need an AI account or API key. Keep the generated configuration private because it contains paths on your computer.

See [Connect your assistant](docs/assistant-guide.md) for the full steps, an example configuration, and troubleshooting.

## Troubleshooting

- **The page does not load, or the port is in use.** Run `npm run status`, or start on another port as shown above.
- **A "database" or "table not found" error.** Run `npm run migrate`.
- **Node version error.** Check `node -v`; Saturday needs 22.13 or newer.
- **The assistant cannot connect, or stopped after you moved the folder.** The configuration stores absolute paths. Run `npm run build`, then copy a fresh configuration from **Settings**. See the [assistant guide](docs/assistant-guide.md#troubleshooting).

## Where Saturday is headed

Saturday includes Network, career documents, Profile, follow-ups and optional trusted extensions. Later improvements include broader search, cloud storage and easier distribution. Saturday does not apply to jobs for you, import postings or extract PDFs, or sync between computers.

## Contributing

Development commands, project layout, and conventions are in [docs/contributing.md](docs/contributing.md). The [documentation index](docs/README.md) lists all guides.

## License

Saturday is released under the [MIT License](LICENSE).

### Current development storage

Jobs and Network use the fresh numeric schema-1 baseline. Files use a dataset-bound version-2 manifest; job attachments remain in `files/jobs/<id>`. Previous UUID databases/backups and unbound file manifests/pairs are unsupported. Startup never resets them automatically; use isolated `SATURDAY_DB_PATH` and `SATURDAY_FILES_PATH` values for testing until the planned final development reset.

Database and file backups remain independent and can be restored in either order. Job attachments require matching dataset identities; matching folder numbers alone are insufficient. A mismatch retains files, keeps user documents available, and offers explicit recovery through Settings. Rebuild/restart web and MCP together after updating. Development remains unversioned until `0.1.0`.

Jobs and Network show readable record numbers for assistant requests. Settings → Local database → Diagnostics shows selectable build, storage versions and local paths for troubleshooting.

## Extensions

Optional trusted extensions add one page, an independent SQLite database, and namespaced MCP tools. Enable the master switch in Settings; manage installed extensions in Extensions. Interview Practice is included as a portable starter package. See the [extension guide](docs/extension-guide.md) for installation, authoring and independent backup/restore. Core backups exclude extension databases.

Source setup keeps existing paths and stores `installation.json` beside the database. Web, CLI and MCP share it via `SATURDAY_INSTALLATION_PATH`. Setup records progress/logs for retry; missing initialized storage fails instead of creating an empty replacement. `npm run status -- --json` verifies the installation through `/health`, not just HTTP success. Managed bootstrap uses the per-user OS roots listed above. Private runtime provisioning, desktop shortcuts and optional login startup are implemented. Manual updates, repair and owned uninstall are implemented; full platform verification remains pending.
