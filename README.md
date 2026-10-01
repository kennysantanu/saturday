# Saturday — Career Center

Saturday is a career center for managing your job search, career pivot, or next step up. It keeps your opportunities, notes, and progress together in one place on your own computer.

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

- **Keep each opportunity together.** Save a job title and company, then add a posting link, description, or your own notes when you have them.
- **Remember what happened.** Record applications, prescreens, interviews, offers, outcomes, and general notes in a dated history. You can correct a mistaken update later.
- **See where things stand.** The Dashboard shows active jobs, recent activity, upcoming dated updates, and how many jobs reached each step. The Jobs list starts with active jobs; **All** also shows dismissed, accepted, and rejected jobs.
- **Focus on the jobs you still want.** Dismiss an opportunity you are no longer pursuing and reopen it if things change.
- **Work with your assistant.** Give an assistant on your computer access to your job records so it can find an opportunity, add one, or record progress when you ask. Its changes appear in the app for you to review.

To get started in the app, choose **Add job**. Only the job title and company are required. Open that job later to add an update or review its history. The [user guide](docs/user-guide.md) explains statuses, counts, and corrections.

## Install and start

Saturday runs from source with Node.js; a packaged installer is not available yet. You need Node.js 22.13 or newer and npm 10 or newer. Check with `node -v` and `npm -v`. Nothing else is required, such as a separate database. Commands below use macOS and Linux shell syntax.

```sh
git clone https://github.com/kennysantanu/saturday.git
cd saturday
npm run setup
npm run start
```

`npm run setup` installs dependencies, builds the app, and creates the database. Then open <http://127.0.0.1:3000>. Saturday listens only on this computer. Keep the terminal running while you use the app; press Ctrl-C to stop it.

If port 3000 is in use:

```sh
PORT=3100 npm run start    # then open http://127.0.0.1:3100
PORT=3100 npm run status   # check that it is answering
```

In PowerShell, set the port first with `$env:PORT = 3100`. `npm run status` checks port 3000 unless `PORT` is set. Running Saturday in the background or at login is not covered yet.

If you want an assistant to install Saturday into a folder you choose, give it this repository URL and the [agent setup guide](docs/agent-guide.md).

## Updating

Stop the app, then run:

```sh
git pull
npm run setup
npm run start
```

`npm run setup` is safe to repeat. It applies any pending database changes without removing your jobs.

## Your data and privacy

Saturday saves your jobs in `data/saturday.db` inside the cloned repository. **Settings** shows the file's full path. To choose another location, set `SATURDAY_DB_PATH` before setup and startup. An absolute path is used as given; a relative path is resolved from the repository folder. The `data/` folder is excluded from Git.

Your data stays on your computer, and Saturday does not collect anything. If you connect an assistant, the privacy of what it reads depends on that assistant's provider, so review their terms before sharing sensitive details.

Saturday does not have a backup or restore feature yet; it is planned. Until then, you can stop the app and copy the database file somewhere safe.

## Connect your assistant (optional)

Saturday includes a local MCP connection so an assistant can use the same job records you see in the browser. In short: open **Settings → Connect an assistant**, copy the configuration into your assistant app's MCP settings, reconnect, and ask it to list your jobs. The assistant's app starts the connection itself; you do not need to run another server. The web app and the assistant share one database, so changes from either appear in both. Refresh the browser to see an assistant's latest changes.

An assistant can find and read jobs, create a job, and add a dated update. Its records are labeled **Added by assistant**. Editing or removing updates, dismissing jobs, and reopening jobs remain in the browser. The web app does not need an AI account or API key. Keep the generated configuration private because it contains paths on your computer.

See [Connect your assistant](docs/assistant-guide.md) for the full steps, an example configuration, and troubleshooting.

## Troubleshooting

- **The page does not load, or the port is in use.** Run `npm run status`, or start on another port as shown above.
- **A "database" or "table not found" error.** Run `npm run migrate`.
- **Node version error.** Check `node -v`; Saturday needs 22.13 or newer.
- **The assistant cannot connect, or stopped after you moved the folder.** The configuration stores absolute paths. Run `npm run build`, then copy a fresh configuration from **Settings**. See the [assistant guide](docs/assistant-guide.md#troubleshooting).

## Where Saturday is headed

Saturday will grow beyond job tracking into a fuller career center. Planned features include tracking your professional network, storing resumes and other career documents, managing follow-ups, backup and restore, and more ways to support your career progression. See the [roadmap](plans/ROADMAP.md) for details.

These features are not available yet. Saturday does not currently apply to jobs for you, import postings or PDFs, or sync between computers.

## Contributing

Development commands, project layout, and conventions are in [docs/contributing.md](docs/contributing.md). The [documentation index](docs/README.md) lists all guides.

## License

Saturday is released under the [MIT License](LICENSE).
