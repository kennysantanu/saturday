# Saturday 0.1.0 — Private Beta

This is the first personal-workspace release baseline. Publication and platform acceptance are separate from implemented features. Install only an identified build and keep backups before updating or testing recovery.

## Included workflows

- Capture, search and organize jobs with configurable workflow stages, independent history, tags and a read-only Dashboard board.
- Maintain people, relationship notes and interactions; create job/person reminders with fixed dates and times.
- Manage general and job documents, select Profile context, and generate PDFs from saved HTML with managed Chrome.
- Use optional password login and local-network browser access. LAN is opt-in and HTTP does not encrypt traffic; the server computer must remain on.
- Connect a local stdio MCP assistant, including offline build-matched documentation search/read. Hosted-only chats cannot launch a local MCP process.
- Create independent or coordinated manual backups, preview restores, and use explicit recovery for interrupted operations. Trusted Node extensions keep separate backups.

## Installation and updates

Use the [installation guide](installation-guide.md) for the desktop shortcut, optional start at login, update, repair and uninstall. Source and managed installations identify their actual data paths. Uninstall retains data by default; deleting owned data requires separate confirmation.

Database schema 1 and file manifest 1 are frozen independently of app version `0.1.0`. Shipped changes after this baseline require a new app version; database changes also append a new integer migration. Released migrations and fixtures remain immutable. Supported updates preserve user data through forward migrations. Unsupported storage rejects unchanged. Never manually edit version or dataset markers to force compatibility. Back up files as well as the database; core backups exclude extension-owned databases and access settings.

Settings and local MCP share the checked-release update controller. An assistant can check, request approval and queue an update. Disconnect MCP before publication, follow completion in Settings, then reconnect and verify identity and a known record. A queued response is not a completed installation.

## Verification and known limits

Automated service/protocol, Cloudflare-core, production browser and recovery checks have passed on macOS 26.4.1 arm64 with Node 25.9.0 and Chrome 156.0.8078.47. A separate isolated managed macOS installation exercised private Node 24.21.0, PDF generation, populated backup/restore and launcher-process readiness. Its earlier snapshot is recorded in `tests/verification/macos-0.1.0.json`; it is not a fresh installation of every later candidate. Run `npm run verify` on the exact final clean revision and retain its receipt before preparing distribution metadata.

These automated results do not certify a platform or assistant client. Windows 11 x64, Ubuntu 22.04/24.04 x64 GNOME, other Mac architectures/minimum OS versions, real desktop/login behavior, physical phones, screen readers and actual assistant-client connections require hands-on acceptance before advertising support. Headless PDF checks exercise generation/download and source retention; embedded-preview navigation, appearance and selectable content remain manual checks.

Cloudflare/Supabase deployment, Docker packaging, native mobile apps, remote MCP, built-in AI/provider sign-in, synchronization and multi-user hosting are unavailable. The portable application/storage foundations and local workerd harness do not establish those deployment capabilities.

Reminders use fixed date/time values and the server's local clock; they do not convert timezones or send notifications. Dismissal is not appointment completion. Permanent deletion has no Trash or Undo; backups and explicit recovery are separate actions. Local data and backup files are unencrypted.

## Release status

**Release baseline finalized — awaiting publication.** App `0.1.0` is frozen; subsequent shipped changes require a new app version and matching source verification/metadata. Database schema and file manifest remain at version 1. This status does not mark the beta published or manually accepted.

A verified source commit, matching metadata asset, applicable user-test results and publication approval are still required before distribution. See the [release procedure](contributing.md#prepare-a-release) and [support matrix](contributing.md#provisional-support-matrix). No tag, remote branch or public release is created by the local preparation commands.
