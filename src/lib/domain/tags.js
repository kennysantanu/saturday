import { z } from 'zod';
import { normalizeTagName, DEFAULT_TAG_COLOR } from '../tags.js';

export const tagCollectionSchema = z.enum(['job', 'person']);
export const tagInputShape = {
	name: z.string().transform((value, ctx) => {
		const name = normalizeTagName(value);
		if (!name || name.length > 50) {
			ctx.addIssue({
				code: 'custom',
				message:
					'Use letters and numbers separated by spaces, up to 50 characters. Names are saved in lowercase.'
			});
			return z.NEVER;
		}
		return name;
	}),
	color: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, 'Enter a six-digit hex color, such as #64748b.')
		.transform((value) => value.toLowerCase())
		.default(DEFAULT_TAG_COLOR)
};
