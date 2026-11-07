# Contributing

## Get set up

For installer and operational setup, use the [installation guide](installation-guide.md). For development, use Node.js 22.13+ and npm 10+. From a source checkout:

```sh
npm run setup
npm run dev
```

Setup installs dependencies, prepares optional Chrome/PDF support, builds web/MCP, and initializes or validates stores. Run setup before data commands in a fresh source workspace. An explicitly missing descriptor or managed storage without its descriptor requires recovery. Deliberate first source setup preserves existing source records and their dataset identity. It persists an installation descriptor and can be repeated without resetting data. The dev/preview server binds to loopback. Test LAN through the owned production launcher; it reads Settings on each web start. Use disposable paths for experiments and tests; do not develop recovery workflows against personal data.

For an isolated source workspace, set absolute `SATURDAY_DB_PATH`, `SATURDAY_FILES_PATH`, `SATURDAY_EXTENSION_STATE_PATH`, and `SATURDAY_EXTENSIONS_PATH` before setup. Keep the resulting `SATURDAY_INSTALLATION_PATH` consistent across commands. Existing descriptors reject conflicting overrides rather than selecting another workspace.

## Release and compatibility policy

Saturday `0.1.0` establishes the first frozen release baseline. Available features and automated checks do not establish platform certification; use the support matrix below when evaluating an installation.

Released storage baselines are immutable. Append migrations for supported data changes and test upgrades with populated fixtures. Database and file-format versions advance independently of the application version. Setup and updates must never reset existing data silently. Preserve recovery backups and their compatible application build.

### Version changes after 0.1.0

`release-baselines.json` freezes shipped source, storage declarations, numbered migration checksums and a populated compatibility fixture. `npm run check:release` runs during checks and production builds; release metadata generation also requires a frozen version. Changes to app code, dependencies, installers, build code, icons, bundled guides or extension examples require a newer app version. Tests alone do not. Hashes tolerate Git CRLF conversion and ignore generated extension registrations.

| Change             | Required version change                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Shipped app change | Bump package and lockfile root versions together, normally `npm version patch --no-git-tag-version`                            |
| Database change    | Also append migration 2, 3, and so on, and advance `saturday.storage.database.currentVersion` to match; never edit migration 1 |
| File format change | Also advance the independent manifest version and implement compatible reading/upgrading                                       |

Released migration SQL and names are checked before any database is opened. Rewriting or removing a released migration fails even after an app bump. App-only changes keep the database version unchanged. Retain released fixtures byte for byte and add populated upgrade/restore coverage for storage changes.

Develop the next version after bumping it. Before release, finalize source and notes, then run `npm run release:freeze` to append the new immutable baseline. Unchanged storage can reuse the previous populated fixture; a storage change requires `-- --fixture tests/fixtures/<new-fixture>/expected.json` matching its new versions. Freezing cannot replace an existing release. Commit the baseline with its source, then verify the exact clean commit before generating the metadata asset. Local checks do not configure remote branch protection.

### Build identity

`scripts/build-info.mjs` supplies both web and MCP with a captured identity. Git builds use `dev.<12-character-commit>` with `.dirty` for local changes. Pinned archives use a validated full `SATURDAY_BUILD_COMMIT`; local snapshots can use a fingerprint identity `local.<12-hex>`. Without Git or an explicit identity, builds fall back to `development`. Direct source services have no compiled identity.

Run `npm run build` to rebuild both artifacts; restart Vite to refresh a dev server's identity. Production does not need Git. Settings diagnostics, `get_saturday_info`, and `/health` expose build identity; the MCP initialization version is also the build ID. A dirty build is not a reproducible source reference.

### Provisional support matrix

| Area                  | Implementation target / verification limit                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Managed installation  | Private Node/npm, source staging, desktop launcher, optional login startup, manual update/repair/uninstall                                      |
| macOS                 | 14+, Apple silicon/x64 target; isolated managed installation and automated source/browser checks passed on 26.4.1 arm64; other targets pending  |
| Windows               | Windows 11 x64; native runtime, paths/processes, desktop/login, PDF, and failure workflows still need full verification                         |
| Linux                 | Ubuntu 22.04/24.04 x64 with graphical GNOME; runtime, Chrome libraries/fonts, desktop/login, and failure workflows still need full verification |
| Source runtime        | Node.js 22.13+ and npm 10+; verify each advertised runtime explicitly                                                                           |
| Browser/accessibility | Modern desktop browser; full keyboard, zoom, contrast, screen-reader, and platform certification pending                                        |
| Assistant client      | Local stdio MCP; real-client connection/reconnect must be verified separately from protocol tests                                               |

Record exact candidate/build, OS, runtime, browser and client results when claiming platform support. Real device, reboot/login and assistant-client checks remain separate from automated suites.

## Commands and verification

| Command                                                | Purpose                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `npm run setup`                                        | Resumable dependency/PDF/build/storage preparation                                      |
| `npm run dev`                                          | Loopback development server                                                             |
| `npm run open` / `npm run stop` / `npm run restart`    | Control this installation's background UI                                               |
| `npm run start`                                        | Production start with foreground control when creating a server                         |
| `npm run status`                                       | Verify installation/build readiness and actual URL                                      |
| `npm run build` / `npm run build:mcp`                  | Build web and MCP / MCP only                                                            |
| `npm run migrate`                                      | Create the database or apply supported migrations                                       |
| `npm run check`                                        | Generate extension registrations; check Svelte and types                                |
| `npm run lint` / `npm run format`                      | Check / write Prettier formatting                                                       |
| `npm run setup:pdf`                                    | Install Puppeteer's managed Chrome                                                      |
| `npm test`                                             | Build MCP; run service, CLI, process, and protocol tests                                |
| `npm run test:contracts`                               | Check application contracts against actual local SQLite and document adapters           |
| `npm run test:cloudflare`                              | Build shared core and execute its offline Miniflare/workerd harness                     |
| `npm run test:web`                                     | Build production; run HTTP, lifecycle, password, LAN, and available Chrome checks       |
| `npm run test:beta`                                    | Browser workflow, MCP reconnect and PDF review against an existing production build     |
| `npm run verify`                                       | Lint, type checks, unit/contracts, Cloudflare runtime, production tests, browser review |
| `npm run assistant -- config --format json`            | Generate local MCP configuration; also supports TOML                                    |
| `npm run update:check` / `npm run update -- --confirm` | Check / perform a manual application update                                             |
| `npm run repair` / `npm run uninstall -- --confirm`    | Repair installation / uninstall with data retained                                      |

Backup/file commands are in the [agent guide](agent-guide.md#backup-and-recovery-commands); extension commands are in the [extension guide](extension-guide.md).

`npm run check` also runs `npm run check:scripts`, which uses the existing TypeScript dependency to detect unresolved names in `scripts/**/*.mjs`. This is a focused name-resolution check; other JavaScript typing diagnostics remain outside its scope. Installer tests cover fresh managed installation from an empty root as well as repair/reinstallation. The fresh-install test reuses local dependencies while exercising runtime configuration, web/MCP builds, setup, publication, desktop shortcut creation, and UI readiness.

Run checks appropriate to a change. Before sharing a candidate, install Chrome and run `npm run verify`. `test:beta` requires `npm run build` first when run independently. Browser screenshots and failure evidence are written to the printed OS temporary directory. Tests use disposable stores; real Chrome checks need sandboxed browser startup. HTTP and compilation checks do not replace visual or screen-reader review.

The browser review includes a continuous Dashboard-to-job workflow with inline tags, search/sort, stage and history changes, reminders, and an MCP write/reconnect against the same fictional workspace. Its temporary directory retains `verification.json`, screenshots, a representative `release-review.pdf` and its HTML source, plus invalid-PDF failure evidence. Inspect these artifacts separately for presentation quality. Run this review after the build finishes; rebuilding the same output while a test server is running can invalidate its loaded route chunks.

For the optional large-archive case, run `node --max-old-space-size=128 --test tests/files.large.integration.mjs`; allow several GiB of temporary space. It exercises a ZIP and expanded collection above 1 GiB.

## Source map

| Location                                                              | Responsibility                                                                      |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/routes/`                                                         | SvelteKit pages, form actions, HTTP endpoints, and layout                           |
| `src/lib/components/app/`                                             | Shared app UI patterns                                                              |
| `src/lib/components/ui/`                                              | UI primitives                                                                       |
| `src/lib/job-fields.js`, `src/lib/job-search.js`                      | Job field registry and browser-safe search/URL choices                              |
| `src/lib/application/`, `src/lib/domain/`                             | Portable async operation contracts, assistant catalog, validation, types and errors |
| `src/lib/server/application.js`, `local-operations.js`, `platform.js` | Local composition, document stream adaptation and platform capabilities             |
| `src/lib/server/local/`                                               | Local SQLite queries and atomic career operations                                   |
| `src/lib/server/local/workflow.js`                                    | Workflow configuration, starting-stage selection, ordering, and usage guards        |
| `src/lib/server/access-settings.js`, `access-auth.js`                 | Private access preferences, password verification, and browser sessions             |
| `src/lib/server/database.js`, `migrations.js`, `compatibility.js`     | SQLite access, schema, and supported formats                                        |
| `src/lib/server/backups.js`, `src/lib/server/files/`                  | Database/file backups, documents, PDF, journals, and coordinated recovery           |
| `src/lib/server/mcp-server.js`                                        | MCP protocol/error adapters and trusted extension tool registration                 |
| `src/lib/server/installation.js`                                      | Shared descriptor, paths, setup helpers, client configuration, and OS integration   |
| `src/lib/server/server-lifecycle.js`                                  | Owned UI supervisor, readiness, and lifecycle admission                             |
| `src/lib/server/installation-operations.js`                           | Update selection, external controller, publication, repair, and uninstall           |
| `src/lib/server/extensions.js`, `src/lib/extension-ui.js`             | Extension runtime/storage services and public browser exports                       |
| `scripts/`                                                            | Setup/build/run, installer, backup/recovery, and extension commands                 |
| `tests/`                                                              | Service, process, CLI, MCP, HTTP, browser, and UI-convention checks                 |
| `examples/extensions/interview-practice/`                             | Portable extension example                                                          |
| `docs/`                                                               | User, assistant, and contributor guides                                             |

New browser and assistant features use the shared asynchronous application boundary; await its operations before handling results or redirecting. See [Application architecture](application-architecture.md) for transaction, streaming, authorization, platform and future transfer contracts. Host scripts and storage regression fixtures may call local implementations directly; third-party extensions use their public context.

The [Cloudflare and hosted storage guide](cloudflare-storage-contract.md) describes the local compatibility harness and the remaining PostgreSQL/Supabase requirements. Its fixture Worker stays under `tests/fixtures/cloudflare/`; `scripts/cloudflare-build.mjs` guards the portable dependency graph. Miniflare is a pinned development dependency. Run `test:cloudflare` with loopback/process permission; it blocks outbound Worker requests and needs no account, project or credentials. A core harness pass does not establish full-app cloud support.

## Verification scope

`npm run verify` checks formatting, scripts/types, shared operations and MCP, local Cloudflare execution, production HTTP/browser behavior, and document/extension workflows. Tests use disposable stores. Coverage includes populated and empty lists, form drafts and expired sessions, workflow history, deletion recovery, backup integrity, file conflicts, access controls and installation lifecycle failures.

Record the exact candidate build, OS, runtime, browser and command results when reporting verification. Automated checks do not certify physical phones, native keyboards, actual 200% browser zoom, screen readers, reboot/login behavior, other operating systems or a real assistant client's connection. Check those separately on the release candidate; a simulated viewport or protocol test is insufficient.

## Storage contracts

`compatibility.js` and `migrations.js` define supported formats. Package `saturday.storage` metadata must agree with them. Exact schema/manifest validation is required in addition to version checks.

| Store              | Current contract                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Database           | `saturday.database`, schema 1; `app_metadata` holds the dataset UUID                        |
| Files              | `saturday.files`, manifest 1; dataset-bound documents and all Profile designations          |
| Coordinated backup | `saturday.backup-pair`, version 1; validates both actual artifacts and their shared dataset |
| Installation       | `saturday.installation`, version 1; installation ID is distinct from dataset ID             |

Unsupported database schemas, file manifests and backup formats reject without changing the source or live data. Storage versions are independent of the package version. Never alter version records, format identifiers or dataset IDs to bypass compatibility checks.

Jobs, people, tag definitions and both histories use independent positive safe integer IDs. Same-dataset restores retain the higher current/incoming allocator counters. IDs represented by same-dataset job-file folders are also reserved, preventing attachment reassignment after an older database restore. Restoring another dataset uses its identity/counters.

Database and files remain independent. Normal `jobs/<id>` access requires matching dataset identities; user documents and explicit recovery remain available across a mismatch. Add missing refuses cross-dataset merges into populated file collections; Replace installs the incoming collection. Either store can be restored first, with attachment access waiting for a match.

### Jobs and Network

The job registry owns stored field names, UI/MCP mappings, types, limits, access and dependencies. Validation, write adapters, MCP inputs, and backup columns derive from it. User edits cannot write assistant assessment fields; partial edits preserve omitted fields. Current placement is stored as `jobs.current_stage_id`; activity is derived from the referenced workflow stage. History is independent and does not move placement. Workflow stages are included in backup registries, fingerprints and replacement ordering. Stage changes and their milestones commit atomically; corrections cannot remove the sole milestone supporting current placement.

For a new stored field, update the registry, migration, relevant forms, backup validation/fingerprint, and tests together. Keep released field names stable. Freeze the released baseline and append migrations afterward; never migrate original backup files in place.

Search uses bound literal-contains queries, whitelisted sorts, stable ties, read snapshots for counts/pages, and batched related records. Filters combine with AND across categories and OR within categories. UI Jobs defaults to Active; MCP defaults to All. Historical steps include inactive jobs. Dates use the host's local calendar. Filter additions must update validation, URL/chips, controls, service predicates, MCP documentation, and meaningful tests.

Network follows the same validation/query conventions. General notes, relationship notes, and interaction notes are distinct. Link/unlink and interactions do not change job status/history or parent detail timestamps. Interaction dates cannot be future dates; reminders are independent and are not dismissed by interactions. Scope updates by both person and update ID.

### Tags

`job_tags`/`network_tags` store independent definition collections; `job_tag_assignments`/`network_tag_assignments` join owners to definitions with unique pairs and reverse tag indexes. `tags.js` owns shared name normalization and color/contrast helpers; server tag services own validation, collection/owner scope and transactions. Names are unique canonical lowercase ASCII words joined with underscores; UI labels replace underscores with spaces. Store only the name and opaque six-digit hex color, without a separate name key or display field. Backup schema checks, fingerprints, counters and replacement ordering include all four tables.

Merges retain the first ID, union assignments without duplicates and remove the second definition atomically. Definitions and assignments remain independent of job placement/history and person relationships. Assignment changes bump owner timestamps; definition-only edits do not. Parent forms distinguish omitted selections from explicitly empty selections. Tag picker creation is a separate request with parent-draft/pending guards. Regression entry points are `tests/tags.test.mjs` and `tests/tags.integration.mjs`.

### Workflow stages and history

The executable full schema and indexes live in [`migrations.js`](../src/lib/server/migrations.js); do not maintain another SQL copy. `workflow_stages` stores stable IDs, names, ordering, closure/archive flags and timestamps. `jobs.current_stage_id` references current placement; nullable `job_updates.stage_id` distinguishes milestones from general notes. There is no stored job activity flag, fixed event enum, success classification, initial-stage flag or revision counter.

Available stages sort by `is_closed, sort_order, id`; archived rows follow available rows in configuration. The first available open stage starts new jobs, and defaults are seeded only for a new database. Default open progression is New → Applied → Screening → Interview → Offer; Accepted, Rejected and Dismissed are editable closed destinations. Names and display order never enforce transitions: moves may go backward, skip stages or close from any stage.

Stage names are trimmed, 1–80 characters and unique among available stages using the shared trim/lowercase normalization. Archived names may collide; restore requires an available name and retains the ID. Add/restore/unused closure changes append within the stage's type. Up/Down reads current membership, moves one place within the same type and normalizes order in a write transaction. Field-specific actions preserve unrelated/concurrently added data. Starting-stage changes require confirmation and affect future jobs only. Closure cannot change while any job/history references the stage; archive requires no current occupants and must leave an available open stage. There is no permanent stage deletion. Workflow configuration uses ordinary authenticated browser access, including allowed LAN browsers; it is not host-only maintenance and has no MCP mutation tools.

Creation saves starting placement plus its initial milestone atomically. Change stage validates the latest job and available destination, accepts today/past dates, and commits placement plus one milestone together. Same-stage requests change neither timestamps nor history. Last committed moves win, retaining both actual moves' milestones; ordinary detail edits cannot overwrite placement. History-only changes never move a job, but refresh its `updated_at`. Notes require text; milestones may omit notes and use archived stages or confirmed future dates. Scheduled milestones count in distinct-job historical totals without advancing placement. History correction/deletion rechecks ownership and latest placement transactionally and cannot remove the sole milestone supporting that placement; date/note-only corrections remain allowed. Reads never reconstruct placement from history, and clients inspect authoritative state before manually retrying uncertain writes.

Database backups include every stage, job pointer, history entry, dataset identity and allocator counter. Restore validates available names/types/order, at least one available open stage, available current destinations and supporting milestones. Remove dependent records before replacing all stages, including staging defaults; insert incoming stages before jobs/history. Workflow changes invalidate prepared restores through existing fingerprints. Test fresh and populated targets with different stage IDs and custom/archived stages, preserving Network, Profile, file namespaces and counters. Reject unsupported formats unchanged; never reset storage automatically.

### Parent-record deletion

`deleteNetwork` removes the person's interaction/link rows and parent in one transaction. `deleteJob` delegates to `job-deletion.js`: acquire the database write gate then file lock, validate dataset/scope, durably publish a private `job-deletion.json` intent, delete job history/links/parent in SQLite, then remove scoped manifest entries and bytes through the existing file journal. All mutations require exact ID, dataset identity and explicit confirmation. Counts are informational; execution includes the latest children/documents. There are no deletion snapshots, revision columns or preview services.

MCP `delete_job` and `delete_network` are thin adapters to those services with destructive/non-idempotent annotations and structured errors. Normal `get_job` and `get_network` results expose the dataset identity needed for deletion; no separate preview mode exists. Protocol tests exercise confirmation, execution-time scope, dataset/storage failures and reconnect recovery using the built stdio entry. User authorization is required independently of the confirmation flag; neither tool executes host recovery commands or bypasses availability guards.

Before the database commit, rollback leaves files untouched. After commit, cleanup finishes forward. Recovery discards an intent if its job survives, otherwise completes its recorded document removal. `job-deletion-state.js` uses async-local ownership and shared availability guards across database/file access; pending operations block conflicting writes, backup/restore and reads, including requests queued before the intent appeared. Only the owning coordinator/recovery may bypass its gate. Preserve restrictive foreign keys, ID sequences, unrelated records/files/Profile and extension-owned data. Never report success before cleanup finishes or prune a pending intent as a temporary file. Startup and data CLIs attempt recognized recovery; the host command is documented in the [agent guide](agent-guide.md#file-storage-and-recovery-commands).

### Documents and recovery

Use `files/` services for every file mutation; routes/tools must not write bytes or the manifest directly. Publication checks hashes/conflict tokens and journals changes. Unsupported manifests are rejected before publication without rewriting metadata. Copies and PDFs get independent IDs; Profile designations refer to stable document IDs.

Coordinated restore acquires the SQLite write gate before the file lock and persists cross-store recovery state. Interrupted sessions block normal access until offline recovery. Backups include creator-build and dataset metadata; fingerprints must include all stored fields. Previews expire, reject relevant changes, and are single-use. Preserve recovery copies after uncertain failures.

Manual backup orchestration lives in `files/pairs.js`. Database/files/both appear in grouped history; combined downloads/imports stream ZIPs while retaining independent artifact formats. Archives use the configured backup directories, normally `backups/database/` and `backups/files/` beside the stores. Backup creation is manual; there is no scheduling or retention worker. Core backups exclude extension databases.

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

The application icons shown by desktop shortcuts live in `static/icons/` (`saturday.ico` for Windows, `saturday.icns` for macOS, `saturday.png` for Linux). They are generated from `src/lib/assets/favicon.svg` by `node scripts/build-icons.mjs` (small sizes use a simplified mark, and the `.icns` sits inside Apple's margin with a soft shadow); rerun it and commit the output when the mark changes. Shortcuts are named **Saturday** with the tooltip “Saturday Career Dashboard”, using “Saturday (2)” when another item has the name.

Documentation images belong in `docs/images/`, with relative links, descriptive alt text, and reasonably sized PNGs. Run Prettier on changed documentation. Extension API changes must also update the [extension guide](extension-guide.md); generated extension registries are ignored outputs and must not be edited manually.

## Development branches

After the first release, `main` contains verified stable releases and `develop` integrates upcoming work. Start short-lived `feature/<topic>`, `fix/<topic>` or `docs/<topic>` branches from `develop`, merge reviewed and tested changes back, then prepare a release from that integration state. Merge the verified release into `main` and tag its exact published commit. Carry any release preparation changes back to `develop`.

For an urgent released-version fix, branch `hotfix/<topic>` from released `main`, test and release a patch, then merge the fix into both `main` and `develop`. Released installations discover verified numeric GitHub releases; `develop` and topic branches are not updater channels. Until the first release, local preparation commits may remain on the current branch.

Repository setup requires separate authorized actions:

- Create `develop` from the verified first-release commit and push it.
- Protect `main` and `develop` with reviewed changes and the agreed required verification, while retaining an explicit emergency process.
- Set the repository's default/contribution branch deliberately and verify permissions and merge settings.
- Confirm the official release tag/asset still resolves to the verified `main` commit. Branch creation/protection alone does not publish an update.

## Prepare a release

The package/lockfile root versions must agree. Storage/API versions are separate and released migrations remain immutable. Update the [release notes](release-notes.md), run `npm run release:freeze` for the new app version, then:

1. Run relevant checks and commit the release source. Keep generated release assets outside the source tree; an asset cannot contain the SHA of a commit that also contains that asset.
2. Run `npm run verify` against the exact clean commit, rebuilding web/MCP and their embedded guides. Record its full SHA, environment, results and manual/platform limitations. A source fix requires a new candidate and another verification of affected behavior.
3. Generate metadata with the commands below, replacing the full SHA and output paths. `--verified-commit` explicitly attests that verification was completed for that revision; the generator does not run tests or infer human acceptance.
4. Check the generated asset and retain its printed SHA-256 digest. The checker requires the same clean source, matching package/storage/API declarations and release/tag identity. It never overwrites an existing output.
5. After separate publication authorization, prepare the matching numeric tag and ordinary GitHub release titled **Saturday 0.1.0 — Private Beta**, uploading `saturday-release.json`. The updater ignores GitHub drafts/prereleases and suffixed versions. Verify GitHub's asset digest, tag commit, package version and actual installed discovery after publication. No helper here creates or pushes a tag/release.

```sh
node scripts/release.mjs generate --commit <full-sha> --verified-commit <full-sha> --tag v0.1.0 --output /absolute/outside/source/saturday-release.json
node scripts/release.mjs check --commit <full-sha> --verified-commit <full-sha> --tag v0.1.0 --metadata /absolute/outside/source/saturday-release.json
```

Generation/checking uses only Node built-ins and the same distribution validator as the updater. It refuses dirty/unidentified revisions, package/lockfile disagreement, unsupported declarations and mismatched tag/package/source metadata. It preserves the updater's existing asset-digest and exact-commit checks. Core commands and privacy boundaries stay the same after release; rebuild and reconnect local MCP after updating, then compare identities and use its bundled help tools.

Keep a candidate receipt alongside the generated asset, outside committed source: full source commit/tree, application/storage/API versions, OS/CPU/runtime/browser, verification command/results/skips, log and artifact hashes, known limitations and pending manual checks. The receipt and asset identify the committed revision; adding their own final SHA to that same commit is impossible. Rebuild and repeat affected checks after a source change, then run full verification on the final clean candidate before generating its asset. Preserve earlier receipts as historical evidence rather than relabeling them.

Once a candidate is frozen, limit changes to reproduced blockers until its release decision. Local automated completion and manual acceptance are separate: real desktop/login, Windows/Ubuntu, actual assistant clients, physical phones, PDF appearance and accessibility remain pending until observed. Publication and remote branch/protection changes require separate authorization. A checkout without a hosted CI workflow cannot claim enforced remote verification; configure and observe actual checks before making them required branch-protection checks.
