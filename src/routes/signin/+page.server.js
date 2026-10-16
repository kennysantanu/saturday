import { fail, redirect } from '@sveltejs/kit';
import {
	accessForm,
	readAccessSettings,
	safeReturnPath,
	sameOrigin
} from '$lib/server/access-settings.js';
import { checkPassword, loginCookie } from '$lib/server/access-auth.js';
export function load({ url }) {
	return { next: safeReturnPath(url.searchParams.get('next')) };
}
export const actions = {
	default: async (event) => {
		if (!sameOrigin(event)) return fail(403, { loginError: 'Sign in from this Saturday page.' });
		try {
			const values = await accessForm(event.request),
				settings = readAccessSettings();
			if (settings.password) {
				if (!(await checkPassword(values.get('password'), event.getClientAddress(), settings)))
					return fail(400, { loginError: 'Incorrect password.' });
				loginCookie(event, settings);
			}
		} catch (e) {
			return fail(e.status ?? 503, {
				loginError: e.status ? e.message : 'Sign-in is unavailable. Try again later.'
			});
		}
		redirect(303, safeReturnPath(event.url.searchParams.get('next')));
	}
};
