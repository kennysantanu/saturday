# Using Saturday

Saturday keeps your job records and documents on your computer. Use the web app on its own or connect an optional assistant. For installation, start with the [README](../README.md#install-and-start).

## Add and find jobs

1. Open **Dashboard** or **Jobs** and choose **Add job**.
2. Enter a **Job title** and **Company**. The main form also has an optional posting link, description, notes, and a star checkbox. Under **More details**, you can add employment type, work arrangement, location, compensation, source, an application deadline, and a follow-up date/comment.
3. Save the job to open its detail page. Use **Edit** there to correct its information later.

**Jobs** starts with active jobs you are still pursuing. Change **Activity** to Inactive or All to include dismissed jobs and jobs made inactive by an accepted offer or employer rejection. Open a row to see its details and history. A new job can have no updates.

Enter separate **Title contains**, **Company contains**, and **Location contains** searches, choose current statuses or Starred, then select **Apply filters**. Every filter must match; multiple choices in one category match either choice. Text searches treat `%`, `_`, and backslash literally. Filters are saved in the URL, so refresh, Back/Forward, and shared links preserve the applied selection. Remove individual chips or choose **Clear filters** to return to active jobs.

**Advanced filters** includes steps a job **ever reached**, work arrangement, employment type, source, manual/MCP origin, follow-up dates, application deadlines, assistant score, and created/updated dates. Ever reached always includes active and inactive jobs; you can still narrow those results by current status. Not specified finds missing optional category values. Score bounds accept decimals and zero, with no fixed scale; Unscored clears the bounds.

For follow-ups and deadlines, Overdue means before today and Upcoming means after today. Choose **Date range** to use From/Through; either bound can be left empty. Date ranges are inclusive. Today and created/updated date boundaries use the computer running Saturday’s local calendar. Search date filters do not hide inactive records unless Activity is Active.

Sort by recent updates or creation, highest score, earliest follow-up, or earliest deadline. Missing scores/dates appear last. Results show the full matching count, with 50 jobs per page and Previous/Next controls. Applying or removing filters starts at page one. These views never change stored jobs, Dashboard counts, or backups.

## Record progress and notes

On a job's detail page, choose **Add update** and enter the date. Select a progress step or outcome: Applied, Prescreen, Interview 1, Interview 2, Offer received, Accepted offer, or Rejected by employer. You may add a note for context. Select **Note** to record something without changing the job's progress; a Note requires text.

The date can describe something that happened or a confirmed future interview. Future dated updates appear under **Coming up** on the job and Dashboard. The job's **History** shows its dated updates, including entries added by a connected assistant. Refresh the browser to see changes an assistant made while the page was open.

**Dismiss job** (in the job's three-dot menu, next to Add update) means you stopped pursuing it. **Rejected by employer** means the employer declined. Dismissed jobs can be reopened from their detail page. Accepted and rejected jobs become inactive; if that outcome was entered by mistake, edit or remove the outcome update to correct it. Inactive jobs can still receive notes, but need to be active before receiving another milestone.

To fix an ordinary update, use its **Edit** action. To remove one, choose **Remove update** and confirm. The app recalculates the displayed status and Dashboard counts. Dismiss and Reopen entries are reversed through the corresponding job action. Removed updates are not kept in an undo history.

## Read the Dashboard

**Active now** counts jobs still being pursued. **Progress so far** counts distinct jobs that ever reached each step or outcome, including inactive jobs. A job that reached Applied and Interview 1 appears in both counts; repeating Interview 1 still counts that job only once for that step. Dismissing and later reopening a job does not erase its earlier progress or its historical Dismissed count.

Select a progress count to see the jobs behind it. **Needs attention** lists active-job follow-ups and application deadlines, earliest first, and says so when nothing is due. **Recently updated** links to jobs with recent activity. **Coming up** appears when active jobs have future dated updates. On wide screens, Coming up and Progress so far sit in a side column.

## Follow-ups, starred jobs, and assessments

Use **Star** on a job to mark it for attention; starred jobs show a star in lists. In the **Follow-up** card, schedule one date with an optional comment, reschedule it, or clear it. This does not add history or change the job status. Dashboard shows active-job follow-ups, earliest first, including overdue dates, alongside upcoming application deadlines. Inactive jobs keep their follow-up but hide it from Dashboard until reopened. Dates use your local calendar.

**Assistant assessment** displays a numeric score and plain-text explanation managed through MCP. You can read both in the UI but cannot edit them there. There is no fixed scoring scale; ask your assistant to use a consistent scale and explain its criteria. An empty score means unscored; zero is a valid score.

## Network and job relationships

Open **Network → Add person**. Name is required; role, organization, phone, email, profile/website and general Notes are optional. Save, then use **Edit details** for corrections. Duplicate names/emails are allowed; Saturday does not merge people automatically.

Use separate **Name**, **Role**, and **Organization** filters, optionally choose Follow-up and Sort, then **Apply filters**. Every supplied field must match; text uses literal contains matching, including `%`, `_` and backslash. Filters/pages live in the URL for refresh, sharing and Back/Forward. Clear filters shows everyone. Lists have 50 people per page; sorts are Name, Earliest follow-up, and Latest recorded interaction. Missing dates sort last.

On a person's page, **Link to job** searches existing jobs (including inactive jobs). On a job, its **Network → Link person** chooser searches existing people by name/role/organization. Select a record, optionally enter a **Relationship note**, and explicitly confirm the link. A person can link to many jobs and a job to many people. **Edit link note** and **Unlink** work from either side. Unlink keeps both records and their history. Person **Notes** are general context; **Relationship note** applies only to that job.

From the job chooser, **Add person** opens the normal form and returns to the chooser with the saved person selected. Confirm **Link person** to create the relationship; saving alone does not link. Cancel returns to the job. If the job is unavailable, the person can still be saved in Network.

**Schedule follow-up**, **Reschedule**, and **Clear follow-up** manage one date/comment for that person. Overdue means before today; Upcoming means after today, using the host computer's local calendar. These reminders appear in Network, independently of job reminders. There are no notifications or recurring reminders.

**Interactions** is optional. Add a completed interaction with its date and **Interaction note**; backdated entries are supported, future dates belong in Follow-up. Edit a mistaken date/note or Delete and confirm to permanently remove one entry. Recording an interaction never clears a reminder. History sorts by date, then recording order; paginated history and linked jobs have independent pages. “Last recorded interaction” summarizes notes on file, including unanswered outreach; “None recorded” does not prove you have never contacted someone. Permanent person deletion is outside this version.

## Documents and Profile

**Documents** holds reusable files. Choose **Upload** to save a file immediately (up to 25 MiB), or **New document** to create Markdown. Search by filename. Each row offers Edit and a menu with Preview, Download, Rename, Duplicate, and permanent Delete. There is no Trash or automatic version history.

Markdown has a basic visual editor and source mode; unsupported formatting stays in source mode to preserve it. HTML and TXT use source editors. Editing is limited to valid UTF-8 text up to 1 MiB. PDFs support browser preview/download; other binary formats download only. Click **Save** explicitly. If another editor or assistant changes the file, reload and reconcile, or save your draft as a separate copy.

Open **Profile** from the Documents header to assign reusable context:

| Designation           | Required format |
| --------------------- | --------------- |
| Master CV             | Markdown        |
| Resume template       | HTML            |
| Cover letter template | HTML            |
| Career direction      | Markdown        |
| Assistant preferences | Markdown        |

For each designation, select an existing document, upload one, or create one using the editor. Selected files must be readable UTF-8 within the 1 MiB limit. They remain ordinary Documents entries with designation labels. Clearing or replacing a selection keeps the old file. PDF/Word conversion is not included.

On a job, choose **Manage documents** to upload/create attachments or **Copy to this job** for an independent copy of a reusable document. Editing a job copy never edits its source. The main Documents page does not browse job folders.

To export a resume, save self-contained HTML and choose **Generate PDF** from its preview. Saturday saves a new PDF beside the HTML; existing PDFs are preserved with numbered filenames. Later HTML edits do not update previous PDFs. Scripts and external resources are blocked, so use self-contained print CSS and installed fonts. PDF generation requires Chrome prepared during setup.

## Data and assistant connection

**Settings → Local database** shows the actual data path and **Open folder** action. Expand **Diagnostics** for build, storage versions, descriptor, backup/recovery, and log paths. Source setup normally uses the repository's `data/`; managed installs use a separate [per-user installation root](installation-guide.md#data-locations-and-installation-descriptor). Repeating setup preserves data. Missing initialized storage requires repair/recovery, not a reset.

**Settings → Connect an assistant** generates configuration for a supported local MCP client. Reconnect the client, call `get_saturday_info`, and compare installation, dataset, and build identities with Settings. Read a known job when available. Copying configuration alone does not verify access. See the [assistant guide](assistant-guide.md) for connection steps and the [MCP reference](mcp-reference.md) for tools.

Jobs and people show numbers such as **#123** in lists, headings, and relationship pickers. Their sequences are separate; say “job #123” or “person #123” when asking your assistant to change a record. Refresh the browser after assistant writes. Job history corrections/removals, dismissal, and reopening remain browser actions; assistant scores are read-only in the UI.

## Backup and restore

In **Settings → Backup and restore**, choose what to include, then **Back up now**:

| Contents                     | Saves                                                                     | Download                    |
| ---------------------------- | ------------------------------------------------------------------------- | --------------------------- |
| Database and files (default) | Core records, reusable documents, Profile selections, and job attachments | One importable combined ZIP |
| Database only                | Jobs, people, relationships, follow-ups, and both histories               | SQLite backup               |
| Files only                   | File manifest, Profile selections, reusable documents, and attachments    | File ZIP                    |

Core backups exclude extension databases. Backups contain private information and are unencrypted. They are kept until you delete them; there is no automatic schedule or retention policy. Download copies to another drive to protect against disk failure.

### Saved backups

History shows contents, date, size, and Download, Restore, and confirmed Delete actions. A complete combined backup requires both artifacts; an incomplete entry is labeled **Partial** and retains the available artifact for independent recovery. Delete removes only selected backup artifacts, not live records, and rejects sources used by an active restore preview.

Use **Import a combined backup ZIP** to add a downloaded complete backup to history. Standalone database imports are under **Import a database backup** (up to 100 MiB); an uploaded database takes priority over the selected saved backup. File ZIP imports are under **Advanced file recovery**. Importing an archive is separate from confirming a restore.

### Restore a backup

Select a saved backup and choose **Preview restore** (or Restore from its history entry). Review current/incoming counts and warnings, then confirm. Database restore replaces all core records rather than merging them; file restore replaces the selected collection; a combined restore replaces both. Recovery snapshots are saved first. Database-only restore leaves files in place, and file-only restore leaves records in place. Refresh other tabs after completion.

Previews expire after ten minutes and become invalid on relevant changes. Each preview can be attempted once, including failed attempts. If a response is interrupted, inspect current data and recovery backups before preparing another restore. A corrupt active database requires offline recovery; the in-app workflow needs a healthy target.

Only supported storage formats can be restored. Older UUID-era databases and unbound file backups are rejected without deletion or guessed conversion. Supported dataset-bound version-1 file manifests upgrade to the current format. Newer schemas require a compatible app. Same-dataset database restores preserve allocation counters so older backups do not reuse newer record numbers.

### File backups and dataset mismatches

Under **Advanced file recovery**, preview **Add missing files** or **Replace entire file collection**. Add missing stops on conflicts; Replace installs the incoming collection. A complete file recovery archive is retained before changes. File ZIPs have no total-size cap, but staging/recovery needs enough disk space; the database artifact limit remains 100 MiB.

Job attachments belong to a database dataset, not just a job number. If database and files come from different datasets, normal job-attachment access is blocked. Files are kept; user documents and explicit recovery downloads/copies to Documents remain available. Restore matching database/file backups in either order to recover normal access. Add missing cannot merge different populated datasets.

Same-dataset folders without a current job remain recoverable, and their numbers are reserved against future job creation. Interrupted coordinated restores block access until [offline recovery](agent-guide.md#file-storage-and-recovery-commands) completes. Do not delete recovery markers or change dataset IDs.

New archives normally live under `data/backups/database/` and `data/backups/files/`, with actual paths shown in Diagnostics. Supported older adjacent backup folders remain readable.

## Extensions

Enable the master switch in **Settings → Extensions** to show navigation. Install trusted packages using the [extension guide](extension-guide.md); extensions execute code with Saturday's access. Interview Practice is the included starter, with a question bank, saved answers, and drafts saved only through **Save answer**.

The Extensions directory provides open, enable/disable, independent backup/restore, and confirmed removal. Disable preserves data. Removal disables the extension and requires stopping Saturday/MCP and completing the displayed uninstall command. The master switch preserves individual choices. Back up each extension separately; core database/file backups exclude its database.

## LAN access

1. On the computer running Saturday, open the **Open Saturday** desktop shortcut and go to **Settings → LAN access**.
2. Choose **Allow LAN access**, read the warning, then confirm. Cancel leaves the preference unchanged. Password protection is optional and configured separately.
3. Choose **Restart now** or **Later**. Settings shows the saved startup preference, running mode, and **Restart required** while they differ. Later applies the preference at the next restart or launch of a stopped server. Opening an already-running instance does not restart it.
4. Once LAN access is running, connect your phone to the same trusted network and open a displayed **Phone address** in its browser. Sign in if password login is enabled. Jobs, documents, uploads/downloads, and both logout actions work from the phone.
5. Choose **Disable LAN access** on the server computer to save local-only mode, then restart now or later. Phone access continues until that restart completes. Disabling LAN does not disable password protection.

Use the address matching the server computer’s Wi-Fi/Ethernet interface. Multiple addresses may appear; VPN/virtual interfaces are labelled as candidates rather than confirmed Wi-Fi addresses. Addresses and the actual port can change: reload Settings to refresh, or reopen the desktop shortcut after a failed reconnect. Copy the address, or select its text manually if clipboard access is unavailable.

Keep the server computer awake. If the phone cannot connect, check that both devices use the intended network, that guest Wi-Fi/client isolation permits device-to-device traffic, and that the computer’s firewall permits Saturday. Saturday does not alter OS firewall/router settings or configure public internet access. LAN mode listens on all IPv4 interfaces, so any reachable device may connect. HTTP does not encrypt passwords, sessions, or career data. Without password protection, reachable devices can read/edit the workspace.

LAN/password preferences, installation/server/start-at-login controls, and opening host folders require the server computer’s local browser opened by the desktop shortcut. They remain unavailable from the phone even when password protection is off. Password-protected restarts sign all browsers out. Local stdio MCP remains independent; enabling LAN does not publish an MCP endpoint.

## Password login

Open Saturday with its desktop shortcut, then go to **Settings → Password login**. Protection is optional and off by default. Choose **Enable password login**, enter and confirm a password, and save. Any non-empty password is accepted, with no minimum length or required character mix. The current browser stays signed in; other browsers must enter the same password. No username or online account is needed. Password login applies to local and LAN browsers; it does not enable LAN access by itself.

**Sign out after inactivity (hours)** accepts 0.25–720 hours, including fractions such as 0.5 for 30 minutes. The default is 1 hour. Navigation, actions, scrolling, and typing keep the session active; passive reading without interaction eventually counts as inactivity. Background polling does not keep you signed in. Without JavaScript, only navigation and form requests count. Each browser session has its own timer; tabs sharing a session share its activity.

Select **No expiration** to disable inactivity logout. Saving either preference takes effect without restarting. Reducing a timeout can sign out other idle browsers; increasing it cannot revive expired sessions. Switching from No expiration to hours gives live sessions a fresh inactivity period. Closing the browser may end a session. Restarting Saturday, changing the password, or logging out ends it even with No expiration selected. Up to 100 sessions are retained; a successful new login at that limit signs out the oldest.

**Log out** and **Log out all devices** are together in Settings. Logout-all confirms before revoking every session, including the current browser. Other browsers must sign in on their next request. When signed in on the host computer, **Change password** and **Disable password login** both require the current password. Disabling also asks for confirmation and takes effect immediately without restarting. Changing the password signs out other sessions; disabling revokes all sessions. Forgotten-password recovery requires the server computer's command line. Saturday's MCP tools cannot manage authentication. Sign-in changes wait while installation/update work is queued or running.

If a session expires during editing, Saturday keeps enhanced-form inputs in the original tab and offers **Sign in in another tab**. After signing in, return and retry the action yourself; writes are never automatically replayed. Previously downloaded/copied data cannot be recalled by logout.

With password protection on, a server restart returns you to Sign in. Installation operations continue after the UI shuts down, but their separate live progress gateway is disabled. Reopen Saturday later, sign in, and inspect the result in Settings. Your trusted local stdio MCP connection remains independent of browser login.

If you forget the password, follow [Locked out of Saturday](installation-guide.md#locked-out-of-saturday). Open a terminal on the computer hosting Saturday and run its local disable command. An authorized AI agent can help only if it has command-line access to that computer; Saturday MCP access alone cannot recover or disable the password. Recovery stops the UI, turns network access off, and preserves records, documents, and backups. Reopen the desktop shortcut afterward and optionally enable a new password. The guide also covers missing/corrupt access settings.

## Installation and server settings

Use the desktop shortcut to reopen Saturday. Settings provides server controls, optional startup at login, and manual update/repair/uninstall. See the installation guide for:

- [Installation and requirements](installation-guide.md#requirements)
- [Open, stop, and restart](installation-guide.md#open-stop-and-restart)
- [Start at login](installation-guide.md#start-at-login)
- [Updates](installation-guide.md#updates), [repair](installation-guide.md#repair), and [uninstall](installation-guide.md#uninstall)

Uninstall keeps data by default. Back up and review the exact directories before choosing the separate data-deletion option.
