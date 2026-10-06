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

**Dismiss job** means you stopped pursuing it. **Rejected by employer** means the employer declined. Dismissed jobs can be reopened from their detail page. Accepted and rejected jobs become inactive; if that outcome was entered by mistake, edit or remove the outcome update to correct it. Inactive jobs can still receive notes, but need to be active before receiving another milestone.

To fix an ordinary update, use its **Edit** action. To remove one, choose **Remove update** and confirm. The app recalculates the displayed status and Dashboard counts. Dismiss and Reopen entries are reversed through the corresponding job action. Removed updates are not kept in an undo history.

## Read the Dashboard

**Active now** counts jobs still being pursued. **Progress so far** counts distinct jobs that ever reached each step or outcome, including inactive jobs. A job that reached Applied and Interview 1 appears in both counts; repeating Interview 1 still counts that job only once for that step. Dismissing and later reopening a job does not erase its earlier progress or its historical Dismissed count.

Select a progress count to see the jobs behind it. **Recently updated** links to jobs with recent activity. **Coming up** appears when active jobs have future dated updates.

## Follow-ups, starred jobs, and assessments

Use **Star** on a job to mark it for attention; starred jobs show a star in lists. In the **Follow-up** card, schedule one date with an optional comment, reschedule it, or clear it. This does not add history or change the job status. Dashboard shows active-job follow-ups, earliest first, including overdue dates, alongside upcoming application deadlines. Inactive jobs keep their follow-up but hide it from Dashboard until reopened. Dates use your local calendar.

**Assistant assessment** displays a numeric score and plain-text explanation managed through MCP. You can read both in the UI but cannot edit them there. There is no fixed scoring scale; ask your assistant to use a consistent scale and explain its criteria. An empty score means unscored; zero is a valid score.

## Data and assistant connection

**Settings** displays the database file's location. The default is `data/saturday.db` in the repository. Use the Backup and restore section to save or recover your data, as described below.

To connect a local assistant, build Saturday and follow **Settings → Connect an assistant**. Its generated configuration uses paths for your installation and the same database file as the web app. After reconnecting the client, ask it to list your jobs to confirm access. The assistant can list and read jobs, create a job, and add a dated update. The assistant can also edit job details, schedule follow-ups, and set an assessment score with an explanation. Update corrections and removals, dismissal, and reopening remain in the web app. The [assistant guide](assistant-guide.md) has the full connection steps and troubleshooting. An assistant installing Saturday for you can follow the [agent setup guide](agent-guide.md).

## Backup and restore

In **Settings → Backup and restore**, select **Download backup** to save one portable `.sqlite` file containing your jobs and history. The app keeps a local managed copy too. Files are not encrypted and contain private career information; copy important backups to another device or location if you need protection against loss of this computer.

To restore, upload a SQLite backup (up to 100 MiB), or select a saved backup. An uploaded file takes priority. Choose **Preview restore**, review current and incoming counts, then **Restore this backup** and confirm replacement. Restoring replaces all current jobs/updates rather than merging them. It preserves IDs, dates, history, and assistant attribution and keeps a recovery backup of the records it replaces. No restart is needed. Refresh other open tabs to see restored data.

Previews expire after ten minutes and become invalid if records change. Prepare again if this happens. A restore ID can be attempted only once, including failed attempts. If a response is interrupted, inspect your records and saved recovery backups before preparing another restore. A corrupt active database needs offline recovery; the in-app workflow requires a healthy installation. Backups from newer app schemas are rejected until you upgrade Saturday. Backups from the original schema remain restorable; fields added later start empty (and stars start off). Current backups include all job details and assessments.

### Automatic backups

Enable **Automatic backups**, set **Every N hours** (1–168), and **Keep N automatic backups** (1–100), then save. Defaults are off, every 24 hours, and keep 10. Enabling makes the first backup due immediately; the worker checks once per minute. View the last successful backup, next due time, and errors in Settings; refresh to see changes.

Automatic backups run only while the web app runs through `npm run start` or `npm run dev` and your computer is awake. After downtime, the app makes one catch-up backup. A failed attempt retries after at least five minutes. Running MCP alone, `npm run preview`, or the built web entry directly does not start this worker.

After a successful automatic backup, older automatic files beyond the configured count are deleted. Manual, imported, recovery backups, and files used by pending restores are preserved. Reducing the count applies after the next successful automatic backup. The count can temporarily be exceeded by protected files or cleanup errors. Ten automatic backups may occupy up to about 1 GiB under the 100 MiB file limit, plus other backups and staging; this is not a total disk quota.

Backup files and schedule settings live in `<database-path>.backups/`; temporary restore data lives in `<database-path>.restore/`. Restoring job records leaves your current schedule settings intact. There is no general deletion button in this version; manage retained manual/recovery files locally if needed, preserving copies you still need.
