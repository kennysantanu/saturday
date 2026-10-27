import { ServiceError } from '../domain/validation.js';

// Capabilities describe implementations, never the identity or permissions of a caller.
export const capabilityNames = Object.freeze([
	'records',
	'documents',
	'pdf',
	'recovery.database',
	'recovery.files',
	'recovery.paired',
	'host.files',
	'host.controls',
	'host.installation',
	'extensions',
	'assistant.stdio'
]);

export function capabilityStatus(capabilities, name) {
	const available = capabilities[name] === true;
	return {
		capability: name,
		available,
		...(available
			? {}
			: { code: 'unsupported_capability', message: `${name} is unavailable on this platform.` })
	};
}

export function requireCapability(capabilities, name) {
	const result = capabilityStatus(capabilities, name);
	if (!result.available)
		throw Object.assign(new ServiceError(result.message, result.code), { capability: name });
}
