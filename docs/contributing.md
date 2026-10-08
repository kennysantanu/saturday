# Contributing

## Get set up

You need Node.js 22.13 or newer and npm 10 or newer. Run `npm ci`, then `npm run migrate` to create the database and `npm run dev` to start the development server on loopback.

## Development toward 0.1.0

Development is unversioned until the first `0.1.0` release. Leave package/lockfile versions unchanged; do not create numbered beta releases. Breaking APIs and storage changes may require an explicit development-data reset. Setup/startup must never silently reset data. Earlier development backups are not guaranteed compatible with later builds.

The intended first release covers Dashboard, Jobs, Network, Documents, Settings, local MCP and backup/recovery. Cloud hosting/storage, plugins, built-in AI and installers are later work. The initial changelog and formal release tag belong to the final `0.1.0` publication step. After that, released baselines are immutable and supported data changes use migrations independently of app version numbers.

### Build identity and storage contracts

Vite and the MCP builder use `scripts/build-info.mjs` to capture the same Git-based development identity: `dev.<12-character-commit>` with `.dirty` when tracked or untracked source changes exist. Dirty builds are not reproducible references; use a clean commit when sharing a build. Rebuild both artifacts with `npm run build` after source changes. A running dev server captures identity when Vite starts; restart it to refresh the identity.

No Git executable or repository is needed at production runtime. Source archives without Git build with the explicit `development` fallback; direct source CLI commands also have no captured build identity. MCP reports its build identifier in the initialization response. Web Settings responses expose it in `X-Saturday-Build` and their load data; visible Settings diagnostics follow in a later phase.

`src/lib/server/compatibility.js` owns current supported-storage declarations, using the existing migration list for the database version and a shared manifest version for initialization, validation and offline recovery. Exact migration/schema/manifest validators still apply; a version range alone does not establish compatibility. The same module reserves the upcoming numeric baseline identities (`saturday.database.numeric` and `saturday.files.numeric`, both version 1). They do not change or become accepted by the current stores until the numeric schema/file phases implement them. Dataset metadata and checks on every mutation are also later phases.

### Provisional support matrix

These are testing targets, not a beta support claim. Record actual release-candidate results before advertising support.

| Area                | Target / current verification boundary                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Installation        | Source checkout with npm; no installer                                                                                                |
| macOS Apple Silicon | Primary development target; complete clean-install, recovery and accessibility checks before release                                  |
| macOS Intel / Linux | Candidate targets; platform, Chrome/font and workflow verification pending                                                            |
| Windows             | Support decision pending native installation, path/process and PDF checks; shell examples alone do not establish support              |
| Runtime             | Node.js 22.13+ and npm 10+ required; test the chosen release Node versions explicitly, rather than assuming every newer version works |
| Browser             | Modern desktop browser; choose advertised browsers after keyboard, narrow-layout and PDF workflows pass                               |
| Assistant client    | Local stdio MCP; verify each advertised client's actual connection and workflows separately from protocol tests                       |

Run checks with temporary databases and file stores. Before a development update, stop web, MCP and worker processes and retain backups with the matching source/build if needed. Incompatible-format errors require a compatible build or an explicit scoped reset, never manually altered migration records. This Phase 1 foundation changes neither data nor schema; the existing UUID schema remains in use for now.

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

Additional commands: `npm run backup` creates a managed snapshot, `npm run restore -- <file> --inspect` prepares a restore, and `npm test` builds MCP and runs job-detail/search, migration, backup/restore, and MCP integration tests using temporary databases. `npm run test:web` builds the app and tests production job/Network forms and search, Settings actions, and worker supervision on localhost. See the [agent guide](agent-guide.md#backup-and-recovery-commands) for confirmation and scheduling commands.

## Project layout

- `src/routes` — app pages
- `src/lib/server` — database, immutable migrations, job logic, backup/restore services, validation, and the MCP server
- `src/lib/components` — shared interface components
- `scripts` — setup/run commands, backup/restore CLI, and supervised backup worker
- `tests` — temporary-database service, process, CLI, and MCP integration tests
- `docs` — user and contributor documentation

## Conventions

- Follow the [design guide](design-guide.md) for interface, responsive layout, and accessibility.
- Run `npm run format` and `npm run check` before submitting changes.
- Interface conventions are enforced by `tests/ui-conventions.test.mjs` (part of `npm test`). Use the shared
  components in `src/lib/components/app`; the [design guide](design-guide.md#building-a-new-page-or-feature) lists
  them and the checklist for finishing a change.

## Screenshots in documentation

Store images in `docs/images/` and reference them with relative paths, such as `![Dashboard](docs/images/dashboard.png)` from the README. Use PNG, keep them reasonably small, and describe them in the alt text.

## Optional job details and schema upgrades

Migration 2 adds nullable context, deadline/follow-up, and assistant assessment fields, plus `is_starred` defaulting to false. Migration 1 remains unchanged. The complete registry of original and added stored fields lives in `src/lib/job-fields.js`. It defines names, UI/MCP mappings, types, limits, options, access (`user`, `assistant`, `system`), dependencies, and introduction versions. Validation, service writes, read adapters, MCP inputs, and backup column lists derive from it. Add/Edit form fields stay inline with the other page fields. Manual create/edit ignores assessment inputs; only MCP create and the dedicated assessment service write score/comment. Partial edits preserve omitted fields. Clearing a follow-up date clears its comment and never adds history.

Backup validation uses an exact schema signature for each supported migration version. Restore copies validated historical rows into a fresh database at their original schema version, migrates that staging copy forward, and restores normalized current rows. Original backups are never migrated in place. Include all new fields in dataset fingerprints so any detail or assessment change invalidates a prepared restore. When adding another migration, extend historical compatibility and test upgrades/restores.

When adding a stored job field, add it to `jobFields` with `since` set to its migration version, write an explicit migration, and add inline form controls as needed. System fields are generated/maintained by services; assistant fields are excluded from manual input. `info` controls the Job information card, and `list` controls MCP list summaries. Keep existing names, mappings, and historical `since` values stable. Removing a field from the UI/input does not mean deleting its historical definition or data; handle permanent column removal and historical backup compatibility in an explicit migration. Computed status and history remain service behavior, not jobs columns.

## Jobs search and filters

`src/lib/job-search.js` owns browser-safe filter choices, defaults, URL encoding, and chips. Search schemas live in server validation; `searchJobs` applies bound SQL predicates and shared status rules within a read snapshot before counting/pagination. Candidate history is fetched in a batch. Jobs uses an inline GET form; MCP uses the same service with All as its default activity. Keep `listJobs` backward compatible for existing callers.

When adding a filter, update its validation, URL handling/chip behavior, inline control, service predicate, MCP documentation, and meaningful tests. Keep AND across categories, OR within categories, historical steps including inactive jobs, local calendar date boundaries, and stable sort tie-breakers. A query filter needs no migration unless it also introduces stored data. Tests must use temporary databases.

## Documents

`src/lib/server/files/` owns file scope/manifest services, journalled local publication, ZIP recovery and PDF generation. MCP tool definitions live together in `src/lib/server/mcp-server.js`. Files add no SQLite schema migration. `src/lib/file-types.js` owns the small format/action mapping; explicit page controls remain in Svelte. The UI shares file list/editor components between user and job scopes and follows the design guide's solid surfaces, existing dialogs, labeled controls and toast feedback.

Manifest version 1 is validated centrally. Keep future migrations pure/sequential and preserve historical validators; refuse newer versions. Use shared conflict tokens and storage services for every mutation. Never write file bytes or the manifest from a route/MCP handler directly. Copies/PDFs create independent IDs; designations refer to stable IDs. Journal recovery precedes normal operations. Coordinated restore holds the SQLite write gate before the file lock, with a persisted recovery session for cross-store failures.

Tests use temporary file roots and databases. `npm test` includes real Chrome PDF and process/journal/recovery/MCP checks; install Chrome first and permit sandboxed browser startup in CI. `npm run test:web` covers production document forms, scope downloads, streaming uploads/imports and existing job/backup flows. Visually review Documents at mobile/desktop widths, keyboard/dialog focus, light/dark and 200% zoom before release.

Optional extended checks: `node scripts/review-documents.mjs` runs Documents and Network browser workflows with disposable stores and screenshots in the OS temp directory. `node --max-old-space-size=128 --test tests/files.large.integration.mjs` checks a ZIP and expanded collection above 1 GiB; allow several GiB of temporary disk space. Neither command uses your application data.

## Network contracts

`src/lib/server/networks.js` owns people, due follow-ups, job relationships and optional dated interactions. Shared explicit schemas live in `validation.js`; tools stay in the central MCP server. Network route forms and the job Network section stay inline, reusing existing UI primitives; no additional UI components, field registry, dependencies or picker endpoints are needed.

Migration 3 appends `networks`, `job_networks` and `network_updates`; never edit migrations 1/2. Follow-up is independent of interactions. Link/unlink and interaction changes do not update parent detail timestamps or job status/history. Link notes own their timestamp and creation source. Use scoped IDs, bound literal contains queries, whitelisted sorts, a read snapshot for counts/pages, and batched link lookup for pickers. History uses calendar date then insertion order, rejects future dates on writes, and is optional.

Extend every backup table definition, deterministic ordering, field validation, hash, preview count and replacement path for new stored records. Historical backups reconstruct their original schema before staged migration; restore uses child-before-parent deletion and parent-before-child insertion. Both ordinary and coordinated recovery include Network. Tests cover >100 records, literal AND/OR filters, partial/null edits, retry-safe links, scoped history changes, old snapshots, stale previews, malformed data, real MCP and production HTTP/browser flows. Keep full accessibility/platform review as separate release work, not implied by compilation.
