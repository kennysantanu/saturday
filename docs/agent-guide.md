# Agent setup guide

Use this guide when a user asks you to install Saturday from its GitHub repository into a folder they chose for a ChatGPT Work project.

## Clone and start Saturday

1. In a terminal, check the required tools. Node.js must be 22.13 or newer and npm must be 10 or newer.

   ```sh
   node -v
   npm -v
   git --version
   ```

2. Set `SATURDAY_DEST` to the absolute path of the folder the user selected. Create it if needed.

   ```sh
   SATURDAY_DEST="/absolute/path/to/selected/folder"
   mkdir -p "$SATURDAY_DEST"
   ```

   If that folder is empty, clone into it:

   ```sh
   git clone https://github.com/kennysantanu/saturday.git "$SATURDAY_DEST"
   cd "$SATURDAY_DEST"
   ```

   If it already contains files, clone into a new `saturday` subfolder instead:

   ```sh
   git clone https://github.com/kennysantanu/saturday.git "$SATURDAY_DEST/saturday"
   cd "$SATURDAY_DEST/saturday"
   ```

   Use only the branch that matches the selected folder. Stop if cloning fails; do not overwrite an existing `saturday` subfolder.

3. From the cloned repository, install, build, and migrate. If the user chose a custom database file, set `SATURDAY_DB_PATH` before these commands and keep it set when starting the app.

   ```sh
   npm ci
   npm run build
   npm run migrate
   ```

   Running `npm run migrate` again is safe. The default database is `data/saturday.db` in this clone.

4. Check whether the app is already answering on port 3000:

   ```sh
   npm run status
   ```

   If it is Saturday, keep that process running and open <http://127.0.0.1:3000>. Otherwise, start the web server:

   ```sh
   npm run start
   ```

   Leave that terminal open. In another terminal, change to the cloned repository, run `npm run status`, and open <http://127.0.0.1:3000>. If port 3000 is occupied by another app, stop the failed start and use `PORT=3100 npm run start`, then check with `PORT=3100 npm run status` and open <http://127.0.0.1:3100>. Saturday binds to `127.0.0.1`.

5. Resolve the paths for this clone from its repository folder. If using a new terminal and a custom `SATURDAY_DB_PATH`, set the same value there first:

   ```sh
   pwd -P
   node -p 'process.execPath'
   printf 'MCP entry: %s/build/mcp/index.js\n' "$(pwd -P)"
   node --input-type=module -e "import { getDatabasePath } from './src/lib/server/database.js'; console.log(getDatabasePath())"
   ```

   The final command prints the absolute database path. `SATURDAY_DB_PATH`, when set, may be absolute or relative to the repository folder. The path shown in **Settings** must match this result.

## Connect the desktop assistant

1. Open Saturday's **Settings** page and copy **Local desktop configuration**. It uses the absolute Node, MCP entry, and database paths resolved above. If the database path differs, check that the web process and the path commands used the same `SATURDAY_DB_PATH` value.
2. Add that JSON as the local `saturday` MCP server in the ChatGPT Work desktop client, then reconnect the client.
3. Add a job in the web app, then ask the assistant to list the jobs in Saturday. Confirm that `list_jobs` returns that job's title and ID. This verifies that the desktop MCP process and the browser use the same database. Refresh Saturday after an assistant write to check that it appears there too.

The local desktop client starts the MCP process when it connects; it is not a second web server to start manually. Do not claim that MCP is connected until the client has called one of Saturday's tools. `list_jobs` and `get_job` read data; `create_job` and `add_job_update` write data.

## Report completion

Tell the user the local browser address, whether the app is answering, the database location shown in Settings, whether the desktop client has successfully called an MCP tool, and any remaining step that needs their action. The client may ask the user to approve MCP write calls.
