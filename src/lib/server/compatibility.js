import { schemaVersion } from './migrations.js';

// The builders replace this constant with captured commit/build information.
// Direct source commands have no compiled build identity and do not run Git.
export const buildInfo = Object.freeze(
	typeof __SATURDAY_BUILD_INFO__ === 'undefined'
		? { id: 'development', commit: null, dirty: null }
		: __SATURDAY_BUILD_INFO__
);

// Describes today's supported formats, independently of the package version.
// Migration names and exact schema/manifest validation remain authoritative.
export const storageCompatibility = Object.freeze({
	database: Object.freeze({ minimumVersion: 1, currentVersion: schemaVersion }),
	manifest: Object.freeze({ version: 1 })
});

// Reserved contract for Phases 2–3. Not accepted by current storage validators.
export const plannedBaseline = Object.freeze({
	databaseFormat: 'saturday.database.numeric',
	manifestFormat: 'saturday.files.numeric',
	schemaVersion: 1,
	manifestVersion: 1
});
