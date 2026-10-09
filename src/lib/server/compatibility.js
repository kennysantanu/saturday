import { schemaVersion, databaseFormat } from './migrations.js';

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
	database: Object.freeze({
		format: databaseFormat,
		minimumVersion: 1,
		currentVersion: schemaVersion
	}),
	manifest: Object.freeze({ format: 'saturday.files.numeric', minimumVersion: 1, version: 2 }),
	pair: Object.freeze({ format: 'saturday.backup-pair.numeric', version: 1 })
});

// Fresh development baselines; format versions remain independent of app releases.
export const plannedBaseline = Object.freeze({
	databaseFormat,
	manifestFormat: storageCompatibility.manifest.format,
	schemaVersion: 1,
	manifestVersion: 1
});

export function assertManifestCompatibility(m) {
	if (
		!m ||
		m.format !== storageCompatibility.manifest.format ||
		!Number.isInteger(m.format_version) ||
		m.format_version < storageCompatibility.manifest.minimumVersion ||
		m.format_version > storageCompatibility.manifest.version ||
		typeof m.dataset_id !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			m.dataset_id ?? ''
		)
	)
		throw Object.assign(
			new Error(
				'Unsupported file-store format, version or dataset identity. Restart with a compatible build or explicitly reset development data; files are never reset automatically.'
			),
			{ code: 'FORMAT' }
		);
	return m;
}
