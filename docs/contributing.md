# Contributing

## Get set up

For installer and operational setup, use the [installation guide](installation-guide.md). For development, use Node.js 22.13+ and npm 10+. From a source checkout:

```sh
npm run setup
npm run dev
```

Setup installs dependencies, prepares optional Chrome/PDF support, builds web/MCP, and initializes or validates stores. It persists an installation descriptor and can be repeated without resetting data. The dev/preview server binds to loopback. Test LAN through the owned production launcher; it reads Settings on each web start. Use disposable paths for experiments and tests; do not develop recovery workflows against personal data.

For an isolated source workspace, set absolute `SATURDAY_DB_PATH`, `SATURDAY_FILES_PATH`, `SATURDAY_EXTENSION_STATE_PATH`, and `SATURDAY_EXTENSIONS_PATH` before setup. Keep the resulting `SATURDAY_INSTALLATION_PATH` consistent across commands. Existing descriptors reject conflicting overrides rather than selecting another workspace.

## Development toward 0.1.0

Development remains unversioned until `0.1.0`: leave placeholder package/lockfile versions unchanged and do not create numbered beta releases. Breaking development APIs/storage may require an explicitly authorized reset; startup and setup must never reset data silently. Retain compatible backups and their source/build when testing upgrades.

Dashboard, Jobs, Network, Documents/Profile, backups, local MCP, extensions, managed installers, and manual update/repair/uninstall are implemented. Implementation does not establish platform certification. The current development database format is `saturday.database.workflow`, schema 1. Older numeric-format databases/backups reject unchanged; use disposable storage for development.

After `0.1.0`, released storage baselines are immutable and supported data changes use migrations independently of application version numbers.

### Build identity

`scripts/build-info.mjs` supplies both web and MCP with a captured identity. Git builds use `dev.<12-character-commit>` with `.dirty` for local changes. Pinned archives use a validated full `SATURDAY_BUILD_COMMIT`; local snapshots can use a fingerprint identity `local.<12-hex>`. Without Git or an explicit identity, builds fall back to `development`. Direct source services have no compiled identity.

Run `npm run build` to rebuild both artifacts; restart Vite to refresh a dev server's identity. Production does not need Git. Settings diagnostics, `get_saturday_info`, and `/health` expose build identity; the MCP initialization version is also the build ID. A dirty build is not a reproducible source reference.

### Provisional support matrix

| Area                  | Implementation target / verification limit                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed installation  | Private Node/npm, source staging, desktop launcher, optional login startup, manual update/repair/uninstall                                      |
| macOS                 | 14+, Apple silicon/x64; local source and limited disposable managed-install evidence on Apple silicon                                           |
| Windows               | Windows 11 x64; native runtime, paths/processes, desktop/login, PDF, and failure workflows still need full verification                         |
| Linux                 | Ubuntu 22.04/24.04 x64 with graphical GNOME; runtime, Chrome libraries/fonts, desktop/login, and failure workflows still need full verification |
| Source runtime        | Node.js 22.13+ and npm 10+; verify each advertised runtime explicitly                                                                           |
| Browser/accessibility | Modern desktop browser; full keyboard, zoom, contrast, screen-reader, and platform certification pending                                        |
| Assistant client      | Local stdio MCP; real-client connection/reconnect must be verified separately from protocol tests                                               |

History records local macOS source/setup, PDF, HTTP/browser, and limited managed-launcher/login checks. These are historical observations, not a current all-platform test pass. Before claiming support, record the candidate commit/build, OS/architecture, Node/npm/Chrome and client versions, commands, and actual results. Reboot/login/session behavior and real assistant-client access remain explicit manual checks.

## Commands and verification

| Command                                                | Purpose                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `npm run setup`                                        | Resumable dependency/PDF/build/storage preparation                                |
| `npm run dev`                                          | Loopback development server                                                       |
| `npm run open` / `npm run stop` / `npm run restart`    | Control this installation's background UI                                         |
| `npm run start`                                        | Production start with foreground control when creating a server                   |
| `npm run status`                                       | Verify installation/build readiness and actual URL                                |
| `npm run build` / `npm run build:mcp`                  | Build web and MCP / MCP only                                                      |
| `npm run migrate`                                      | Create the database or apply supported migrations                                 |
| `npm run check`                                        | Generate extension registrations; check Svelte and types                          |
| `npm run lint` / `npm run format`                      | Check / write Prettier formatting                                                 |
| `npm run setup:pdf`                                    | Install Puppeteer's managed Chrome                                                |
| `npm test`                                             | Build MCP; run service, CLI, process, and protocol tests                          |
| `npm run test:web`                                     | Build production; run HTTP, lifecycle, password, LAN, and available Chrome checks |
| `npm run test:beta`                                    | Browser review against an existing production build                               |
| `npm run verify`                                       | Lint, type checks, unit/integration tests, production tests, browser review       |
| `npm run assistant -- config --format json`            | Generate local MCP configuration; also supports TOML                              |
| `npm run update:check` / `npm run update -- --confirm` | Check / perform a manual application update                                       |
| `npm run repair` / `npm run uninstall -- --confirm`    | Repair installation / uninstall with data retained                                |

Backup/file commands are in the [agent guide](agent-guide.md#backup-and-recovery-commands); extension commands are in the [extension guide](extension-guide.md).

`npm run check` also runs `npm run check:scripts`, which uses the existing TypeScript dependency to detect unresolved names in `scripts/**/*.mjs`. This is a focused name-resolution check; other JavaScript typing diagnostics remain outside its scope. Installer tests cover fresh managed installation from an empty root as well as repair/reinstallation. The fresh-install test reuses local dependencies while exercising runtime configuration, web/MCP builds, setup, publication, desktop shortcut creation, and UI readiness.

Run checks appropriate to a change. Before sharing a candidate, install Chrome and run `npm run verify`. `test:beta` requires `npm run build` first when run independently. Browser screenshots and failure evidence are written to the printed OS temporary directory. Tests use disposable stores; real Chrome checks need sandboxed browser startup. HTTP and compilation checks do not replace visual or screen-reader review.

For the optional large-archive case, run `node --max-old-space-size=128 --test tests/files.large.integration.mjs`; allow several GiB of temporary space. It exercises a ZIP and expanded collection above 1 GiB.

## Source map

| Location                                                          | Responsibility                                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/routes/`                                                     | SvelteKit pages, form actions, HTTP endpoints, and layout                         |
| `src/lib/components/app/`                                         | Shared app UI patterns                                                            |
| `src/lib/components/ui/`                                          | UI primitives                                                                     |
| `src/lib/job-fields.js`, `src/lib/job-search.js`                  | Job field registry and browser-safe search/URL choices                            |
| `src/lib/server/services.js`, `networks.js`, `validation.js`      | Record services, queries, and validation                                          |
| `src/lib/server/workflow.js`                                      | Workflow configuration, starting-stage selection, ordering, and usage guards      |
| `src/lib/server/access-settings.js`, `access-auth.js`             | Private access preferences, password verification, and browser sessions           |
| `src/lib/server/database.js`, `migrations.js`, `compatibility.js` | SQLite access, schema, and supported formats                                      |
| `src/lib/server/backups.js`, `src/lib/server/files/`              | Database/file backups, documents, PDF, journals, and coordinated recovery         |
| `src/lib/server/mcp-server.js`                                    | Core tool schemas and adapters; extension tool registration                       |
| `src/lib/server/installation.js`                                  | Shared descriptor, paths, setup helpers, client configuration, and OS integration |
| `src/lib/server/server-lifecycle.js`                              | Owned UI supervisor, readiness, and lifecycle admission                           |
| `src/lib/server/installation-operations.js`                       | Update selection, external controller, publication, repair, and uninstall         |
| `src/lib/server/extensions.js`, `src/lib/extension-ui.js`         | Extension runtime/storage services and public browser exports                     |
| `scripts/`                                                        | Setup/build/run, installer, backup/recovery, and extension commands               |
| `tests/`                                                          | Service, process, CLI, MCP, HTTP, browser, and UI-convention checks               |
| `examples/extensions/interview-practice/`                         | Portable extension example                                                        |
| `docs/`                                                           | User, assistant, and contributor guides                                           |

## Local workflow and access verification — 2026-10-21

The development candidate based on `4f3a26c` plus local changes passed `npm run verify` on macOS 26.4.1 arm64, Node 25.9.0, npm 11.12.1 and managed Chrome 154.0.8037.57: 160 regression tests, eight production HTTP/browser checks, and the document/extension browser review. The package remains an unreleased development version.

Coverage includes more than 100 jobs, independent board pages, empty/closed-only data, current-versus-recorded milestones, Back/reload, keyboard focus, stale destination choices, uncertain-response retries, expired drafts, last-write-wins races, and fresh/populated database/paired restores. Fresh paired restore initializes its target file manifest before capturing database preview guards. Workflow names/order/archive state, IDs/counters, Network, Profile and attachments survive recovery. Old database formats reject unchanged. Reduced-motion preferences shorten sheet/control animations.

A separately created temporary installation built and initialized the workflow baseline, generated an isolated desktop shortcut and JSON/TOML client fixtures, matched web/MCP identities, reflected a stage change on Dashboard, and supported MCP reconnect/read with the UI stopped. It reused local dependencies/runtime and did not alter personal data, the real Desktop, login startup or actual assistant-client configuration.

Desktop/light, 320px/dark, 640px reflow, exact 767/768px dialog boundaries, touch emulation and Chrome accessibility-tree heading/link checks were reviewed. Reflow emulation is not actual browser 200% zoom; touch emulation is not a physical phone; an accessibility tree is not a screen-reader test. Actual zoom, physical touch/assistive technology, other supported platforms/minimum runtimes and real assistant-client verification remain release gates. Native GET lists/board paging and ordinary job forms are covered; quick-edit dialogs require JavaScript.

A subsequent full `npm run verify` on commit `9550890` passed 160 regression tests, eight production HTTP/browser checks and document/extension browser review. Access coverage includes independent LAN/password defaults, all four combinations, initialization interruption/fail-closed behavior, route gates, forged-header rejection, host-only controls, restart/revocation, stopped-server recovery, expired-save/upload drafts and browser Back. Chrome used an actual external IPv4 address for login, job capture, upload/download and logout-all; this is not physical-phone certification.

The wheel-activity follow-up reproduced missing finite-session renewal before the fix and verified trusted renewal, burst throttling, rejected synthetic activity and No expiration afterward. Build, formatting, zero-error/warning type checks, 29 focused tests and four production password/Dashboard/LAN checks passed. The separate theme follow-up passed build/type/format checks, 14 UI-convention tests and nine production checks, including browser-local persistence and fallback behavior; this does not claim a fresh full `verify` run for that follow-up.

Regression entry points are `tests/workflow.test.mjs`, `tests/workflow.integration.mjs`, `tests/dashboard.test.mjs`, `tests/dashboard.integration.mjs`, `tests/access.test.mjs`, `tests/access-network.test.mjs`, `tests/access.integration.mjs`, `tests/access.browser.mjs`, `tests/lan.integration.mjs` and `tests/theme.integration.mjs`. Temporary screenshots/logs and disposable installation paths are review artifacts, not permanent release evidence. Repeat relevant checks against the exact candidate before claiming support.

## Storage contracts

`compatibility.js` and `migrations.js` define supported formats. Package `saturday.storage` metadata must agree with them. Exact schema/manifest validation is required in addition to version checks.

| Store              | Current contract                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Database           | `saturday.database.workflow`, schema 1; `app_metadata` holds the dataset UUID                        |
| Files              | `saturday.files.numeric`, manifest 2; supported version 1 upgrades while retaining original metadata |
| Coordinated backup | `saturday.backup-pair.numeric`, version 1; validates both actual artifacts and their shared dataset  |
| Installation       | `saturday.installation`, version 1; installation ID is distinct from dataset ID                      |

Earlier `saturday.database.numeric` and UUID-era databases/backups, plus unbound file formats/pairs, are unsupported and reject unchanged. Supported manifest version 1 is already dataset-bound; its upgrade to version 2 adds Profile designations and preserves the existing Master CV. Never alter migration records or dataset IDs to bypass compatibility checks.

Jobs, people, and both histories use independent positive safe integer IDs. Same-dataset restores retain the higher current/incoming allocator counters. IDs represented by same-dataset job-file folders are also reserved, preventing attachment reassignment after an older database restore. Restoring another dataset uses its identity/counters.

Database and files remain independent. Normal `jobs/<id>` access requires matching dataset identities; user documents and explicit recovery remain available across a mismatch. Add missing refuses cross-dataset merges into populated file collections; Replace installs the incoming collection. Either store can be restored first, with attachment access waiting for a match.

### Jobs and Network

The job registry owns stored field names, UI/MCP mappings, types, limits, access, dependencies, and introduction versions. Validation, write adapters, MCP inputs, and backup columns derive from it. User edits cannot write assistant assessment fields; partial edits preserve omitted fields. Current placement is stored as `jobs.current_stage_id`; activity is derived from the referenced workflow stage. History is independent and does not move placement. Workflow stages are included in backup registries, fingerprints and replacement ordering. Stage changes and their milestones commit atomically; corrections cannot remove the sole milestone supporting current placement.

For a new stored field, update the registry, migration, relevant forms, backup validation/fingerprint, and tests together. Keep existing names and historical `since` values stable. Freeze the released baseline and append migrations afterward; never migrate original backup files in place.

Search uses bound literal-contains queries, whitelisted sorts, stable ties, read snapshots for counts/pages, and batched related records. Filters combine with AND across categories and OR within categories. UI Jobs defaults to Active; MCP defaults to All. Historical steps include inactive jobs. Dates use the host's local calendar. Filter additions must update validation, URL/chips, controls, service predicates, MCP documentation, and meaningful tests.

Network follows the same validation/query conventions. General notes, relationship notes, and interaction notes are distinct. Link/unlink and interactions do not change job status/history or parent detail timestamps. Interaction dates cannot be future dates; follow-ups are independent and are not cleared by interactions. Scope updates by both person and update ID.

### Workflow stages and history

The executable full schema and indexes live in [`migrations.js`](../src/lib/server/migrations.js); do not maintain another SQL copy. `workflow_stages` stores stable IDs, names, ordering, closure/archive flags and timestamps. `jobs.current_stage_id` references current placement; nullable `job_updates.stage_id` distinguishes milestones from general notes. There is no stored job activity flag, fixed event enum, success classification, initial-stage flag or revision counter.

Available stages sort by `is_closed, sort_order, id`; archived rows follow available rows in configuration. The first available open stage starts new jobs, and defaults are seeded only for a new database. Default open progression is New → Applied → Screening → Interview → Offer; Accepted, Rejected and Dismissed are editable closed destinations. Names and display order never enforce transitions: moves may go backward, skip stages or close from any stage.

Stage names are trimmed, 1–80 characters and unique among available stages using the shared trim/lowercase normalization. Archived names may collide; restore requires an available name and retains the ID. Add/restore/unused closure changes append within the stage's type. Up/Down reads current membership, moves one place within the same type and normalizes order in a write transaction. Field-specific actions preserve unrelated/concurrently added data. Starting-stage changes require confirmation and affect future jobs only. Closure cannot change while any job/history references the stage; archive requires no current occupants and must leave an available open stage. There is no permanent stage deletion. Workflow configuration uses ordinary authenticated browser access, including allowed LAN browsers; it is not host-only maintenance and has no MCP mutation tools.

Creation saves starting placement plus its initial milestone atomically. Change stage validates the latest job and available destination, accepts today/past dates, and commits placement plus one milestone together. Same-stage requests change neither timestamps nor history. Last committed moves win, retaining both actual moves' milestones; ordinary detail edits cannot overwrite placement. History-only changes never move a job, but refresh its `updated_at`. Notes require text; milestones may omit notes and use archived stages or confirmed future dates. Scheduled milestones count in distinct-job historical totals without advancing placement. History correction/deletion rechecks ownership and latest placement transactionally and cannot remove the sole milestone supporting that placement; date/note-only corrections remain allowed. Reads never reconstruct placement from history, and clients inspect authoritative state before manually retrying uncertain writes.

Database backups include every stage, job pointer, history entry, dataset identity and allocator counter. Restore validates available names/types/order, at least one available open stage, available current destinations and supporting milestones. Remove dependent records before replacing all stages, including staging defaults; insert incoming stages before jobs/history. Workflow changes invalidate prepared restores through existing fingerprints. Test fresh and populated targets with different stage IDs and custom/archived stages, preserving Network, Profile, file namespaces and counters. Reject old formats unchanged; no development converter or automatic reset is supplied.

### Documents and recovery

Use `files/` services for every file mutation; routes/tools must not write bytes or the manifest directly. Publication checks hashes/conflict tokens and journals changes. Version conversion runs under the file lock and preserves old metadata. Copies and PDFs get independent IDs; Profile designations refer to stable document IDs.

Coordinated restore acquires the SQLite write gate before the file lock and persists cross-store recovery state. Interrupted sessions block normal access until offline recovery. Backups include creator-build and dataset metadata; fingerprints must include all stored fields. Previews expire, reject relevant changes, and are single-use. Preserve recovery copies after uncertain failures.

Manual backup orchestration lives in `files/pairs.js`. Database/files/both appear in grouped history; combined downloads/imports stream ZIPs while retaining independent artifact formats. New archives use `backups/database/` and `backups/files/` beside the stores. Supported older adjacent archives remain discoverable. Scheduling/retention workers are removed; old schedule JSON is inert. Core backups exclude extension databases.

## Installation and lifecycle contracts

### Browser access and authentication

`access-settings.js` owns version-1 `saturday.access` at `<data_root>/access.json`: `allow_lan` defaults false, `idle_timeout_seconds` defaults 3600 (900–2592000 or null for No expiration), and `password` is null or a salted scrypt verifier with its parameters. Initialize under the shared lock by publishing the descriptor marker before the settings file. Missing initialized, malformed or unsupported settings fail closed; preserve valid existing settings. Updates/reinstall retain this private file; career backups exclude it. No account/session tables or new runtime dependencies are involved.

The production supervisor reads saved LAN preference on web-process startup: loopback by default, all IPv4 interfaces when enabled, with occupied-port fallback. Settings shows saved and effective modes separately; saving does not rebind listeners or restart an already-running instance. The actual phone address matters, not a new port-selection field. Supervisor control remains loopback-only. Validate actual sockets and same-origin requests rather than forwarded identity; keep existing CSRF/control-cookie checks. Host-only access/password/server/installation actions remain unavailable to remote browsers even without password protection; ordinary records, workflow configuration and both logout actions remain available under normal authentication. LAN does not expose MCP, configure public hosting or change firewall/router policy. HTTP does not encrypt passwords, sessions or data.

`access-auth.js` uses bounded asynchronous scrypt and login attempts, opaque tokens stored hashed in memory, and a 100-session cap. Successful login prunes expired sessions then evicts the oldest if full; incorrect passwords do not evict. Installation-specific host-only HttpOnly/SameSite cookies use Secure with HTTPS and no Expires/Max-Age. The central hook protects private pages, framework data, APIs, files, backups and extensions; minimal sign-in/session checks and actual-loopback readiness remain available. Private/login/credential responses use no-store. Logout revokes server sessions and clears client state through full navigation; logout-all, password changes and process restart revoke other sessions too. Browser password protection is independent of trusted local stdio MCP.

Finite inactivity is enforced using server receipt times, with no hidden absolute login-age deadline. Trusted interaction on visible pages, including local carousel wheel gestures, uses the shared 30-second throttled activity path. Passive checks/polling and synthetic events do not renew sessions; No expiration skips heartbeats. Timeout changes prune under the old policy before applying the new one; unlimited-to-finite starts a fresh idle period and expired sessions cannot revive. A protected write returns 401 before private work, preserving enhanced drafts/uploads for separate-tab sign-in and manual retry. Browser history restoration rechecks authorization without counting as activity. Already-authorized work or downloaded data cannot be retracted.

Live password/policy changes occur in Settings on the host. Host CLI recovery/credential changes stop and verify the owned UI and respect maintenance locks, refusing independent runtimes; recovery saves LAN off, removes protection and preserves career data. Core MCP exposes neither authentication management nor command execution. Protected installation operations suppress the separate progress gateway but retain durable results; access changes refuse queued/active installation work. Restart uses minimal local readiness then a full reload and fresh sign-in. User recovery commands live in the [installation guide](installation-guide.md#locked-out-of-saturday).

### Owned processes and maintenance

The shared resolver owns all database/file/state/backup/extension/code/runtime/log paths. Setup starts without application dependencies, runs `npm ci`, then loads storage services. Step results and bounded logs persist for retry. Existing source paths are adopted without relocation; missing initialized stores fail instead of creating replacements.

The supervisor owns only its UI child. `/health` reports readiness and installation/build identity without record content or paths. Lifecycle controls require authenticated local ownership and refuse active operations; client-owned stdio MCP stays independent. Controller tokens and state are private and excluded from backups.

Bootstrap verifies official Node artifact hashes and pinned GitHub source, builds in staging, and retains an interruption journal. It never replaces global Node, enables login by default, or bypasses OS protections. The private runtime pin lives in `install.sh`/`install.bat`. Managed PDF cache paths must be shared across UI/CLI/MCP.

Update/repair/uninstall run through an external controller that survives UI shutdown. Staging/builds precede publication; live writers must stop before storage validation/migration. Maintenance guards persist across interruption. Retain previous code/runtime/descriptor and independent database/file/extension snapshots; never blindly downgrade or roll back migrated data. Source updates require clean Git state; local-source repair preserves checkout files and uses a fingerprint identity.

Uninstall removes only exact owned targets. Data retention is the default; confirmed deletion must exclude shared/external/unowned paths and system runtimes. Keep partial-cleanup state and guidance. App uninstall does not discover or alter arbitrary assistant configuration files.

### Release metadata

The controller supports stable GitHub releases with uploaded `saturday-release.json`: format `saturday.release`, version 1, stable `release`, full source `commit`, `source: {type: "github-source"}`, and the package's installation/runtime/storage metadata. It verifies GitHub's SHA-256 asset digest, tag commit, version, and compatibility contract. Drafts/prereleases are ignored; stable versions are ordered numerically. Released installs never silently fall back to `main`; lookup failure is an error.

Optional `runtime: {version, hashes: {"darwin-arm64": "<sha256>", ...}}` pins official runtime artifacts when needed. Keep installation API 1 bootstrap/controller code parseable by the supported existing runtime until a new runtime can be staged.

## UI and documentation conventions

Follow the [design guide](design-guide.md#building-a-new-page-or-feature) and reuse shared components. `tests/ui-conventions.test.mjs` enforces these patterns. Update the user guide for UI behavior, the MCP reference for tool contracts, and the installation guide for setup/maintenance commands. Keep assistant connection instructions in the assistant guide and advanced recovery in the agent guide. Keep current behavior separate from unverified support claims; avoid repeating instructions across guides.

Documentation images belong in `docs/images/`, with relative links, descriptive alt text, and reasonably sized PNGs. Run Prettier on changed documentation. Extension API changes must also update the [extension guide](extension-guide.md); generated extension registries are ignored outputs and must not be edited manually.
