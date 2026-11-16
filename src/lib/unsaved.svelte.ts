import { tick } from 'svelte';
import type { SubmitFunction } from '@sveltejs/kit';
import { focusFirstError, withPending } from '$lib/forms';

/** Tracks edits to a form so leaving the page can ask first. Pair with `UnsavedGuard`. */
export class UnsavedChanges {
	dirty = $state(false);
	saving = $state(false);

	markDirty = () => {
		this.dirty = true;
	};

	/** Clears the saving flag; used whenever a request ends without reaching the save callback. */
	release = () => {
		this.saving = false;
	};

	/**
	 * Like `enhance`, but runs `check` first; a check that cancels the submission never marks a save in
	 * flight. A 401 is answered before the save callback runs, so it releases the flag here too.
	 */
	enhanceAfter = (check: SubmitFunction): SubmitFunction =>
		withPending(async (input) => {
			let cancelled = false;
			await check({
				...input,
				cancel: () => {
					cancelled = true;
					input.cancel();
				}
			});
			return cancelled ? undefined : this.enhance(input);
		}, this.release);

	/** Use with `use:enhance`: a save in progress never triggers the leave prompt. */
	enhance: SubmitFunction = withPending(
		() => {
			this.saving = true;
			return async ({ result, update }) => {
				if (result.type === 'redirect' || result.type === 'success') this.dirty = false;
				try {
					await update({ reset: false });
				} finally {
					this.saving = false;
				}
				await tick();
				focusFirstError();
			};
		},
		() => {
			this.saving = false;
		}
	);
}
