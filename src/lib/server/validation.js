// Compatibility entry for local services. Domain validation is runtime-independent.
export * from '../domain/validation.js';
import { ServiceError } from '../domain/validation.js';

export function assertDeletionDataset(db, expected) {
	if (db.prepare('SELECT dataset_id FROM app_metadata WHERE id=1').get().dataset_id !== expected)
		throw new ServiceError(
			'The database was replaced. Reload this record before deleting it.',
			'DATASET_MISMATCH'
		);
}
