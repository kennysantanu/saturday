# Application and platform boundaries

Saturday currently runs as a personal Node application with SQLite and local files. The shared core separates career operations from that runtime. It does not provide cloud deployment, native apps, remote MCP, provider sign-in or a built-in chat assistant.

The shared modules also execute in a local Cloudflare workerd harness. See the [Cloudflare and hosted storage contracts](cloudflare-storage-contract.md) for commands, verification scope and requirements for a future PostgreSQL/private-object-storage implementation.

## Calling an operation

Web loaders/actions use `src/lib/server/application.js`. The local stdio adapter supplies its assistant application to `createAssistantCatalog` in `src/lib/application/assistant-catalog.js`. Both reach the same operations and local persistence code. Routes still own HTTP status, redirects, form failures, authentication and navigation. MCP still owns protocol responses, error envelopes and trusted extension registration.

`src/lib/application/index.js` is the portable entry. `createApplication(implementations, execution, capabilities)` binds complete operation implementations to a trusted execution context. All exposed methods return promises, including reads backed by synchronous SQLite. Callers must await them inside error handling before reading a result, redirecting or reporting success.

The operation names and policies live in `application/operations.js`. An implementation receives `(context, ...arguments)` and returns a plain value or a promise of that value. The public method accepts only the arguments; it does not accept a caller-supplied context. Domain input/result, document, credential and transfer types are in `application/contracts.ts` and `application/transfer.ts`. Shared Zod validation, calendar rules and errors are in `src/lib/domain/`. Keep those modules free of Node, installation paths, SvelteKit and extension imports.

The local implementation is `server/local-operations.js`, backed by `server/local/` for SQLite queries and `server/files/` for document/recovery coordination. Older server service entry points re-export the local implementations for scripts, trusted extensions and storage fixtures; new web/assistant code should use the application boundary.

## Transactions and storage implementations

An operation is the unit of persistence, not an individual query. A PostgreSQL implementation must implement the same operation and use a database transaction or server-side function for multi-record changes. A native SQLite implementation can use its platform's transaction API. Neither needs to emulate a remote `prepare()` connection.

Preserve these atomic writes:

- Create a job with its starting placement, initial milestone and tags.
- Change placement and record its milestone, including an optional reminder.
- Add history/interaction with its optional reminder.
- Replace tag assignments, merge tags and remove dependent record data.

Database-dependent validation remains inside the operation's transaction. Reuse the domain validators for IDs, dates, optional/null values and field rules. Preserve stable IDs, allocation high-water marks, ownership checks, last committed stage placement, history evidence and dataset identity. Do not split an atomic operation into independent REST writes.

The local `withDatabase` and `inTransaction` APIs are synchronous. They reject a returned promise instead of committing or closing while work is pending. Await application calls outside those callbacks. File-coordinated job deletion and paired restore retain their existing asynchronous coordinators, availability gates, durable journals and forward recovery; they are not ordinary SQLite-only transactions.

## Actor, permissions and assistant commands

The execution actor is `manual` or `assistant`; it describes provenance, not authorization. The authenticated browser composition supplies manual context and the trusted local stdio composition supplies assistant context. Database records and document metadata persist the same `manual` and `assistant` values, independently of the assistant transport.

Permissions are supplied separately by trusted composition code. Assessment writes, record/document deletion, Profile assignment, recovery writes and workflow configuration have explicit policies. A tool argument, form field, document or returned model message cannot grant these permissions by supplying an actor or permission list. Browser authentication stays in the web adapter. Local host controls additionally retain origin, session and local-browser ownership checks; no host-administration or password-recovery command is exposed in the assistant catalog.

`createAssistantCatalog(application, capabilities)` provides the shared names, descriptions, Zod schemas, annotations and validated `execute(input)` handlers. It omits commands requiring unsupported capabilities. Calling an operation directly still enforces capabilities and permissions. Its results are plain values; a future provider adapter can expose them without importing the MCP SDK. The current MCP adapter preserves its existing response shapes.

Destructive tool confirmation remains an acknowledgement, not proof of the user's authorization. The assistant/client must obtain the user's authorization independently, preserve conflict tokens and inspect state after uncertain writes. There are no automatic mutation retries.

Provider identity, inference and credentials stay outside career operations. `ProviderConnection` holds a private credential reference; a platform `CredentialStore` would resolve it outside the browser bundle, career tables, documents, logs and portable backups. A native implementation must use secure platform storage. Browser sign-in does not authenticate an AI provider or authorize subscription inference. No provider connection implementation or chat persistence is supplied yet.

## Documents and bytes

`DocumentStore` groups listing, metadata/text reads, scoped byte reads/uploads, creation, editing, copying, deletion and Profile assignments. IDs and logical keys such as `documents/resume.md` and `jobs/12/cover-letter.html` identify content independently of its physical path. Record scopes retain dataset and parent checks.

Portable uploads accept a Web `ReadableStream<Uint8Array>` or an asynchronous iterable of byte chunks. Downloads return a Web stream with size and document metadata. Cancellation must release resources. The local adapter converts Node streams; HTTP handlers build their own responses. Large binary files are not converted to strings, base64 or one in-memory buffer. Text editing keeps its existing bounded UTF-8 contract.

Implementations must preserve content hashes, per-document and catalog conflict tokens, filename checks, Profile format checks and deletion acknowledgements. The local store alone owns absolute paths, file descriptors, directory locks, atomic rename and filesystem recovery. Backup export to an arbitrary local path and recovery of unmatched attachments are explicit local capabilities.

## Platform capabilities and lifecycle

Capabilities describe implemented services; permissions describe what a caller may do. `capabilityStatus` returns `{ capability, available }` and a stable `unsupported_capability` code/message when unavailable. Operations reject unsupported calls before invoking implementation code. Future UI should omit unavailable sections or display their capability reason rather than attempt a local fallback.

The local capability map and host service bindings are in `server/platform.js`. They cover host controls/installation, local file operations, PDF, database/file/paired recovery, extensions and stdio assistant transport. PDF capability means the implementation exists; `pdfReadiness` separately reports whether Chrome is installed and usable. Trusted Node extensions remain a local/server feature.

Process-local browser sessions, rate limits, maintenance leases, supervisor tokens, directory locks, recovery journals and Chrome processes remain local services. They are not portable business state. A hosted edition must supply durable authentication, authorization, rate limits and coordination valid across concurrent requests/instances. A native edition must supply equivalent local access, secure credential storage, file lifecycle and recovery. Neither may treat a process-local flag as distributed exclusion or silently substitute an unsupported recovery procedure. These implementations remain future work.

## Deployment transfer

`application/transfer.ts` defines a future logical transfer source: dataset/schema identity, record collections, stable IDs, allocation counters, logical document metadata with streamed bytes, and Profile assignments. Its collections cover stages, jobs/history, people/relationships/interactions, reminders, tags and assignments. Preserve nulls, fixed calendar schedules and referential integrity; validate hashes and all references before publishing a destination.

The transfer excludes installation paths/settings, browser sessions, provider credentials, process leases, journals and trusted extension state. Conflict tokens are destination-local concurrency guards and should be regenerated after validated import. Import must either publish a complete validated destination or preserve the previous one; there is no partial best-effort merge or synchronization.

This contract does not implement export/import. Existing database, file and combined backups keep working locally. A SQLite snapshot cannot be restored directly into PostgreSQL. A complete cross-backend transfer requires a separate exporter/importer and target-specific atomic publication.
