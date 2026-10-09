# Using Saturday

Saturday keeps your job search in a SQLite file on your computer. You can track jobs entirely through the web app; connecting an assistant is optional.

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

Select a progress count to see the jobs behind it. **Recently updated** links to jobs with recent activity. **Coming up** appears when active jobs have future dated updates.

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

## Data and assistant connection

**Settings** displays the database file's location. The default is `data/saturday.db` in the repository. Use the Backup and restore section to save or recover your data, as described below.

To connect a local assistant, build Saturday and follow **Settings → Connect an assistant**. Its generated configuration uses paths for your installation and the same database file as the web app. After reconnecting the client, ask it to list your jobs to confirm access. The assistant can list and read jobs, create a job, and add a dated update. The assistant can also edit job details, schedule follow-ups, and set an assessment score with an explanation. Job update corrections/removals, dismissal, and reopening remain in the web app. Network tools can find/edit people, manage job relationships/follow-ups, and read/add/correct/delete scoped interactions with explicit confirmation for deletion. The [assistant guide](assistant-guide.md) has the full connection steps and troubleshooting. An assistant installing Saturday for you can follow the [agent setup guide](agent-guide.md).

Jobs and people show their record numbers (such as **#123**) in lists, headings and relationship pickers. Use these when asking an assistant to read or update a particular job or person. Numbers are separate for Jobs and Network; include which record you mean.

Under **Settings → Local database → Diagnostics**, expand the disclosure to copy your development build, actual database/manifest versions, and storage/backup/recovery paths when reporting a problem.

## Backup and restore

In **Settings → Backup and restore**, click **Back up now** to save your database and files together. Choose **Database only** for a smaller snapshot of jobs, people, follow-ups, relationships and history. **Back up files only** saves documents and attachments separately. Saved backups appear in one history; a complete set has separate **Download database** (`.sqlite`) and **Download files** (`.zip`) links. A backup completes only when both artifacts of a selected complete set are published. Files are not encrypted and contain private career information; copy important backups to another device or location if you need protection against loss of this computer.

To restore, select a saved backup and choose **Preview restore**. A complete set previews both records and files; database-only restore keeps existing files; files-only restore replaces files. You can also upload a SQLite backup (up to 100 MiB) under **Import a database backup**; an uploaded file takes priority. Choose **Preview restore**, review current and incoming counts, then confirm the appropriate restore action. Restoring replaces all current jobs, people, job relationships and both histories rather than merging them. It preserves IDs, dates, history, and assistant attribution and keeps a recovery backup of the records it replaces. No restart is needed. Refresh other open tabs to see restored data.

Previews expire after ten minutes and become invalid if records change. Prepare again if this happens. A restore ID can be attempted only once, including failed attempts. If a response is interrupted, inspect your records and saved recovery backups before preparing another restore. A corrupt active database needs offline recovery; the in-app workflow requires a healthy installation. Backups from newer app schemas are rejected until you upgrade Saturday. Only the numeric-ID baseline is supported. Older UUID-era databases and earlier file formats are rejected without conversion or deletion. Database backups preserve all job/Network data, dataset identity and allocation counters; rolling back within the same dataset does not reuse newer IDs.

### Automatic backups

Enable **Automatic backups**, set **Back up every (hours)** (1–168) and **Automatic backups to keep** (1–100), then save. Choose **Database and files** (the default for new installations) or **Database only**. Defaults are off, every 24 hours, and keep 10 backup sets. Enabling makes the first backup due immediately; the worker checks once per minute. View the last successful backup, next due time, and errors in Settings; refresh to see changes.

Automatic backups run only while the web app runs through `npm run start` or `npm run dev` and your computer is awake. After downtime, the app makes one catch-up backup. A failed attempt retries after at least five minutes. Running MCP alone, `npm run preview`, or the built web entry directly does not start this worker.

After a successful automatic backup, older automatic sets beyond the configured count are deleted, including both archives and their pair record when applicable. Manual, imported, recovery backups, and files used by pending restores are preserved. Reducing the count applies after the next successful automatic backup. The count can temporarily be exceeded by protected files or cleanup errors. Each database archive is limited to 100 MiB; file ZIPs have no total-size cap. Retention counts sets, so it is not a disk quota.

Backup files and schedule settings live in `<database-path>.backups/`; temporary restore data lives in `<database-path>.restore/`. Restoring database records leaves your current schedule settings intact. There is no general deletion button in this version; manage retained manual/recovery files locally if needed, preserving copies you still need.

## Documents and Master CV

Documents holds your reusable files. Click **Upload**, then select a file (up to 25 MiB) to upload immediately or choose **New document** to create Markdown. Search filenames and use a row's Edit action. Its three-dot menu contains Preview, Download, Rename, Duplicate and permanent Delete. Duplicate creates `name copy.ext`, then numbered copies. There is no Trash or automatic version history.

Markdown uses a basic visual editor with a source fallback. Files with unsupported formatting stay in source mode to preserve it. HTML and TXT use source text editors. Text editing is limited to 1 MiB of valid UTF-8. PDFs have browser preview/download; other formats download only. Explicit Save persists your edits. If an assistant edits the same file, reload/reconcile or save your draft as a separate copy rather than overwriting silently.

Click **Select Master CV** (next to **New document**), choose an existing user Markdown file, then **Use selected file**. The file shows a **Master CV** label; its name, location and contents stay the same. Open the button again to pick another file, or choose **No Master CV** and **Clear Master CV** to unselect it and keep the file. Deleting the selected file also clears Master CV. Create/upload your Markdown CV normally before selecting it; PDF/Word conversion is not included.

Each job has its own Documents section with a **Manage documents** button. Upload/create there or use **Copy to this job** to make an independent copy of a user document. Editing a job copy never edits its source or Master CV. The user Documents page does not browse job folders.

For resumes, your assistant can create a reusable HTML template and a job-tailored HTML file. Review/edit the HTML source, save, then choose **Generate PDF** on its preview. Saturday saves a new PDF beside the HTML automatically. Existing PDFs are preserved with numbered filenames; editing HTML later does not update earlier PDFs. The renderer blocks scripts and external resources, so use self-contained print CSS and installed fonts.

## File backups

Settings uses the single automatic backup schedule above. Existing database-only schedules retain their contents until changed. A previously configured independent file schedule continues for compatibility; Settings shows it under **Advanced file recovery**, and saving the main schedule disables that separate schedule. Independent file schedule APIs remain available through CLI/MCP.

**Back up files only** saves a ZIP containing the file manifest, user documents and job attachments. There is no total archive-size cap; sufficient disk space is required for staging and recovery. Download archives from Saved backups; import and recover them under **Advanced file recovery**. Preview **Add missing files** or **Replace entire file collection** before restoring; conflicts stop additive restore. A complete recovery archive is kept before changes.

Database backups and file backups are separate. Database restore leaves files in place. Job attachments belong to a database dataset, so matching job numbers alone do not establish ownership. If datasets differ, Settings explains the mismatch and normal job-file access is blocked; user documents and explicit recovery downloads/copies to Documents remain available. Restore matching database/file backups in either order. Unmatched same-dataset job folders remain available for explicit recovery, and their numbers are reserved against future job creation. Add missing cannot merge different populated datasets; use a reviewed Replace restore to install another file collection. **Back up now** with Database and files captures a coordinated pair; selecting that set in Saved backup previews restoring both. Interrupted coordinated restores block access until offline recovery completes. Backups are private and unencrypted; keep copies on another disk if you need protection from disk failure.
