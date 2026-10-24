import { authenticationRequired } from '$lib/auth-notice.svelte';
import type { Tag } from '$lib/tag-types';
export class TagRequestError extends Error {
	errors: Record<string, string>;
	existingTag?: Tag;
	constructor(message: string, errors: Record<string, string> = {}, existingTag?: Tag) {
		super(message);
		this.errors = errors;
		this.existingTag = existingTag;
	}
}
export async function tagRequest(action: string, input: Record<string, unknown> = {}) {
	const response =
		action === 'list'
			? await fetch(
					'/api/tags?' +
						new URLSearchParams(
							Object.entries(input).flatMap(([key, value]) =>
								Array.isArray(value)
									? value.map((item) => [key, String(item)])
									: [[key, String(value)]]
							)
						)
				)
			: await fetch('/api/tags', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action, ...input })
				});
	if (response.status === 401) {
		authenticationRequired();
		throw new TagRequestError('Session expired — sign in, then retry.');
	}
	const body = await response.json();
	if (!response.ok)
		throw new TagRequestError(
			body.error ?? 'Tags could not be saved. Try again.',
			body.errors,
			body.existingTag
		);
	return body;
}
