# Frozen Saturday 0.1.0 compatibility data

These fictional artifacts were produced from source commit `688e1456f9e5e398bfb57aa7b206ec6fbb76d4e5`, app `0.1.0`, database schema 1 and file manifest 1. They contain two jobs, a custom stage and independent history, a person/link/interaction, active and dismissed reminders, separate colored tags, all five Profile selections and a job document. Generation used the isolated private Node `24.21.0`. The artifacts contain no credentials, real records or machine-specific paths. The producer uses source services; backup creator build identity is therefore `development`, with exact source/app provenance recorded separately in `expected.json`.

`database.sqlite` and `files/` are the populated stores. `backups/database.sqlite`, `backups/files.zip` and `backups/combined.zip` represent independent and coordinated recovery. `expected.json` records rows/IDs, allocator values, dataset identity, document hashes, Profile references and SHA-256 hashes for every original artifact. Its hashes deliberately exclude itself and this README.

Tests consume these files without modification. They never regenerate them from the current schema. Retain them unchanged after release; future migrations and restore code must continue to read this baseline. New release fixtures belong in another directory with their own provenance.

For an explicitly requested reproduction into a **new** directory, use the verified source snapshot and Node version that produced this baseline:

```sh
node scripts/create-release-fixtures.mjs --source /absolute/verified/source --commit 688e1456f9e5e398bfb57aa7b206ec6fbb76d4e5 --output /absolute/new/fixture-directory
```

The reproducer refuses an existing output and any app/storage version other than `0.1.0`/1. It allocates a disposable workspace rather than reading user storage. IDs/dataset tokens and timestamps are generated for the new reproduction, so it is not a replacement for these frozen bytes. Run `node --test tests/release-compatibility.test.mjs` to verify checksums and restore both backup modes into independent temporary destinations.
