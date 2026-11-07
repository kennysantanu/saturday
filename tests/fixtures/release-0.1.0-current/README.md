# Current 0.1.0 storage fixture

This fictional, populated fixture was generated once with Node.js 25.9.0 from committed source `a543d03d00b283d575f0d0671e99b4c869e3b256` (app `0.1.0`, database schema 1, file manifest 1). It includes the current navigation tables as well as jobs, workflow history, people, reminders, tags and six documents with Profile assignments. It contains no user data or machine-specific paths.

`database.sqlite` and `files/` are the original stores. `backups/` contains independent database/file backups and a coordinated ZIP. `expected.json` records source provenance, rows, IDs, allocator counters, document hashes and artifact checksums. Backup creator identity is `development` because the producer calls source services; `source_commit` records the actual source snapshot.

Tests consume these bytes unchanged and copy or restore them only into disposable destinations. The older `../release-0.1.0/` fixture remains unchanged for rejection checks against its incompatible pre-release schema. The managed-release update test uses this current fixture for successful restore and data-preservation checks.

To produce another fixture, choose a new output directory and record the verified producer commit:

```sh
node scripts/create-release-fixtures.mjs --source /absolute/verified/source --commit a543d03d00b283d575f0d0671e99b4c869e3b256 --output /absolute/new/fixture-directory
```

Run `node --test tests/release-baseline.test.mjs tests/release-compatibility.test.mjs` to check current restores, older-schema rejection and original artifact checksums. Retain both fixture directories unchanged; future storage changes require migrations and corresponding upgrade tests.
