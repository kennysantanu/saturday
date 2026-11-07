# Repository rules

Read [Contributing](docs/contributing.md) before changing release, installation or storage behavior, and follow the [design guide](docs/design-guide.md) for UI work.

- App `0.1.0`, database schema `1` and file manifest `1` are the first frozen release baseline. Start a new shipped change by bumping the app version with `npm version patch --no-git-tag-version` (or the appropriate minor/major bump). Keep package and lockfile root versions equal. Tests alone do not require an app bump; bundled guides, dependencies, assets, installers and build code do.
- Never rewrite released entries in `release-baselines.json`, existing numbered migrations, or frozen fixture bytes. Append migrations with consecutive integer versions and update package storage metadata. App-only changes keep the database version unchanged.
- New storage formats need compatible reading/upgrading and populated upgrade/restore fixtures. Never reset user data, alter migration history, or lower version markers to bypass compatibility checks.
- Run `npm run check:release` and relevant tests. Before release, finish source and notes, freeze the new version with `npm run release:freeze`, commit it, then run `npm run verify` on that exact clean commit. Generate distribution metadata outside the repository after verification.
- Local verification does not certify physical devices, reboot, other operating systems or real assistant clients. Report observed checks. Do not publish, push or create release tags without user authorization.
