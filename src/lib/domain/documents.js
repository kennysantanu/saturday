import { recordIdInputSchema } from './validation.js';

export class FileError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

export function publicFileError(e) {
	if (e?.code === 'unsupported_capability' || e?.code === 'forbidden')
		return { code: e.code, message: e.message };
	if (e?.code === 'BUSY' || e?.code === 'RECOVERY_REQUIRED')
		return { code: 'BUSY', message: e.message };
	if (e?.code === 'FORMAT' || String(e?.message).includes('Unsupported database schema'))
		return { code: 'FORMAT', message: e.message };
	return e instanceof FileError
		? { code: e.code, message: e.message }
		: {
				code: 'STORAGE',
				message:
					'File operation failed. Check permissions, available disk space, and store integrity.'
			};
}

export function reject(code, message) {
	throw new FileError(code, message);
}
export function filename(value) {
	if (typeof value !== 'string') reject('VALIDATION', 'Enter a filename.');
	const name = value.normalize('NFC');
	if (
		!name ||
		new TextEncoder().encode(name).byteLength > 255 ||
		/[\/\\\x00-\x1f\x7f<>:"|?*]/.test(name) ||
		/[. ]$/.test(name) ||
		/^(\.|\.\.|con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
	)
		reject('VALIDATION', 'Use a portable filename of 1–255 UTF-8 bytes without path separators.');
	return name;
}
export function validKey(key) {
	const parts = typeof key === 'string' ? key.split('/') : [];
	if (parts.length === 2 && parts[0] === 'documents') {
		if (filename(parts[1]) !== parts[1])
			reject('VALIDATION', 'Filename must use Unicode NFC normalization.');
	} else if (
		parts.length === 3 &&
		parts[0] === 'jobs' &&
		recordIdInputSchema.safeParse(parts[1]).success
	) {
		if (filename(parts[2]) !== parts[2])
			reject('VALIDATION', 'Filename must use Unicode NFC normalization.');
	} else reject('VALIDATION', 'Invalid document key.');
	return key;
}
