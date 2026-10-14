import { databaseIdentity, assertFileStorageCompatible } from '$lib/server/database.js';
import { json } from '@sveltejs/kit';
import { getInstallation, assertInstallationStorage } from '$lib/server/installation.js';
import { buildInfo } from '$lib/server/compatibility.js';
import { existsSync } from 'node:fs';
export function GET() {
	try {
		const installation = getInstallation();
		assertInstallationStorage();
		if (
			!existsSync(installation.database) ||
			(installation.descriptor_path &&
				(!installation.initialized.database || !installation.initialized.files))
		)
			throw new Error('Workspace is not initialized.');
		databaseIdentity();
		assertFileStorageCompatible();
		return json(
			{
				app: 'saturday',
				status: 'ready',
				installation_id: installation.installation_id,
				build: buildInfo
			},
			{ headers: { 'cache-control': 'no-store' } }
		);
	} catch {
		return json(
			{ app: 'saturday', status: 'unavailable' },
			{ status: 503, headers: { 'cache-control': 'no-store' } }
		);
	}
}
