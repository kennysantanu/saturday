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

Saturday runs from source with Node.js; a packaged installer is not available yet. You need Node.js 22.13 or newer and npm 10 or newer. Check with `node -v` and `npm -v`. No separate database is required. Setup also installs managed Chrome for HTML-to-PDF generation; basic jobs/documents work without Chrome. Commands below use macOS and Linux shell syntax.

```sh
git clone https://github.com/kennysantanu/saturday.git
cd saturday
npm run setup
npm run start
```

`npm run setup` installs dependencies, builds web/MCP, validates PDF export (optional on failure), and safely prepares existing/missing stores. It persists an installation descriptor outside application code; repeat setup preserves existing data. Use `npm run setup -- --json` for a machine-readable result. Saturday listens only on this computer.

For daily use, run `npm run open`: it starts Saturday in the background and opens your browser after readiness, or reuses the running server. Closing the browser or launch terminal leaves it running. `npm run start` keeps a foreground terminal with Ctrl-C to stop the server it created; attaching to an existing server leaves it running.

```sh
npm run open       # start/reuse in the background and open the Dashboard
npm run status     # report this installation's actual address and readiness
npm run restart    # acknowledge a restart; check status for readiness
npm run stop       # stop only this installation's UI server
```

Settings → Saturday server also provides Restart and confirmed Stop. Busy data operations block both controls. Stopping the UI leaves client-owned MCP access available. Start again with `npm run open`. If the preferred port is occupied by another app, Saturday chooses a free local port and reports it; status uses the saved address. You can request a preferred port with `PORT=3100 npm run open` (macOS/Linux) or `set PORT=3100` before the command in Windows Command Prompt. Desktop shortcuts and optional start at login remain planned.

If you want an assistant to install Saturday into a folder you choose, give it this repository URL and the [agent setup guide](docs/agent-guide.md).

## Updating

Stop the UI with `npm run stop` and disconnect assistant MCP sessions before updating, then run:

```sh
git pull
npm run setup
npm run start
```

`npm run setup` is safe to repeat against compatible storage and never intentionally resets your data. During unversioned development, breaking format changes may instead require a documented explicit reset. Keep backups with the matching build if you need to retain development data.

## Your data and privacy

Saturday saves your jobs in `data/saturday.db` inside the cloned repository. **Settings** shows the file's full path. To choose another location, set `SATURDAY_DB_PATH` before setup and startup. An absolute path is used as given; a relative path is resolved from the repository folder. The `data/` folder is excluded from Git.

Your data stays on your computer, and Saturday does not collect anything. If you connect an assistant, the privacy of what it reads depends on that assistant's provider, so review their terms before sharing sensitive details.

Use **Settings → Backup and restore → Back up now** to save database and files together. Choose **Database only** for a smaller backup, or use **Back up files only** separately. Saved backups appear in one history, with separate database and ZIP downloads for complete sets. Restoring replaces current jobs, people, relationships and history and creates a recovery backup first. Backups are unencrypted; store downloaded copies somewhere safe. The [user guide](docs/user-guide.md#backup-and-restore) covers the full workflow.

Backups are on demand: choose Database and files, Database only, or Files only in Settings. Saved entries show Download, Restore and confirmed Delete. A complete combined download is one importable ZIP; the underlying database/file formats stay independent. New archives live under `backups/database/` and `backups/files/` beside their respective stores (normally `data/backups/`); older adjacent backup folders remain readable. Restore staging remains separate. Backups are kept until explicitly deleted; there is no automatic backup worker or retention policy. Download copies to another drive to protect against disk failure. Extension databases require separate extension backups.

## Connect your assistant (optional)

Saturday includes a local MCP connection so an assistant can use the same job records you see in the browser. In short: open **Settings → Connect an assistant**, copy the configuration into your assistant app's MCP settings, reconnect, and ask it to list your jobs. The assistant's app starts the connection itself; you do not need to run another server. The web app and the assistant share one database, so changes from either appear in both. Refresh the browser to see an assistant's latest changes.

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

Source setup keeps existing paths and stores `installation.json` beside the database. Web, CLI and MCP share it via `SATURDAY_INSTALLATION_PATH`. Setup records progress/logs for retry; missing initialized storage fails instead of creating an empty replacement. `npm run status -- --json` verifies the installation through `/health`, not just HTTP success. Default per-user OS roots are defined for future bootstrap installation; desktop installers/shortcuts and login startup remain planned. Background UI launch and authenticated Settings Stop/Restart are available.
