import { fail } from '@sveltejs/kit';
import { unlinkJobNetworkConfirmed } from './application.js';
import { ServiceError, ValidationError } from '../domain/validation.js';
import { settled } from './settled.js';

function formValues(formData) {
	return Object.fromEntries(
		Array.from(formData.entries(), ([key, value]) => [key, typeof value === 'string' ? value : ''])
	);
}

function defaultError(error, values, action) {
	if (error instanceof ValidationError)
		return fail(400, { action, errors: error.fieldErrors, values });
	if (error instanceof ServiceError)
		return fail(400, { action, errors: { form: error.message }, values });
	console.error('Could not save unlink change:', error);
	return fail(500, {
		action,
		errors: { form: 'Saturday could not save this change. Try again.' },
		values
	});
}

// side: 'job' on /jobs/[id] (route owns job_id) or 'person' on /networks/[id] (route owns network_id).
// Returns fail(409, …) when a note would be lost and the form did not carry the confirmation.
export function confirmedUnlink(side, saved, { redirectTo, onError = defaultError }) {
	if (side !== 'job' && side !== 'person') {
		throw new Error(`Unsupported unlink side: ${side}`);
	}
	return async (event) => {
		const { params, request, url } = event;
		const values = formValues(await request.formData());
		const ids =
			side === 'job'
				? { job_id: params.id, network_id: values.network_id }
				: { job_id: values.job_id, network_id: params.id };
		try {
			const result = await unlinkJobNetworkConfirmed(ids, {
				confirmed: values.confirm_note_loss === '1'
			});
			if (result.note_confirmation_required) {
				return fail(409, {
					action: saved,
					noteLoss: {
						job_id: result.job_id,
						job_title: result.job_title,
						company_name: result.company_name,
						network_id: result.network_id,
						network_name: result.network_name,
						note: result.note
					},
					values
				});
			}
		} catch (error) {
			return onError(error, values, saved);
		}
		return settled(event, { saved }, redirectTo({ params, url, saved }));
	};
}
