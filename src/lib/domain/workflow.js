import { ValidationError } from './validation.js';
export const normalizeStageName = (name) => name.trim().toLowerCase();
export function parseStageName(name) {
	if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
		throw new ValidationError({ name: 'Enter a stage name of 1–80 characters.' });
	return name.trim();
}
export function stageFlag(value) {
	if (typeof value !== 'boolean')
		throw new ValidationError({ is_closed: 'Choose whether this stage closes the job.' });
	return Number(value);
}
