# Saturday: Career Dashboard

Saturday is a local career dashboard for your job search, career pivot, or next step up. It keeps jobs, people, documents, and progress on your computer. An optional local MCP connection lets your personal AI assistant work with the same records you see in the browser. No AI account or API key is required to use the app.

## What Saturday can do

- **Jobs:** track opportunities with editable workflow stages, posting details, stars, follow-ups and deadlines. Change stage on job detail or add history separately. Search, combine filters, sort and paginate the job list; configure stages in Settings.
- **Dashboard:** see active jobs, upcoming events, due follow-ups, application deadlines, and historical progress counts.
- **Network:** save people, link them to jobs, keep relationship notes, schedule follow-ups, and record interactions.
- **Documents and Profile:** upload files, edit Markdown/HTML/TXT, designate a Master CV and templates, attach independent copies to jobs, and generate PDFs from saved HTML.
- **Backups:** manually save the database, files, or both; download, import, preview restores, and retain recovery snapshots.
- **Assistant access:** read and update jobs, people, and documents through local stdio MCP. Assistant assessments are readable in the UI.
- **Extensions:** install trusted packages with their own page, optional database, and MCP tools. Interview Practice is included as a starter package.
- **Optional password login:** protect the browser UI with one local password, configurable inactivity logout or No expiration, and change/disable/logout controls in Settings. Forgotten-password recovery requires the [server computer’s command line](docs/installation-guide.md#locked-out-of-saturday); MCP cannot manage authentication.
- **Optional LAN access:** allow your phone to use the same workspace through Settings, a confirmation warning, and a server restart. LAN and password protection are independent and off by default.
- **Installation controls:** open in the background, create a desktop shortcut, opt into startup at login, and manually update, repair, or uninstall.

Saturday does not currently apply to jobs, import job postings, extract PDF text, sync computers, or run built-in AI. Extensions run trusted code and have [separate backups](docs/extension-guide.md).

## Install and start

### Install with an AI agent

Give an AI agent with local filesystem and process access this prompt:

> Install Saturday from https://github.com/kennysantanu/saturday and connect its local MCP server to my assistant. Read README.md, docs/installation-guide.md, and docs/agent-guide.md first. Use the installer for my OS, preserve any existing Saturday workspace and unrelated assistant settings, and open the Dashboard. Verify the MCP connection with get_saturday_info and compare installation, dataset, and build identities with Settings. Report the local address, data location, and connection result. If this client cannot run local MCP, explain that limitation and leave Saturday usable on its own.

### Quick manual installation (without AI)

Download and extract this repository revision, then open Terminal or Command Prompt in that folder:

```sh
# macOS or Linux
sh install.sh --source .
```

```bat
rem Windows Command Prompt
install.bat --source .
```

The installer prepares a private runtime, builds Saturday, and opens Dashboard. Use **Open Saturday** on the desktop afterward, or the reopen command printed by the installer. AI is optional.

See the [installation guide](docs/installation-guide.md) for requirements, source development, PDF setup, data locations, server controls, updates, repair, and uninstall. Platform support is [provisional](docs/contributing.md#provisional-support-matrix).

## Your data and privacy

Open the desktop shortcut, then use **Settings → LAN access → Allow LAN access** to enable phone access. Accept the warning, restart now or later, then open a displayed **Phone address** on your phone’s browser while connected to the same trusted network. See [LAN access](docs/user-guide.md#lan-access) for disabling, pending changes, and connection help.

Use **Settings → Password login** for optional browser protection; it does not affect local MCP. See [password login](docs/user-guide.md#password-login) for sessions and recovery. LAN and passwords are independent. LAN binds all IPv4 interfaces and can be reached by devices beyond one Wi-Fi network. HTTP does not encrypt passwords, sessions, or records. Without a password, reachable devices can read and edit the workspace after LAN is enabled.

**Settings → Local database** shows your actual data paths. Managed installs use a per-user application directory; source setup defaults to the repository's ignored `data/` folder. See [data locations and the shared installation descriptor](docs/installation-guide.md#data-locations-and-installation-descriptor) before configuring custom paths.

Career records and documents are stored locally. Installing and updating downloads software; connecting an assistant makes the records it reads subject to that provider's privacy terms. Trusted extensions run with Saturday's access.

Use **Settings → Backup and restore → Back up now** for database and files together, or select either independently. Complete backups download as one importable ZIP. Backups are unencrypted, kept until explicitly deleted, and exclude extension databases. There is no automatic backup schedule or retention policy. Download copies elsewhere to protect against disk failure. See [backup and restore](docs/user-guide.md#backup-and-restore).

Job attachments are bound to the database's dataset identity. Matching job numbers alone cannot associate files with another database. A mismatch preserves files and user documents but blocks normal job-attachment access until matching backups are restored. Current storage formats and compatibility rules are in [Contributing](docs/contributing.md#storage-contracts).

## Connect your assistant (optional)

Open **Settings → Connect an assistant** and copy the generated configuration for a client that can launch local stdio MCP processes. Preserve existing client settings, reconnect, then call `get_saturday_info` and compare `installation_id`, `dataset_id`, and `build.id` with Settings. Read a known job when available. Copying configuration alone does not verify a connection.

The client launches MCP; no separate HTTP MCP server is required. UI and MCP share storage, and MCP works with the UI stopped. Refresh the browser after assistant writes. See the [assistant guide](docs/assistant-guide.md) for connection steps and troubleshooting, and the [MCP reference](docs/mcp-reference.md) for tool inputs and safeguards.

## Troubleshooting

For startup, PDF, update, or storage issues, follow [installation troubleshooting](docs/installation-guide.md#troubleshooting). For connection or mismatched-record issues, follow [assistant troubleshooting](docs/assistant-guide.md#troubleshooting). Preserve logs and existing data when investigating failures.

## Documentation and contributing

Start with the [documentation index](docs/README.md). [Contributing](docs/contributing.md) covers development, source layout, storage contracts, and verification; the [design guide](docs/design-guide.md) covers shared UI patterns.

Saturday is in development toward its first `0.1.0` release. The package version is a placeholder, and compatibility between development builds is not guaranteed. Setup never silently resets existing data. See the [development and storage policy](docs/contributing.md#development-toward-010).

Saturday is released under the [MIT License](LICENSE).
