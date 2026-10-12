import { error, fail, redirect } from '@sveltejs/kit';
import { runExtension, extensionError } from '$lib/server/extensions.js';
import { extensionRegistry } from '$lib/server/extensions.generated.js';
export async function load(event) {
	try {
		return await runExtension(event.params.extensionId, extensionRegistry, async (mod, ctx) => ({
			...(mod.load ? await mod.load({ url: event.url }, ctx) : {}),
			extensionId: event.params.extensionId
		}));
	} catch (e) {
		error(e.code === 'DISABLED' ? 403 : 400, extensionError(e).message);
	}
}
export const actions = {
	run: async (event) => {
		const values = Object.fromEntries(await event.request.formData());
		try {
			await runExtension(event.params.extensionId, extensionRegistry, async (mod, ctx) => {
				const action = mod.actions?.[values.operation];
				if (typeof action !== 'function') throw new Error('Invalid extension action.');
				const input = { ...values };
				if (input.confirm === 'true') input.confirm = true;
				await action(input, ctx);
			});
		} catch (e) {
			return fail(400, { extensionError: extensionError(e).message, values });
		}
		redirect(303, `/extensions/${event.params.extensionId}?saved=extension`);
	}
};
