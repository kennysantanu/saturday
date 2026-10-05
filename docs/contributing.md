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

Additional commands: `npm run backup` creates a managed snapshot, `npm run restore -- <file> --inspect` prepares a restore, and `npm test` builds MCP and runs backup/restore integration tests using temporary databases. `npm run test:web` builds the app and tests production Settings actions and worker supervision on localhost. See the [agent guide](agent-guide.md#backup-and-recovery-commands) for confirmation and scheduling commands.

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
