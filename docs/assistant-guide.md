# Connect your assistant

Saturday can share your job records with a personal AI assistant through a local connection called MCP (Model Context Protocol). Once connected, you can ask your assistant to look up a job, add a new one, or record progress. Record changes appear in Saturday after you refresh the page.

This is optional. The web app works fully without an assistant, an AI account, or an API key. If an assistant is doing the installation for you, give it the [agent setup guide](agent-guide.md) instead.

## Before you start

- Saturday is installed, built, and migrated. See [installation guide](installation-guide.md).
- You use an assistant app on this computer that supports local MCP servers (for example, a desktop client). Check its documentation for where MCP servers are configured.

You do not need to keep Saturday's web server running for the assistant to work. The assistant's app starts Saturday's MCP process on its own when it connects. If the web app is open at the same time, both use the same database file.

## Connect

1. Open Saturday and go to **Settings → Connect an assistant**.
2. Copy the **Local desktop configuration**. Use the generated values for your computer, including the optional PDF cache. The structure is:

```json
{
	"mcpServers": {
		"saturday": {
			"command": "/path/to/node",
			"args": ["/path/to/saturday/build/mcp/index.js"],
			"env": {
				"SATURDAY_INSTALLATION_PATH": "/path/to/data/installation.json",
				"SATURDAY_PROJECT_ROOT": "/path/to/saturday",
				"SATURDAY_DB_PATH": "/path/to/data/saturday.db",
				"SATURDAY_FILES_PATH": "/path/to/data/files",
				"SATURDAY_EXTENSION_STATE_PATH": "/path/to/data/extensions",
				"SATURDAY_EXTENSIONS_PATH": "/path/to/extension-packages"
			}
		}
	}
}
```

3. Add it to your assistant app's MCP server settings under the name `saturday`, then reconnect or restart the app.
4. Ask the assistant to call `get_saturday_info` and compare installation, dataset and build identities shown in Settings. This works even with no jobs. Then read a known numbered job when available. Copying configuration alone does not verify a connection.

If **Settings** says the MCP entry point is missing, follow the [repair instructions](installation-guide.md#repair) or rebuild a source checkout, then reload.

## Client configuration formats

Settings supplies JSON under `mcpServers.saturday` and a **ChatGPT / Codex local configuration (TOML)** snippet. Use the format supported by your actual client and execution mode. Saturday exposes local stdio, not a remote MCP URL. A hosted-only chat cannot launch it, and managed policies may disallow local servers.

Generate either format without opening the UI:

```sh
npm run assistant -- config --format toml
npm run assistant -- config --format json
```

For managed installs, use the descriptor's absolute Node path and `<code_root>/scripts/assistant.mjs` with `--installation <absolute-descriptor>`. Generation changes no client files. Follow the client's own configuration controls; preserve unrelated settings and avoid duplicate Saturday entries/tables.

For an authorized change to a caller-selected JSON file, Saturday provides:

```sh
npm run assistant -- connect --config "/absolute/client/config.json" --confirm
npm run assistant -- disconnect --config "/absolute/client/config.json" --confirm
```

The helper changes only Saturday's entry and retains a private recovery copy of an existing file. Invalid JSON, linked paths, concurrent operations, and conflicting entries fail without replacement. A reviewed conflict requires `--replace --confirm`; disconnect refuses a changed or different-installation entry. The helper does not locate arbitrary client files or edit TOML. Use supported client controls or a reviewed manual TOML merge.

## Verify the connection

Settings shows a **pending** reminder for real-client verification; it does not track or infer client success. Ask the client to call `get_saturday_info` and compare installation/dataset/build identities. Then read a known job when available. Repeat after reconnecting following an update. Do not share private paths/configuration publicly. A protocol smoke result proves Saturday's stdio response, not the real client's access.

For candidate testing on disposable data, see the [agent verification checklist](agent-guide.md#verify-installation-and-mcp).

## Using your assistant

Discover stages with `list_workflow_stages` before changing placement. Use `change_job_stage` to change the current stage and record a milestone; `add_job_update` records history only. Never infer current placement from the newest history entry. Read current placement after an uncertain response before retrying a write.

Ask your assistant to find a job, record progress, manage a follow-up, link a person, or tailor a document from your Profile selections. For example:

- “List my active jobs in Saturday.”
- “Record a Screening milestone for job #123 yesterday without changing its current stage.”
- “Read my Master CV and resume template, then draft a resume for job #123.”

Include whether a number refers to a job or person. Refresh the browser after assistant writes. MCP can correct history and change stages using the same safeguards as the UI. Closing or reopening uses a discovered closed or open destination; stage names have no reserved behavior. Permanent history deletion requires explicit authorization and confirmation. Assistant scores are read-only in the web app. Backups and restores are also available, with preview and authorization before replacement.

The [MCP reference](mcp-reference.md) documents all core tools, inputs, filters, Profile designations, IDs, and recovery safeguards. The [user guide](user-guide.md) explains the matching UI workflows.

## Privacy

Career data is stored locally. Records read by an assistant are handled under that provider's privacy terms; trusted extensions run with Saturday's access. Installation and update commands download software. Configuration and recovery copies can contain private paths or client settings; keep them private.

## Troubleshooting

- **The assistant cannot find Saturday.** Check that the configuration was saved under the name `saturday` and that you reconnected or restarted the assistant app.
- **It stopped working after moving the Saturday folder or upgrading Node.js.** The configuration stores absolute paths. Copy a fresh configuration from **Settings**.
- **Jobs from the assistant do not match the browser.** Compare `get_saturday_info` identities with Settings and use its generated configuration. Web, CLI, and MCP must share the installation descriptor; conflicting storage overrides are rejected.
- **The assistant reports a missing build.** Source users can run `npm run build`; managed installs can use Repair installation. Missing initialized storage requires recovery, not a new empty store.

## UI server independence and updates

The assistant client owns its MCP process, so it can work while Saturday's UI is stopped. A UI-only restart does not require reconnecting MCP. For code updates, disconnect MCP before publication, reconnect after completion, and repeat the identity/read verification. Copy fresh configuration if runtime paths changed.

Follow the [installation guide](installation-guide.md#updates) for update/repair/uninstall commands. Uninstall retains client configuration; remove only Saturday's authorized entry separately, preferably before removing its runtime. See [client configuration formats](#client-configuration-formats) for the JSON helper and TOML handling.
