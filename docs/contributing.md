# Contributing

## Get set up

You need Node.js 22.13 or newer and npm 10 or newer. Run `npm ci`, then `npm run migrate` to create the database and `npm run dev` to start the development server on loopback.

## Development toward 0.1.0

Development is unversioned until the first `0.1.0` release. Leave package/lockfile versions unchanged; do not create numbered beta releases. Breaking APIs and storage changes may require an explicit development-data reset. Setup/startup must never silently reset data. Earlier development backups are not guaranteed compatible with later builds.

The intended first release covers Dashboard, Jobs, Network, Documents, Settings, local MCP and backup/recovery. Cloud hosting/storage, plugins, built-in AI and installers are later work. The initial changelog and formal release tag belong to the final `0.1.0` publication step. After that, released baselines are immutable and supported data changes use migrations independently of app version numbers.

### Build identity and storage contracts

Vite and the MCP builder use `scripts/build-info.mjs` to capture the same Git-based development identity: `dev.<12-character-commit>` with `.dirty` when tracked or untracked source changes exist. Dirty builds are not reproducible references; use a clean commit when sharing a build. Rebuild both artifacts with `npm run build` after source changes. A running dev server captures identity when Vite starts; restart it to refresh the identity.

No Git executable or repository is needed at production runtime. Source archives without Git build with the explicit `development` fallback; direct source CLI commands also have no captured build identity. MCP reports its build identifier in the initialization response. Web Settings responses expose it in `X-Saturday-Build` and their load data; Settings Storage displays the captured build and resolved storage diagnostics.

`src/lib/server/compatibility.js` owns current supported-storage declarations, using the existing migration list for the database version and a shared manifest version for initialization, validation and offline recovery. Exact migration/schema/manifest validators still apply; a version range alone does not establish compatibility. The active baselines are `saturday.database.numeric` (schema 1), `saturday.files.numeric` (manifest 2; version 1 converts with original metadata retained), and `saturday.backup-pair.numeric` (pair 1). SQLite and the manifest share a dataset UUID. Business writes recheck the database schema and file-format header at mutation boundaries; file publication also checks the current manifest fingerprint and database compatibility before journalling/replay. Unsupported development formats require a matching build or an explicit reset, never guessed conversion.

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
| Assistant client    | Local stdio MCP; ChatGPT Work selected for beta verification, actual connection/reconnect pending                                     |

Phase 5 local evidence (2026-10-09): macOS 26.4.1 on Apple Silicon; clean source installation and repeated populated setup with Node 25.9.0/npm 11.12.1; sandboxed Chrome 154.0.8037.57. Repeated setup preserves records, document content/tokens and numeric allocation. The production HTTP test checks start, stop, status and restart. All 107 service/CLI/MCP tests pass locally; Node 22.23.3 and 24.21.0 pass the 106-test suite plus the final process-death case separately. The expanded production browser review passes without page errors, and single-/three-page PDF fixtures pass visual and extracted-text/link/layout inspection. This verifies rebuilding the same compatible development baseline, not a released-version upgrade. Results for each advertised platform, actual ChatGPT Work and screen-reader certification remain release gates. Hosted CI is not required.

Run checks with temporary databases and file stores. Before a development update, stop web and MCP processes and retain backups with the matching source/build if needed. Incompatible-format errors require a compatible build or an explicit scoped reset, never manually altered migration records. The current build requires the numeric database and dataset-bound file baselines. UUID-era databases/backups and earlier manifests/pairs are unsupported. This implementation does not reset existing development data; use isolated paths until the deliberate final reset.

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
- `scripts` — setup/run commands, backup/restore CLI, and shared installation setup
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

The unreleased numeric migration-1 baseline contains all current job fields and Network tables. Jobs, people and both histories have independent auto-increment integer IDs; update IDs supply insertion order. The singleton `app_metadata` row stores format and dataset identity. The complete registry of original and added stored fields lives in `src/lib/job-fields.js`. It defines names, UI/MCP mappings, types, limits, options, access (`user`, `assistant`, `system`), dependencies, and introduction versions. Validation, service writes, read adapters, MCP inputs, and backup column lists derive from it. Add/Edit form fields stay inline with the other page fields. Manual create/edit ignores assessment inputs; only MCP create and the dedicated assessment service write score/comment. Partial edits preserve omitted fields. Clearing a follow-up date clears its comment and never adds history.

Backup validation uses an exact schema signature for each supported migration version. Restore stages only the supported numeric baseline, including dataset metadata and allocator counters. Same-dataset restores retain the higher current/incoming counters; another dataset uses incoming counters. Job allocation and database restore also reserve IDs represented by same-dataset file entries, including unmatched folders from newer independent snapshots. Original backups are never migrated in place. Include all new fields in dataset fingerprints so any detail or assessment change invalidates a prepared restore. Freeze baseline 1 at release `0.1.0`; afterward append supported migrations and test upgrades/restores.

When adding a stored job field, add it to `jobFields` with `since` set to its migration version, write an explicit migration, and add inline form controls as needed. System fields are generated/maintained by services; assistant fields are excluded from manual input. `info` controls the Job information card, and `list` controls MCP list summaries. Keep existing names, mappings, and historical `since` values stable. Removing a field from the UI/input does not mean deleting its historical definition or data; handle permanent column removal and historical backup compatibility in an explicit migration. Computed status and history remain service behavior, not jobs columns.

## Jobs search and filters

`src/lib/job-search.js` owns browser-safe filter choices, defaults, URL encoding, and chips. Search schemas live in server validation; `searchJobs` applies bound SQL predicates and shared status rules within a read snapshot before counting/pagination. Candidate history is fetched in a batch. Jobs uses an inline GET form; MCP uses the same service with All as its default activity. Keep `listJobs` backward compatible for existing callers.

When adding a filter, update its validation, URL handling/chip behavior, inline control, service predicate, MCP documentation, and meaningful tests. Keep AND across categories, OR within categories, historical steps including inactive jobs, local calendar date boundaries, and stable sort tie-breakers. A query filter needs no migration unless it also introduces stored data. Tests must use temporary databases.

## Documents

`src/lib/server/files/` owns file scope/manifest services, journalled local publication, ZIP recovery and PDF generation. MCP tool definitions live together in `src/lib/server/mcp-server.js`. Files add no SQLite schema migration. `src/lib/file-types.js` owns the small format/action mapping; explicit page controls remain in Svelte. The UI shares file list/editor components between user and job scopes and follows the design guide's solid surfaces, existing dialogs, labeled controls and toast feedback.

Manifest format `saturday.files.numeric`, version 2, is validated centrally. Version 1 converts under the file lock, retaining the original metadata as `manifest-v1.json` in recovery state. A new collection binds once to the database dataset UUID; later operations never silently rebind it. Canonical numeric `jobs/<id>` keys require matching database/manifest datasets for normal access. User documents and explicit recovery remain available across a dataset mismatch. Add missing refuses cross-dataset merges into populated collections; an empty collection may adopt an incoming namespace, while Replace preserves the incoming identity. Independent restoration can occur database-first or files-first; job access waits for a match. Keep future migrations pure/sequential and preserve historical validators; refuse newer versions. Use shared conflict tokens and storage services for every mutation. Never write file bytes or the manifest from a route/MCP handler directly. Copies/PDFs create independent IDs; designations refer to stable IDs. Journal recovery precedes normal operations. Coordinated restore holds the SQLite write gate before the file lock, with a persisted recovery session for cross-store failures.

Tests use temporary file roots and databases. `npm test` includes real Chrome PDF and process/journal/recovery/MCP checks; install Chrome first and permit sandboxed browser startup locally. `npm run test:web` covers production document forms, scope downloads, streaming uploads/imports and existing job/backup flows. The browser review covers core-page control names/reflow, keyboard dialog focus and validation, document/network workflows, light/dark and reduced motion. Visual contrast and actual screen-reader review remain separate release checks.

`npm run test:beta` runs `scripts/review-documents.mjs` against the production build (run `npm run build` first), with disposable stores and screenshots. Sandboxed Chrome must be installed. Browser review screenshots and failure evidence stay in the OS temporary directory; the command prints its location.

Run `npm run setup:pdf` once, then `npm run verify` before sharing each beta candidate. Verification runs lint, Svelte checks, service/CLI/MCP tests, production build/HTTP tests and browser review in order, stopping on failure. No hosted CI or new dependencies are required. Record the commit/build identity, OS/architecture, Node/npm/Chrome versions and results; local success establishes evidence only for the tested environment. Screen-reader, contrast and actual assistant-client checks remain manual.

Optional extended checks: `node scripts/review-documents.mjs` runs Documents and Network browser workflows with disposable stores and screenshots in the OS temp directory. `node --max-old-space-size=128 --test tests/files.large.integration.mjs` checks a ZIP and expanded collection above 1 GiB; allow several GiB of temporary disk space. Neither command uses your application data.

## Network contracts

`src/lib/server/networks.js` owns people, due follow-ups, job relationships and optional dated interactions. Shared explicit schemas live in `validation.js`; tools stay in the central MCP server. Network route forms and the job Network section stay inline, reusing existing UI primitives; no additional UI components, field registry, dependencies or picker endpoints are needed.

Numeric baseline 1 includes `networks`, `job_networks` and `network_updates`; IDs are positive safe integers. Follow-up is independent of interactions. Link/unlink and interaction changes do not update parent detail timestamps or job status/history. Link notes own their timestamp and creation source. Use scoped IDs, bound literal contains queries, whitelisted sorts, a read snapshot for counts/pages, and batched link lookup for pickers. History uses calendar date then insertion order, rejects future dates on writes, and is optional.

Extend every backup table definition, deterministic ordering, field validation, hash, preview count and replacement path for new stored records. Only the current numeric baseline is supported; restore uses child-before-parent deletion and parent-before-child insertion. Both ordinary and coordinated recovery include Network. Tests cover >100 records, literal AND/OR filters, partial/null edits, retry-safe links, scoped history changes, rejected old snapshots, namespace mismatches, interrupted cross-dataset recovery, stale previews, malformed data, real MCP and production HTTP/browser flows. Keep full accessibility/platform review as separate release work, not implied by compilation.

Backup metadata records the creator build, format and dataset identity. File archives also carry creator build metadata in their manifest, keeping them self-contained. Pair preparation validates both actual artifacts against the pair namespace; recovery sessions retain each original store identity, including an original mismatch. Stop and rebuild/restart web and MCP together after development updates.

Settings presents manual database/files/both creation and grouped history with download, previewed restore and confirmed deletion. Shared orchestration in `files/pairs.js` preserves independent formats, dataset checks and safety recovery. Downloads stream; combined ZIP imports validate artifacts and remap pair IDs. An operation lock protects managed create/import/export/delete. New backups sit under the data directory's `backups/`; legacy adjacent archives remain discoverable. Scheduling APIs, worker startup and retention are removed; old schedule JSON is inert.

## Extension development

The [extension guide](extension-guide.md) defines API 1. `scripts/extension-build.mjs` generates the web/MCP registrations on dev/build/check. `src/lib/server/extensions.js` shares lifecycle, locks, database access and recovery; `scripts/extension-install.mjs` stages and publishes offline installs. The public browser entry is `src/lib/extension-ui.js`; avoid private imports in extension packages. Interview Practice in `examples/extensions` exercises page/database/tool contracts without a new dependency. Run local verification and focused lifecycle tests before changing these contracts.

## Installation paths and setup

`src/lib/server/installation.js` is the shared resolver for database, file/state/backup, extension and code/runtime/log paths. Descriptor format `saturday.installation` version 1 holds a separate installation ID, resolved paths, build, port and initialized/setup state. `scripts/setup.mjs` orchestrates source setup with persisted step results and capped logs. Its initial imports are dependency-free so fresh checkout setup can run npm ci first; store/extension services load afterward. Atomic JSON and directory-lock helpers are shared through the installation module and re-exported by the file store. Existing source paths stay unchanged; a configured descriptor is mandatory when supplied and path conflicts/missing initialized stores fail. Offline file recovery explicitly bypasses only the missing-manifest guard, retaining existing recovery checks. Managed roots use macOS Application Support, Windows LOCALAPPDATA, and Linux absolute XDG_DATA_HOME with the standard fallback. Runtime provisioning, relocation, shortcuts, login startup and server lifecycle controls remain later phases.

`/health` returns installation/build readiness without paths or record content; `scripts/status.mjs` checks identity before reporting success. Settings exposes the data directory, platform-native Open folder action and descriptor/log diagnostics. Run focused installation tests and temporary HTTP checks; Windows/Linux runtime and complete visual/accessibility verification remain Phase 7.

## UI process lifecycle

`src/lib/server/server-lifecycle.js` shares owned background launch, readiness, private loopback control and process admission between `scripts/start.mjs`, Settings and storage services. `npm run open` starts/reuses and opens the browser; `npm run start` keeps a foreground wrapper for developer Ctrl-C behavior. Stop/Restart acknowledgments precede completion; status checks the persisted address and installation identity. Only the spawned child is terminated, never an arbitrary recorded PID.

Private `server.state/` holds credentials, owner/generation and PID activity markers outside backups. An exclusive maintenance flag and double-checked activity admission prevent new writes from racing lifecycle controls; nested operations share admission via AsyncLocalStorage. Wrap whole asynchronous data operations, not just their final transaction. Existing backup streaming locks also prevent shutdown during downloads. Settings validates the HttpOnly same-site session cookie and exact Origin; the private controller separately requires a bearer secret. Response completion commits UI operations so the acknowledgment arrives before shutdown. Never serialize controller secrets into page data, health responses or diagnostics.

Settings controls and reconnect state remain inline; no additional frontend framework or dependency is used. Child startup/logging is bounded; failures leave recoverable status/logs and no permanent supervisor after stopping. `tests/server-lifecycle.integration.mjs` uses a production build and disposable data for port collisions, duplicate ownership, active-operation rejection, UI authentication/restart/stop and real MCP writes with web off. Light macOS checks pass; full crash/failure, desktop/session lifetime, keyboard/screen-reader and Windows/Linux execution remain Installation Phase 7. Login startup and installer adapters are Phase 4.
