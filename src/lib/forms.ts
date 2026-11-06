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
		let callback: Awaited<ReturnType<SubmitFunction>>;
		try {
			callback = await handler({
				...input,
				cancel: () => {
					formElement.removeAttribute('aria-busy');
					input.cancel();
				}
			});
		} catch (error) {
			formElement.removeAttribute('aria-busy');
			throw error;
		}
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

/**
 * Svelte action for settings forms that save with a button: reports whether any field differs from
 * its value when the form was last saved, so the button can stay disabled until there is
 * something to save. Pass a `key` that changes when saved data reloads to reset the baseline.
 * Without JavaScript the action never runs, so the button stays enabled.
 */
export function trackChanges(
	form: HTMLFormElement,
	options: { set: (dirty: boolean) => void; key?: unknown }
) {
	let { set } = options;
	const snapshot = () =>
		JSON.stringify([...new FormData(form)].filter(([, value]) => typeof value === 'string'));
	let baseline = snapshot();
	const sync = () => set(snapshot() !== baseline);
	set(false);
	form.addEventListener('input', sync);
	form.addEventListener('change', sync);
	form.addEventListener('reset', () => setTimeout(sync));
	return {
		update(next: { set: (dirty: boolean) => void; key?: unknown }) {
			set = next.set;
			// Saved data has reloaded: what the form shows now is the new baseline.
			void tick().then(() => {
				baseline = snapshot();
				set(false);
			});
		},
		destroy() {
			form.removeEventListener('input', sync);
			form.removeEventListener('change', sync);
		}
	};
}
