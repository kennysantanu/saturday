import { migrateDatabase } from '../src/lib/server/database.js';

try {
	const result = migrateDatabase();
	console.log(`Saturday database is ready (schema ${result.version}).`);
	console.log(`Database: ${result.path}`);
} catch (error) {
	console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
