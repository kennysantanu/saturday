export class BackupError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = 'BackupError';
	}
}
function fail(code, message) {
	throw new BackupError(code, message);
}
export function publicBackupError(error) {
	if (error instanceof BackupError) return { code: error.code, message: error.message };
	if (
		[
			'unsupported_capability',
			'forbidden',
			'VALIDATION',
			'BUSY',
			'CONFIRMATION',
			'NOT_FOUND',
			'INTEGRITY',
			'DATASET_MISMATCH',
			'RECOVERY_REQUIRED'
		].includes(error?.code)
	)
		return { code: error.code, message: error.message };
	if (error?.code === 'FORMAT') return { code: 'unsupported_file_format', message: error.message };
	if (String(error?.message).includes('locked') || String(error?.message).includes('busy'))
		return { code: 'database_busy', message: 'Saturday is busy. Try again shortly.' };
	return {
		code: 'io_error',
		message: 'The backup operation failed. Check storage space and file permissions.'
	};
}
