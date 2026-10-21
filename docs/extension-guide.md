# Extensions: authoring and operation

Extensions add one page, an optional independent SQLite database, and zero or more MCP tools. They run trusted JavaScript with Saturday’s access; they are not sandboxed. Inspect source before approving installation. API version 1 requires the same Node/Svelte environment as Saturday. No extension-specific dependencies, separate router, or private core imports are supported.

## Try Interview Practice

From Saturday’s source checkout, stop the UI (`npm run stop`) and disconnect all Saturday MCP clients, then run:

```sh
npm run extension -- install ./examples/extensions/interview-practice --trust
npm run open
```

Installation copies a snapshot, builds both web and MCP outputs in staging, initializes a candidate database, and publishes the results. It enables the individual extension but leaves the Settings master switch unchanged. In **Settings → Extensions**, enable extensions and save. The **Extensions** navigation item appears. Open Interview Practice, add a question, select it, and click **Practice**. Practice hides the saved answer; **Show saved answer** reveals it. A draft replaces the saved answer only through **Save answer**. Unsaved drafts are protected when navigating away.

Reconnect your assistant after installing code. The five tools are named `extension_interview_practice_list_questions`, `get_question`, `create_question`, `edit_question`, and `delete_question`, each with the same `extension_interview_practice_` prefix. UI and MCP share the question services and validation. Edits/deletes require the current revision and `data_token` returned by `get_question`; deletion also requires `confirm: true`. Suggestions alone must not save an answer. On an uncertain write response, inspect the bank before retrying.

The sample in `examples/extensions/interview-practice` is a complete portable package. Copy its contents to a new repository, change its ID/name, and implement only the requested feature. Saturday does not publish repositories.

## Package contract

The root must contain `saturday-extension.json`:

```json
{
	"manifestVersion": 1,
	"id": "interview-practice",
	"name": "Interview Practice",
	"description": "A question bank and saved answers.",
	"version": "0.1.0",
	"apiVersion": 1,
	"page": "page.svelte",
	"server": "server.js",
	"database": true,
	"mcp": ["list_questions", "get_question", "create_question", "edit_question", "delete_question"]
}
```

IDs are lowercase kebab case, at most 40 characters. Local tool names use lowercase letters, digits and underscores, at most 40 characters. Saturday prefixes tools with `extension_<id with underscores>_`. IDs cannot change in an update. Any tool-name collision across installed extensions is rejected before activation. Entry points must be ordinary relative files in the package. Symlinks, unknown manifest fields, unsupported API versions, private imports, and client imports of server modules are rejected. `.git` and `node_modules` are excluded from snapshots. The package fingerprint covers its retained files, including documentation.

`page.svelte` receives `data` and `form` props inside Saturday’s layout. It owns one page’s markup. Use `$lib/extension-ui.js` to import existing `PageShell`, `PageHeader`, `SectionCard`, `Field`, `Notice`, `FilterBar`, `Pagination`, `ConfirmDialog`, `UnsavedGuard`, `UnsavedChanges`, `Button`, `Input`, `Textarea`, and `enhance`. Read [the design guide](design-guide.md). Other supported imports are package-relative files, `svelte`, `zod`, and individual `@lucide/svelte/icons/...` imports. The sample demonstrates explicit forms and an unsaved-change guard. Do not import private components or server modules in the browser.

`Pagination` also accepts optional `compact={true}` for icon Previous/Next controls and a short page count. Its default keeps the visible Previous/Next labels. Give each instance a descriptive `label`; compact controls retain accessible names and tooltips.

`ConfirmDialog` accepts optional `formAction` and `formNoValidate` when a confirmed action shares an existing form. For example, deletion can submit a separate action without validating unrelated edit fields. Both default to ordinary form submission behavior.

The optional server entry exports:

- `load({ url }, ctx)` returns serializable page data. Search/pagination/selection can use URL parameters.
- `actions` maps local operation names to `(input, ctx)` functions. Submit POST to `?/run` with a hidden `operation`. Inputs are form strings; the host converts `confirm="true"` to boolean. Validate at the service boundary. Failures return `form.extensionError` and `form.values`; successful writes redirect with a toast.
- `tools` maps every manifest MCP name to `{ description, inputSchema, annotations, handler(input, ctx) }`. `inputSchema` is a Zod schema; `annotations.readOnlyHint` is required. Declare destructive/idempotent/open-world behavior accurately. Tools and actions should call the same functions, as the sample does.
- `migrations` is an ordered array of `{ name, up(db) }` when `database` is true. Append migrations; never reorder or change applied names/semantics. `up` must be synchronous, deterministic from a fresh database, and operate on the extension’s own tables only. Install/restore verifies the database structure against those migrations, rejecting unexpected tables/triggers or altered columns. Candidate migrations run in one transaction before install/update/restore publication. Normal requests verify compatibility rather than run migrations.

`ctx` supplies `id`, `reject(code, message)`, `dataToken()`, and `database(fn)` for database-owning extensions. The callback is synchronous, receives a temporary `DatabaseSync`, and must not retain it or change journal mode. The host closes it after every callback and serializes UI, MCP, backup and restore through one cross-process extension lock. Use bound SQL parameters, explicit transactions for multi-statement writes, revision checks, and positive integer IDs. Return `ctx.dataToken()` with edit snapshots and require/check it for edits/deletes; restore changes this token so pre-restore editors cannot overwrite restored data even if revision numbers coincide. The host owns `extension_metadata` and `extension_migrations`; do not alter them.

`ctx.core` exposes reads: `jobs.get/search`, `networks.get/list`, `documents.get/list`, and `dataset()`. Core methods use their existing service arguments; see the [MCP reference](mcp-reference.md) and corresponding services for field names. `jobs.reference(record)` and `networks.reference(record)` create `{ dataset_id, id }`; their `resolve(reference)` returns null after a core dataset replacement. Store that pair for durable references, and show missing records gracefully. Do not persist a core numeric ID alone, or read/write core tables directly. Core writes, extension-owned files and background tasks are outside API 1.

## Installation and lifecycle

Commands below run from a source checkout. For a managed installation, use its descriptor’s Node with `<code_root>/scripts/extensions.mjs` and set `SATURDAY_INSTALLATION_PATH`; see [managed command invocation](installation-guide.md#running-commands-for-a-managed-installation). Code installation/update builds the host app, so retain its build dependencies.

```sh
npm run extension -- install <local-folder> --trust
npm run extension -- install <git-url> --ref <tag-or-commit> --trust
npm run extension -- update <extension-id> --ref <tag-or-commit> --trust
npm run extension -- list
npm run extension -- enable <extension-id>
npm run extension -- disable <extension-id>
npm run extension -- uninstall <extension-id>
```

Git URLs support HTTPS, SSH, `git@...`, and `file://` repositories. Clone resolves a commit and records it; updates are explicit. No automatic branch tracking, submodule installation or package install scripts run. Local sources are copied, not linked. Preserve the source repository: a data archive cannot reconstruct it.

Stop the web server and MCP processes for install/update/uninstall/recovery. PID leases reject code changes while a registered runtime is alive. Compile errors or candidate migration errors leave the previous catalog/code/database/build in place. Publication retains previous objects behind a durable recovery journal. Interrupted publication blocks extension execution; stop processes and run `npm run extension -- recover` to restore the previous installation. Preserve the journal and retained files if recovery fails. Candidate build diagnostics are retained in the state directory’s `last-install-error.log`. The core database and Documents are not replaced.

Enable/disable requires no build and retains data. The master switch hides navigation and blocks all extension pages/actions/tools, while retaining individual choices. The directory remains reachable from Settings for management/recovery. MCP polls persisted state once per second and announces tool-list changes. Calls recheck state immediately; if a client caches tools, reconnect. Code installs/updates always require restart/reconnect.

The directory provides Open, Enable/Disable, Back up, Restore, and confirmed Remove. UI removal disables immediately and marks removal pending; stop Saturday and complete it with the uninstall command. Uninstall removes managed source and retains databases/backups; run `npm run build` before restarting to remove unused compiled code. Reinstall of the same ID reconnects retained data only if compatible. Updates preserve a disabled individual state. An older version cannot downgrade a newer schema.

## Independent backup and restore

Core database/files backups exclude extension databases. Extension backup contains only `manifest.json` and a consistent SQLite snapshot; never code. Metadata includes extension/API/schema version, data identity, source commit or local fingerprint, producing core dataset identity, date and checksums. Archives are streamed and have no configured size limit; disk space still matters.

```sh
npm run extension -- backup <extension-id>
npm run extension -- backups
npm run extension -- import <archive.zip>
npm run extension -- preview <extension-id> <backup-id>
npm run extension -- restore <preview-id> --confirm
```

Backups work while disabled and for retained data after uninstall. Restore requires installed, built compatible code. The directory downloads/imports archives and previews source/installed versions, schemas and table counts. A different core dataset means stored references remain unresolved. Confirmation replaces only the extension database, saves a recovery backup, and expires the preview. For the same data identity, SQLite AUTOINCREMENT counters retain their larger current values so older backups do not reuse previously allocated record numbers. A changed database/code/archive or a preview older than ten minutes requires a new preview. Foreign IDs, newer schemas, malformed ZIP paths/entries, SQLite integrity failures and checksum mismatches are rejected. A failed publication leaves retained original data and an explicit recovery journal; use offline `recover` before proceeding.

Source defaults are `extensions/<id>/` for copied code, `data/extensions/catalog.json`, `data/extensions/<id>/database.sqlite`, and `data/extensions.backups/`. Extension state defaults beside the core database; code defaults under the project root. Managed paths come from the installation descriptor. Before source setup, `SATURDAY_EXTENSIONS_PATH` and `SATURDAY_EXTENSION_STATE_PATH` can select disposable stores; an existing descriptor rejects conflicting overrides. `identity.json` preserves producing code provenance for retained data. The CLI loads the matching compiled registry from `build/mcp/extensions.js`, so it uses the same installed server code as the running adapters. Generated registries in `src/lib/*extensions.generated.js` and `src/lib/server/extensions.generated.js` are ignored and regenerated on dev/build/check; never edit them. The bundled sample is compiled as a starter but cannot execute until installed and enabled.

## Develop and verify

A coding agent should read this guide and the design guide, copy the sample, implement only the requested page/services/tools, use public contracts, and test on disposable stores. Data-only MCP access cannot author/install code: filesystem and process access are required, with explicit trust from the user.

Run focused checks during development and `npm run verify` before sharing a candidate. Before installing a new extension on real data, test install/update, failed builds and migrations, enable/disable, UI and MCP validation, stale revisions, pagination, backup export/import/restore, recovery, and uninstall/reinstall. Review mobile, keyboard, focus, dark mode and zoom. Update this guide and API compatibility notes alongside public contract changes. Hosted CI is not required.

Handled module/render/tool errors are scoped to the extension; core pages/tools remain available. Trusted code can still exit a process or exhaust memory. On “unavailable,” inspect the manifest, exports and build fingerprint; on schema mismatch, install compatible code rather than delete data; on stale MCP discovery, reconnect; on pending removal or a recovery journal, follow the offline commands above. Do not automatically retry uncertain destructive operations.
