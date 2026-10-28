// Dependency-free distribution validation shared by release tooling and the updater.
export function compareVersions(a, b) {
	const parse = (v) => {
		if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v))
			throw new Error('Expected a stable release version.');
		return v.split('.').map(Number);
	};
	const x = parse(a),
		y = parse(b);
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
	return 0;
}
export function validateRelease(metadata, release) {
	const version = release.tag_name?.replace(/^v/, '');
	compareVersions(version, '0.1.0');
	if (
		metadata?.format !== 'saturday.release' ||
		metadata.version !== 1 ||
		metadata.release !== version ||
		!/^[a-f0-9]{40}$/.test(metadata.commit || '') ||
		metadata.source?.type !== 'github-source' ||
		!/^\d+\.\d+\.\d+$/.test(metadata.node_minimum || '') ||
		!metadata.storage?.database ||
		!metadata.storage?.manifest
	)
		throw new Error('Release metadata is invalid or unsupported.');
	validateDistribution({ ...metadata, installation_api: metadata.installation_api });
	return metadata;
}
export function validateDistribution(metadata) {
	if (
		metadata?.installation_api !== 1 ||
		!/^\d+\.\d+\.\d+$/.test(metadata.node_minimum || '') ||
		metadata.storage?.database?.format !== 'saturday.database' ||
		metadata.storage?.manifest?.format !== 'saturday.files'
	)
		throw new Error(
			'This build does not provide a compatible installation/storage contract. Keep the current build.'
		);
	for (const [min, max] of [
		[metadata.storage.database.minimumVersion, metadata.storage.database.currentVersion],
		[metadata.storage.manifest.minimumVersion, metadata.storage.manifest.version]
	])
		if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min)
			throw new Error('Invalid distribution storage bounds.');
	if (metadata.runtime) {
		if (
			compareVersions(metadata.runtime.version, metadata.node_minimum) < 0 ||
			!/^[a-f0-9]{64}$/.test(metadata.runtime.hashes?.[`${process.platform}-${process.arch}`] || '')
		)
			throw new Error('Pinned runtime metadata is unsupported on this OS/CPU.');
	}
	return metadata;
}
