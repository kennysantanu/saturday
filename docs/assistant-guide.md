# Connect your assistant

Saturday can share your job records with a personal AI assistant through a local connection called MCP (Model Context Protocol). Once connected, you can ask your assistant to look up a job, add a new one, or record progress. Everything it does appears in Saturday for you to review.

This is optional. The web app works fully without an assistant, an AI account, or an API key. If an assistant is doing the installation for you, give it the [agent setup guide](agent-guide.md) instead.

## Before you start

- Saturday is installed, built, and migrated. See [Install and start](../README.md#install-and-start).
- You use an assistant app on this computer that supports local MCP servers (for example, a desktop client). Check its documentation for where MCP servers are configured.

You do not need to keep Saturday's web server running for the assistant to work. The assistant's app starts Saturday's MCP process on its own when it connects. If the web app is open at the same time, both use the same database file.

## Connect

1. Open Saturday and go to **Settings → Connect an assistant**.
2. Copy the **Local desktop configuration**. It looks like this, with the paths for your computer:

   ```json
   {
   	"mcpServers": {
   		"saturday": {
   			"command": "/path/to/node",
   			"args": ["/path/to/saturday/build/mcp/index.js"],
   			"env": { "SATURDAY_DB_PATH": "/path/to/saturday/data/saturday.db" }
   		}
   	}
   }
   ```

3. Add it to your assistant app's MCP server settings under the name `saturday`, then reconnect or restart the app.
4. Ask the assistant to list your jobs in Saturday. If it returns the jobs you see in the browser, the connection works.

If **Settings** says the MCP entry point is missing, run `npm run build` and reload the page.

## What your assistant can do

| Tool             | What it does                                             | Changes data |
| ---------------- | -------------------------------------------------------- | ------------ |
| `list_jobs`      | Finds jobs by title or company (up to 50 per search)     | No           |
| `get_job`        | Reads one job with its notes and dated update history    | No           |
| `create_job`     | Adds a job with a title, company, and optional details   | Yes          |
| `add_job_update` | Records a dated progress step or note on an existing job | Yes          |

Records created this way are labeled **Added by assistant**. Editing or removing updates, editing jobs, dismissing jobs, and reopening jobs stay in the web app. Your assistant app may ask you to approve changes before it makes them.

Example requests:

- "List my active jobs in Saturday."
- "Add a Product Manager job at Acme to Saturday. Here is the posting: ..."
- "Record that I had a prescreen with Acme yesterday."

Refresh the browser to see changes an assistant made while the page was open.

## Privacy

Saturday stores your data on your computer and does not collect or send it anywhere. When you use an assistant, what it reads from Saturday is handled under that assistant provider's own privacy terms. Review those terms before sharing sensitive information. The configuration contains paths on your computer, so keep it private.

## Troubleshooting

- **The assistant cannot find Saturday.** Check that the configuration was saved under the name `saturday` and that you reconnected or restarted the assistant app.
- **It stopped working after moving the Saturday folder or upgrading Node.js.** The configuration stores absolute paths. Copy a fresh configuration from **Settings**.
- **Jobs from the assistant do not match the browser.** Both must use the same database. Compare the database path in the configuration with the one shown in **Settings**, and make sure `SATURDAY_DB_PATH` is set the same way everywhere.
- **The assistant reports a missing file.** Run `npm run build`.
