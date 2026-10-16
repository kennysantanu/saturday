# Agent setup and recovery guide

Use this guide for authorized local installation, maintenance, and recovery. The [installation guide](installation-guide.md) owns commands and platform requirements; the [assistant guide](assistant-guide.md) owns client setup; the [MCP reference](mcp-reference.md) owns data-tool contracts.

## Establish the workspace

1. Confirm local filesystem/process access and the client's execution mode. A hosted-only chat cannot launch Saturday's stdio server; provide manual installation instructions when local execution is unavailable. MCP data access alone does not grant process execution.
2. Inspect the selected revision's README and installers. Find an existing descriptor before creating a workspace. Preserve data paths, client settings, and login choices; do not relocate/reset stores or bypass OS restrictions without the user's instruction.
3. Use the [development installer](installation-guide.md#development-installer) for normal installation or [source setup](installation-guide.md#source-checkout) for development. Use the same descriptor and its runtime for all commands, following [managed command invocation](installation-guide.md#running-commands-for-a-managed-installation).
4. Treat missing initialized storage, locks, and publication journals as recovery conditions. Preserve them and inspect the error; do not delete them to force a fresh setup.

## Browser password settings

Browser password login is optional and independent of trusted local stdio MCP. Prefer opening **Settings → Password login** for private user entry. Do not ask the user to paste a password into chat or store it in assistant configuration.

Forgotten-password recovery is a host command-line operation. Saturday's MCP tools provide no authentication management or command execution. To help a locked-out user, use a separate terminal/process capability that executes on the computer running Saturday, following [Locked out of Saturday](installation-guide.md#locked-out-of-saturday). If you have only Saturday MCP access, explain that limitation and give the user the host-terminal steps. Do not attempt lockout recovery through MCP document writes, backup restoration, browser requests, or edits to access/installation files. A signed-in user who knows the current password can still disable protection through Settings on the host computer, with confirmation.

For explicitly authorized maintenance, use the descriptor-aware [access commands](installation-guide.md#password-login-and-local-recovery). They stop and verify the owned web process before changing credentials/inactivity/recovery, coordinate with installation maintenance, and leave it stopped. Reopen using the desktop shortcut afterward. Use `status --json` for nonsecret state. Password setting accepts protected JSON stdin only; recovery requires `--confirm`, removes UI protection and saves LAN off, preserving records. Do not edit `access.json` or its initialization marker to bypass a missing/corrupt store.

## LAN access maintenance

LAN and password settings are independent. For an explicitly authorized preference change, use the descriptor-aware [LAN commands](installation-guide.md#lan-access-and-startup) from the server computer: `lan --enable --confirm` or `lan --disable`. Enable confirmation accepts reachable-device access and the unencrypted HTTP transport; it does not enable a password. These commands save a startup preference without stopping the UI or changing live login sessions. Status reports saved/effective mode, restart required, and candidate addresses. Restart separately through the owned lifecycle when authorized; opening an already-running instance only reuses it. Do not change firewall/router settings or use forwarded headers to bypass host-only controls. MCP does not expose LAN/authentication management.

## Verify installation and MCP

1. Open through the shared lifecycle commands or shortcut. Wait for installation/build readiness, not merely HTTP success; [status checks](installation-guide.md#open-stop-and-restart) verify `/health` identity and the actual URL.
2. Follow the [assistant connection steps](assistant-guide.md#connect). Within the user's authorization, change only Saturday's client entry, preserve unrelated settings, and retain a private recovery copy. Respect client-policy denials. Copying a configuration does not establish a connection.
3. Reconnect and call `get_saturday_info`. Compare `installation_id`, `dataset_id`, and `build.id` with Settings. Read a known numbered job when available; do not create a record merely to test access. Empty workspaces support the identity call.
4. If a real client call is unavailable, report verification pending. A protocol smoke test, build, or installer receipt does not prove client access. Optional PDF or shortcut failures should be reported separately from app readiness.

For candidate verification on disposable data, also exercise tool discovery, job create/read/edit/search, person linking, document editing/designations, validation failure, previewed restore, and reconnect after rebuilding. Record client/version/execution mode and build. This broader test is separate from verifying access to a user's workspace.

## Maintain an existing installation

Use the installation guide's [update](installation-guide.md#updates), [repair](installation-guide.md#repair), and [uninstall](installation-guide.md#uninstall) workflows. Review the update target within the user's authorization and pass its check ID to pin the reviewed candidate. Disconnect client-owned MCP before publication; never bypass a live-writer lease.

Wait for persisted operation status `complete`; a background receipt acknowledges work only. Check UI readiness separately. After updates, regenerate client configuration if paths changed, reconnect, and repeat identity/read verification. A UI-only restart does not require reconnecting MCP.

Inspect state before retrying any uncertain write, restore, or deletion. Lifecycle controls can be retried after active operations finish. Preserve recovery snapshots and logs; never blindly downgrade over migrated storage. Before uninstall, remove only the authorized matching client entry while the runtime still exists. Data deletion requires review of exact directories and explicit authorization; report retained paths and partial cleanup.

## Report completion

Report the actual browser URL and readiness, descriptor/data location, PDF/shortcut result where relevant, client configuration prepared, and actual MCP verification or pending/unavailable status. Include client/version/execution mode and any policy/platform limitation. Share only needed local paths; never include controller tokens, backup contents, or unrelated client settings.

## Backup and recovery commands

Use the same descriptor as the app; see [managed command invocation](installation-guide.md#running-commands-for-a-managed-installation). Local path arguments resolve from the caller's working directory. Database backup/restore scripts support `--json`; exit codes are 0 for success, 2 for invalid arguments, and 1 for operational failure.

```sh
npm run backup -- --contents all --json
npm run backup -- list --json
npm run backup -- export <backup-id> --contents all --output ./career-backup.zip --json
npm run backup -- import ./career-backup.zip --json
npm run backup -- delete <backup-id> --contents all --confirm --json
```

Contents can be `all`, `database`, or `files`. CLI/MCP defaults to database-only; the UI defaults to both. Export retains the managed copy and never overwrites an existing destination. Combined exports are importable ZIPs. Delete requires explicit authorization and rejects active restore sources. There is no scheduler or retention worker; extension databases require [independent backups](extension-guide.md#independent-backup-and-restore).

For a database-only export and restore:

```sh
npm run backup -- --output ./career-backup.sqlite --json
npm run restore -- ./career-backup.sqlite --inspect --json
npm run restore -- --restore-id <preview-id> --confirm --json
```

Show the preview and obtain authorization before replacing data. Record the returned recovery backup path. Previews expire after ten minutes, become stale on relevant changes, and are single-use. After an interrupted response, inspect current state before preparing another restore. Never send backups or private paths to unrelated services.

## File storage and recovery commands

The file root contains `manifest.json`, `documents/`, and lazy `jobs/<id>/` folders. State/journals and archives are outside that root. Never edit bytes or the manifest directly; use storage services to preserve hashes, identity, and conflict tokens.

```sh
npm run files -- backup
npm run files -- list
npm run files -- import ./files.zip
npm run files -- export <backup-id> ./export.zip
npm run files -- prepare <backup-id> --replace
npm run files -- restore <preview-id> --confirm
npm run files -- pair
npm run files -- prepare-pair <file-backup-id>
npm run files -- restore-pair <preview-id> --confirm
```

File commands return JSON. Omit `--replace` for Add missing; conflicts block additive recovery. Pair commands capture/restore database and files together. Show both previews before authorized replacement.

File ZIPs stream through private staging with no total-size cap; disk/proxy constraints still apply. Manifest metadata has a 16 MiB bound. Individual uploads are limited to 25 MiB, editable UTF-8 text to 1 MiB, and database restore artifacts to 100 MiB. For Chrome/PDF setup, see the [installation guide](installation-guide.md#installer-options-and-retries).

For a missing/malformed manifest, stop all web/MCP processes and preserve the original tree before:

```sh
npm run files -- recover ./known-good.zip --confirm
```

Recovery validates the archive and retains the damaged tree in private sibling recovery directories. Inspect returned paths and recovered contents before restarting or deleting recovery copies. For an interrupted coordinated restore, stop all processes and run `npm run files -- recover-pair --confirm`. Never remove the blocking marker to bypass recovery.

Online database restore requires a healthy target. Offline recovery of a corrupt database requires stopping web/MCP and preserving the original database and SQLite sidecars. Newer schemas/manifests require a compatible application; never alter migration records or dataset IDs to bypass validation.

## Record identity and extensions

Use the [MCP reference](mcp-reference.md#numeric-references-and-recovery-namespaces) for IDs, dataset boundaries, and mutation safeguards. Resolve ambiguous job/person references before writes, and preserve files across a dataset mismatch.

For a requested extension, read the [extension guide](extension-guide.md) and [design guide](design-guide.md), use public imports, and verify on disposable data. Obtain explicit trust before installing executable code. Preserve retained extension data and independent backups across disable, removal, and update.
