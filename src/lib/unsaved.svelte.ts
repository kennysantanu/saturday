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

	/** Use with `use:enhance`: a save in progress never triggers the leave prompt. */
	enhance: SubmitFunction = withPending(() => {
		this.saving = true;
		return async ({ update }) => {
			await update({ reset: false });
			this.saving = false;
			await tick();
			focusFirstError();
		};
	});
}
