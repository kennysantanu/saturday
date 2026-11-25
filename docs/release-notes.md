# Saturday release notes

## Saturday 0.1.5

Database schema 1 and file manifest 1 are unchanged.

### Documents and editing

- Markdown files containing HTML outside fenced code blocks, indented code blocks, and inline code spans—such as comments (`<!-- … -->`), tags like `<details>`, `<br>`, `<style>`, or declarations like `<!DOCTYPE html>`—now open in source mode instead of the visual editor, so their bytes are never rewritten as escaped `&lt;…&gt;` text. Markdown autolinks (`<https://…>`, `<name@host>`), angle-bracket link destinations, and ordinary prose comparisons still open visually, and the refusal notice explains why and points to wrapping the HTML in code or editing in the source view.

- The visual editor keeps the caret and the selection while you write. Opening a document for editing no longer sends the stored text back through the editor once the page finishes loading, and a word selected by double-click is no longer collapsed by the editor's focus handling, which is what made the caret jump under load.

- An edit that arrives from outside the editor is applied as a change to the affected range rather than as a reload of the whole document, so the selection and the undo history outside that range survive. Loading a different document resets the undo history, so Undo cannot replay one document's steps onto another.

- When a save fails, text typed while the save was in flight stays in the editor instead of being replaced by the values that were submitted.

### Updates

- Branch update checks now verify Git ancestry against the tracked branch on GitHub and offer an update only when the branch head is ahead of the installed commit. An installation whose commit is ahead of its tracked branch, diverged from it, or has no shared history with it is refused rather than offered a backward or sideways move.
- When an update check refuses for that reason, both Settings and the command-line updater display the refusal reason directly instead of reporting the build as up to date, and distinguish missing shared history from an unknown commit.

## Saturday 0.1.4

Database schema 1 and file manifest 1 are unchanged. The 0.1.3 changes are included in this
release.

### Updates and branch switching

- Settings → Updates → Advanced can move a managed installation between the available `main` and `dev` branches. Download the required database-and-files ZIP and confirm before moving. Every move clears installation data, including local backups, extensions, password and LAN settings; no previous data folder is retained. Source checkouts use Git instead.
- Branch moves pin the reviewed commit and track the selected branch for later manual update checks. An installation that tracks `dev` offers that branch's later commits as manual updates, and those updates keep the installation's data. Checks distinguish an unknown installed commit from an up-to-date build; local fingerprint builds retain their build ID and record Git commit and dirty state when these can be proved.
- A move requires proof that the browser holds the ZIP: Settings reads the file it received, sends its SHA-256 and byte count, and the move is refused when they do not match the exported backup. A receipt restored after a reload has no such proof and asks for the download again. With scripts disabled the form falls back to the server's stream reaching its end, a weaker proof that is recorded as such.
- Keep the downloaded ZIP outside the installation. It restores database and documents into a compatible fresh build, but does not contain extensions, password or LAN settings.

### Backups

- Backups export as one ZIP that holds your database and every document, and importing that same file restores both. Importing a combined backup ZIP now takes you straight to the restore preview for the file you chose instead of asking you to find it again in the list. The primary control is a single **Download database and files** button (which also saves a local copy); creating a local database-only, files-only, or combined backup without downloading remains under **Advanced backup options**.

### Documents and editing

- Markdown files with a pipe in ordinary text or a horizontal rule now open in the visual editor instead of source mode. Tables and task lists (`- [ ]` checkboxes) now open in the visual editor too, and are saved back as the same Markdown tables and checkboxes. Before a Markdown file opens visually, Saturday now reads and rewrites it exactly as the visual editor would and compares the result, so a file the editor would change (a checkbox item with a wrapped second line, extra spaces inside code in a table cell, a table row the editor reads differently) stays in source mode instead of being altered. Documents with images, link or footnote definitions, or headings underlined with `---` or `===` also open in source mode, and the page says which construct is the reason. HTML in a Markdown file is plain text in the visual editor, so notes that merely mention tags such as `<style>`, `<head>` or `<!DOCTYPE html>` open visually with every word intact; the tags are kept and saved as text (`&lt;style&gt;`) and are never interpreted. A document opens visually only when what a reader sees survives the conversion, so an image that would be reduced to its alt text keeps its file in source mode. Saving from the visual editor is refused, with your edits kept, if the result would not read back.

### Lists and sorting

- Network lists people by their latest recorded interaction by default, with people who have no interaction last.
- Documents lists files by recently updated by default.
- Dashboard board cards are ordered by the job's latest update, and a reminder change now counts as job activity.
- Stage age on board cards reads in days under a month, then months, then years (5d, 3mo, 1y).

### Network

- Unlinking a job–person link that carries a saved relationship note now asks for confirmation and states that the note will be lost; links without a note unlink straight through, there is no Undo for unlinking yet, unlinking through the MCP assistant still removes a link and its note without prompting because MCP has no confirmation UI, and confirming an unlink in one tab after another tab edited the same note removes the link with the newer note rather than re-prompting.

### Installation and PDF setup

- Setup recovers from an interrupted Chrome download. A half-finished version folder that Puppeteer refuses to reuse is renamed aside with an `.incomplete-` suffix under the installation's cache instead of blocking PDF export; nothing is deleted, so you can remove the leftover folder yourself.
- Setup now creates every folder its descriptor records, so a fresh installation no longer points at an extension folder that does not exist.

### Dashboard and Jobs

- Opening Milestone history from the Dashboard no longer expands Advanced filters; other advanced filters still do.

### Process leases and maintenance reliability

- Web and MCP runtimes now publish version-2 process leases (`<pid>.json`) backed by a per-process 256-bit secret and an unreferenced loopback identity listener (`127.0.0.1`), and synchronously remove their own verified lease on clean exit, `SIGTERM`, `SIGINT`, or stdin EOF.
- Update, repair, uninstall, sign-in maintenance, and extension checks now challenge live PIDs over loopback instead of trusting `pid` liveness alone. Stale v2 leases left behind after a crash whose PID was reused by an unrelated process are ignored without deleting files during reads.
- Legacy `{pid, role}` leases without an identity endpoint, identity probe timeouts/errors, and invalid or symlinked lease entries continue to block conservatively and now report the exact PID, lease path, and reason. Reconnect upgraded assistants to publish v2 proof; if an old legacy file blocks on an unrelated live PID, stop all Saturday runtimes, inspect the PID's owner, and move only that identified file to a recovery folder.
- Limitations: forced termination (`SIGKILL`) or power loss can still leave abandoned v2 files on disk for later offline cleanup, and mixed-version old readers remain conservative until upgraded. Cross-platform runtime verification remains separate from local macOS checks.

## Saturday 0.1.2

These changes made updating safer and easier to follow. Database schema 1 and file manifest 1 are unchanged.

### Updates

- Settings shows what an update installs: your version → the new version, a link to the changes since your build, when you last checked, and a release's notes ("What's new").
- A check expires after 15 minutes; Settings then asks you to check again instead of offering an update that would be refused.
- Settings warns when an assistant is connected. Updates started from Settings wait up to two minutes after building for the assistant to disconnect, then stop without changing anything.
- Command-line updates show the target, changes and notes, then ask before installing. They stop before asking when local source changes or a connected assistant would block the update. Command-line updates and all repairs stop right away while an assistant is connected, instead of after a long build.
- With password login on, Settings shows progress while Saturday runs and reloads once the restarted Saturday is ready, so you can sign in and see the result.
- If an update stops partway, Settings shows **Repair needed** with a **Repair now** button and hides **Update Saturday** until Repair finishes.
- A build from `main` moves to published releases only when the release is newer and can read its data; otherwise Settings explains why it stays on the current build.
- A failed update no longer blocks password or network settings, and Saturday restarts before reporting the failure so Settings keeps working without a manual refresh.
- Saturday keeps only the most recent previous build and removes leftover temporary update folders, so repeated updates no longer fill the disk.

## Saturday 0.1.0 — Private Beta

This is the first personal-workspace release baseline. Publication and platform acceptance are separate from implemented features. Install only an identified build and keep backups before updating or testing recovery.

### Included workflows

- Capture, search and organize jobs with configurable workflow stages, independent history, tags and a read-only Dashboard board.
- Maintain people, relationship notes and interactions; create job/person reminders with fixed dates and times.
- Manage general and job documents, select Profile context, and generate PDFs from saved HTML with managed Chrome.
- Use optional password login and local-network browser access. LAN is opt-in and HTTP does not encrypt traffic; the server computer must remain on.
- Connect a local stdio MCP assistant, including offline build-matched documentation search/read. Hosted-only chats cannot launch a local MCP process.
- Create independent or coordinated manual backups, preview restores, and use explicit recovery for interrupted operations. Trusted Node extensions keep separate backups.

### Installation and updates

Use the [installation guide](installation-guide.md) for the desktop shortcut, optional start at login, update, repair and uninstall. Source and managed installations identify their actual data paths. Uninstall retains data by default; deleting owned data requires separate confirmation.

Database schema 1 and file manifest 1 are frozen independently of app version `0.1.0`. Shipped changes after this baseline require a new app version; database changes also append a new integer migration. Released migrations and fixtures remain immutable. Supported updates preserve user data through forward migrations. Unsupported storage rejects unchanged. Never manually edit version or dataset markers to force compatibility. Back up files as well as the database; core backups exclude extension-owned databases and access settings.

Settings and local MCP share the checked-release update controller. An assistant can check, request approval and queue an update. Disconnect MCP before publication, follow completion in Settings, then reconnect and verify identity and a known record. A queued response is not a completed installation.

### Verification and known limits

Automated service/protocol, Cloudflare-core, production browser and recovery checks have passed on macOS 26.4.1 arm64 with Node 25.9.0 and Chrome 156.0.8078.47. A separate isolated managed macOS installation exercised private Node 24.21.0, PDF generation, populated backup/restore and launcher-process readiness. Its earlier snapshot is recorded in `tests/verification/macos-0.1.0.json`; it is not a fresh installation of every later candidate. Run `npm run verify` on the exact final clean revision and retain its receipt before preparing distribution metadata.

These automated results do not certify a platform or assistant client. Windows 11 x64, Ubuntu 22.04/24.04 x64 GNOME, other Mac architectures/minimum OS versions, real desktop/login behavior, physical phones, screen readers and actual assistant-client connections require hands-on acceptance before advertising support. Headless PDF checks exercise generation/download and source retention; embedded-preview navigation, appearance and selectable content remain manual checks.

Cloudflare/Supabase deployment, Docker packaging, native mobile apps, remote MCP, built-in AI/provider sign-in, synchronization and multi-user hosting are unavailable. The portable application/storage foundations and local workerd harness do not establish those deployment capabilities.

Reminders use fixed date/time values and the server's local clock; they do not convert timezones or send notifications. Dismissal is not appointment completion. Permanent deletion has no Trash or Undo; backups and explicit recovery are separate actions. Local data and backup files are unencrypted.

### Release status

**Release baseline finalized — awaiting publication.** App `0.1.0` is frozen; subsequent shipped changes require a new app version and matching source verification/metadata. Database schema and file manifest remain at version 1. This status does not mark the beta published or manually accepted.

A verified source commit, matching metadata asset, applicable user-test results and publication approval are still required before distribution. See the [release procedure](contributing.md#prepare-a-release) and [support matrix](contributing.md#provisional-support-matrix). No tag, remote branch or public release is created by the local preparation commands.
