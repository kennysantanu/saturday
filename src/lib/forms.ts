import { authenticationRequired } from '$lib/auth-notice.svelte';
import { tick } from 'svelte';
import type { SubmitFunction } from '@sveltejs/kit';

/**
 * After a failed save, move focus to the first invalid field, or to the error notice when the
 * problem is not tied to a field. Searches the open dialog first, then the page content.
 */
export function focusFirstError() {
	const scope =
		document.querySelector<HTMLElement>('[data-slot="dialog-content"]') ??
		document.getElementById('main');
	const target =
		scope?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
		scope?.querySelector<HTMLElement>('[role="alert"]');
	target?.focus();
}

/** Marks the form busy while it is being sent, so its submit button shows progress. */
export function withPending(
	handler: SubmitFunction = () => undefined,
	onAuthRequired?: () => void
): SubmitFunction {
	return async (input) => {
		const { formElement } = input;
		formElement.setAttribute('aria-busy', 'true');
		const callback = await handler(input);
		return async (result) => {
			try {
				if (result.result.type === 'failure' && result.result.status === 401) {
					authenticationRequired();
					onAuthRequired?.();
					return;
				}
				if (callback) await callback(result);
				else await result.update();
			} finally {
				formElement.removeAttribute('aria-busy');
			}
		};
	};
}

/** Use with `use:enhance` so a failed submit lands focus on the problem. */
export const enhanceWithFocus: SubmitFunction = withPending(() => async ({ update }) => {
	await update();
	await tick();
	focusFirstError();
});
