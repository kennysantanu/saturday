import { z } from 'zod';
import { recordIdInputSchema } from './validation.js';

export const recentViewSchema = z.object({
	kind: z.enum(['job', 'person']),
	id: recordIdInputSchema,
	dataset_id: z.uuid()
});
export const navigationSettingsSchema = z.object({
	enabled: z.boolean(),
	limit: z.union([z.literal(5), z.literal(10), z.literal(20)])
});
