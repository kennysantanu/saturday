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

/** Use with `use:enhance` so a failed submit lands focus on the problem. */
export const enhanceWithFocus: SubmitFunction =
	() =>
	async ({ update }) => {
		await update();
		await tick();
		focusFirstError();
	};
