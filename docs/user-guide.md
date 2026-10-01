# Using Saturday

Saturday keeps your job search in a SQLite file on your computer. You can track jobs entirely through the web app; connecting an assistant is optional.

## Add and find jobs

1. Open **Dashboard** or **Jobs** and choose **Add job**.
2. Enter a **Job title** and **Company**. Under **More details**, you can add a posting link, paste the job description, and write your own notes.
3. Save the job to open its detail page. Use **Edit** there to correct its information later.

**Jobs → Active** shows jobs you are still pursuing. **All** also shows dismissed jobs and jobs made inactive by an accepted offer or employer rejection. Open a row to see its details and history. A new job can have no updates.

## Record progress and notes

On a job's detail page, choose **Add update** and enter the date. Select a progress step or outcome: Applied, Prescreen, Interview 1, Interview 2, Offer received, Accepted offer, or Rejected by employer. You may add a note for context. Select **Note** to record something without changing the job's progress; a Note requires text.

The date can describe something that happened or a confirmed future interview. Future dated updates appear under **Coming up** on the job and Dashboard. The job's **History** shows its dated updates, including entries added by a connected assistant. Refresh the browser to see changes an assistant made while the page was open.

**Dismiss job** means you stopped pursuing it. **Rejected by employer** means the employer declined. Dismissed jobs can be reopened from their detail page. Accepted and rejected jobs become inactive; if that outcome was entered by mistake, edit or remove the outcome update to correct it. Inactive jobs can still receive notes, but need to be active before receiving another milestone.

To fix an ordinary update, use its **Edit** action. To remove one, choose **Remove update** and confirm. The app recalculates the displayed status and Dashboard counts. Dismiss and Reopen entries are reversed through the corresponding job action. Removed updates are not kept in an undo history.

## Read the Dashboard

**Active now** counts jobs still being pursued. **Progress so far** counts distinct jobs that ever reached each step or outcome, including inactive jobs. A job that reached Applied and Interview 1 appears in both counts; repeating Interview 1 still counts that job only once for that step. Dismissing and later reopening a job does not erase its earlier progress or its historical Dismissed count.

Select a progress count to see the jobs behind it. **Recently updated** links to jobs with recent activity. **Coming up** appears when active jobs have future dated updates.

## Data and assistant connection

**Settings** displays the database file's location. The default is `data/saturday.db` in the repository. Saturday currently has no in-app backup or restore command. Stop the app before copying the database file for a backup.

To connect a local assistant, build Saturday and follow **Settings → Connect an assistant**. Its generated configuration uses paths for your installation and the same database file as the web app. After reconnecting the client, ask it to list your jobs to confirm access. The assistant can list and read jobs, create a job, and add a dated update. Job edits, update corrections and removals, dismissal, and reopening remain in the web app. The [assistant guide](assistant-guide.md) has the full connection steps and troubleshooting. An assistant installing Saturday for you can follow the [agent setup guide](agent-guide.md).
