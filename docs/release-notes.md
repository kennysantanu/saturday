# Saturday 0.1.0 — Private Beta

This is the first personal-workspace release candidate. Publication and platform acceptance are separate from implemented features. Install only an identified build and keep backups before updating or testing recovery.

## Included workflows

- Capture, search and organize jobs with configurable workflow stages, independent history, tags and a read-only Dashboard board.
- Maintain people, relationship notes and interactions; create job/person reminders with fixed dates and times.
- Manage general and job documents, select Profile context, and generate PDFs from saved HTML with managed Chrome.
- Use optional password login and local-network browser access. LAN is opt-in and HTTP does not encrypt traffic; the server computer must remain on.
- Connect a local stdio MCP assistant, including offline build-matched documentation search/read. Hosted-only chats cannot launch a local MCP process.
- Create independent or coordinated manual backups, preview restores, and use explicit recovery for interrupted operations. Trusted Node extensions keep separate backups.

## Installation and updates

Use the [installation guide](installation-guide.md) for the desktop shortcut, optional start at login, update, repair and uninstall. Source and managed installations identify their actual data paths. Uninstall retains data by default; deleting owned data requires separate confirmation.

Database schema 1 and file manifest 1 are independent of app version `0.1.0`. Supported updates preserve user data through forward migrations. Unsupported storage rejects unchanged. Never manually edit version or dataset markers to force compatibility. Back up files as well as the database; core backups exclude extension-owned databases and access settings.

## Verification and known limits

Automated service/protocol, Cloudflare-core, production browser and recovery checks are available through `npm run verify`. This does not certify a platform or assistant client. macOS local installation evidence is recorded separately after the isolated installation check. Windows 11 x64, Ubuntu 22.04/24.04 x64 GNOME, other Mac architectures/minimum OS versions, real desktop/login behavior, physical phones, screen readers and actual assistant-client connections require hands-on acceptance before advertising support.

Cloudflare/Supabase deployment, Docker packaging, native mobile apps, remote MCP, built-in AI/provider sign-in, synchronization and multi-user hosting are unavailable. The portable application/storage foundations and local workerd harness do not establish those deployment capabilities.

Reminders use fixed date/time values and the server's local clock; they do not convert timezones or send notifications. Dismissal is not appointment completion. Permanent deletion has no Trash or Undo; backups and explicit recovery are separate actions. Local data and backup files are unencrypted.

## Release status

The package is `0.1.0`. A verified source commit, matching metadata asset and publication approval are still required before distribution. See the [release procedure](contributing.md#prepare-a-release) and [support matrix](contributing.md#provisional-support-matrix). No tag, remote branch or public release is created by the local preparation commands.
