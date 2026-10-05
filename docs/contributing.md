# Contributing

## Get set up

You need Node.js 22.13 or newer and npm 10 or newer. Run `npm ci`, then `npm run migrate` to create the database and `npm run dev` to start the development server on loopback.

## Commands

| Command             | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `npm run setup`     | Install dependencies, build, and migrate (used for first use) |
| `npm run dev`       | Start the development server on loopback                      |
| `npm run check`     | Check Svelte and TypeScript/JavaScript                        |
| `npm run build`     | Build the production web app and MCP entry point              |
| `npm run build:mcp` | Rebuild the MCP entry point at `build/mcp/index.js`           |
| `npm run migrate`   | Create the database and apply pending migrations              |
| `npm run start`     | Start the production web server                               |
| `npm run status`    | Check the web server on the expected port                     |
| `npm run lint`      | Check formatting with Prettier                                |
| `npm run format`    | Format project files                                          |

Additional commands: `npm run backup` creates a managed snapshot, `npm run restore -- <file> --inspect` prepares a restore, and `npm test` builds MCP and runs job-detail, migration, backup/restore, and MCP integration tests using temporary databases. `npm run test:web` builds the app and tests production job forms, Settings actions, and worker supervision on localhost. See the [agent guide](agent-guide.md#backup-and-recovery-commands) for confirmation and scheduling commands.

## Project layout

- `src/routes` — app pages
- `src/lib/server` — database, immutable migrations, job logic, backup/restore services, validation, and the MCP server
- `src/lib/components` — shared interface components
- `scripts` — setup/run commands, backup/restore CLI, and supervised backup worker
- `tests` — temporary-database service, process, CLI, and MCP integration tests
- `docs` — user and contributor documentation
- `plans` — product, architecture, and roadmap planning

## Conventions

- Follow the [design guide](design-guide.md) for interface, responsive layout, and accessibility.
- Product direction and architecture are in [plans/PRODUCT.md](../plans/PRODUCT.md), [plans/ARCHITECTURE.md](../plans/ARCHITECTURE.md), and [plans/ROADMAP.md](../plans/ROADMAP.md).
- Run `npm run format` and `npm run check` before submitting changes.

## Screenshots in documentation

Store images in `docs/images/` and reference them with relative paths, such as `![Dashboard](docs/images/dashboard.png)` from the README. Use PNG, keep them reasonably small, and describe them in the alt text.

## Optional job details and schema upgrades

Migration 2 adds nullable context, deadline/follow-up, and assistant assessment fields, plus `is_starred` defaulting to false. Migration 1 remains unchanged. The complete registry of original and added stored fields lives in `src/lib/job-fields.js`. It defines names, UI/MCP mappings, types, limits, options, access (`user`, `assistant`, `system`), dependencies, and introduction versions. Validation, service writes, read adapters, MCP inputs, and backup column lists derive from it. Add/Edit form fields stay inline with the other page fields. Manual create/edit ignores assessment inputs; only MCP create and the dedicated assessment service write score/comment. Partial edits preserve omitted fields. Clearing a follow-up date clears its comment and never adds history.

Backup validation uses an exact schema signature for each supported migration version. Restore copies validated historical rows into a fresh database at their original schema version, migrates that staging copy forward, and restores normalized current rows. Original backups are never migrated in place. Include all new fields in dataset fingerprints so any detail or assessment change invalidates a prepared restore. When adding another migration, extend historical compatibility and test upgrades/restores.

When adding a stored job field, add it to `jobFields` with `since` set to its migration version, write an explicit migration, and add inline form controls as needed. System fields are generated/maintained by services; assistant fields are excluded from manual input. `info` controls the Job information card, and `list` controls MCP list summaries. Keep existing names, mappings, and historical `since` values stable. Removing a field from the UI/input does not mean deleting its historical definition or data; handle permanent column removal and historical backup compatibility in an explicit migration. Computed status and history remain service behavior, not jobs columns.
