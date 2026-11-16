# Saturday release notes

## Saturday 0.1.3 — in development

Not yet released. Database schema 1 and file manifest 1 are unchanged.

### Lists and sorting

- Network lists people by their latest recorded interaction by default, with people who have no interaction last.
- Documents lists files by recently updated by default.
- Dashboard board cards are ordered by the job's latest update, and a reminder change now counts as job activity.
- Stage age on board cards reads in days under a month, then months, then years (5d, 3mo, 1y).

### Documents and editing

- Markdown files with a pipe in ordinary text or a horizontal rule now open in the visual editor instead of source mode. Tables and task lists (`- [ ]` checkboxes) now open in the visual editor too, and are saved back as the same Markdown tables and checkboxes. Before a Markdown file opens visually, Saturday now reads and rewrites it exactly as the visual editor would and compares the result, so a file the editor would change (a checkbox item with a wrapped second line, extra spaces inside code in a table cell, a table row the editor reads differently) stays in source mode instead of being altered. Documents with raw HTML, images, link or footnote definitions, or headings underlined with `---` or `===` also open in source mode, and the page says which construct is the reason. Saving from the visual editor is refused, with your edits kept, if the result would not read back.

### Installation and PDF setup

- Setup recovers from an interrupted Chrome download. A half-finished version folder that Puppeteer refuses to reuse is renamed aside with an `.incomplete-` suffix under the installation's cache instead of blocking PDF export; nothing is deleted, so you can remove the leftover folder yourself.
- Setup now creates every folder its descriptor records, so a fresh installation no longer points at an extension folder that does not exist.

### Dashboard and Jobs

- Opening Milestone history from the Dashboard no longer expands Advanced filters; other advanced filters still do.

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
