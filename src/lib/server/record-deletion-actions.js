import { fail, redirect } from '@sveltejs/kit';
import { ValidationError, parseRecordId } from './validation.js';
import { jobReturn } from '../job-navigation.js';
import { networkReturn } from '../network-navigation.js';
import { getJob } from './application.js';
// Success markers precede the hash so Dashboard return anchors remain usable.
function destination(address, saved) {
	const url = new URL(address, 'http://saturday.local');
	url.searchParams.set('saved', saved);
	return url.pathname + url.search + url.hash;
}
export function recordDeletionAction(kind, operation) {
	return async ({ params, request, url }) => {
		const field = kind === 'job' ? 'job_id' : 'network_id';
		let address =
			kind === 'job'
				? jobReturn(url.searchParams.get('return_to'))
				: networkReturn(url.searchParams.get('return_to'));
		async function currentAddress() {
			if (kind === 'person' && address.startsWith('/jobs/')) {
				try {
					const originId = new URL(address, url).pathname.split('/')[2];
					if (!(await getJob(originId))) return '/networks';
				} catch {
					return '/networks';
				}
			}
			return address;
		}
		const values = Object.fromEntries(await request.formData());
		try {
			const id = parseRecordId(params.id, field);
			if (values[field] !== undefined && parseRecordId(values[field], field) !== id)
				throw new ValidationError({ [field]: 'The deletion target does not match this page.' });
			await operation({
				[field]: id,
				dataset_id: values.dataset_id,
				confirm: values.confirm === 'true'
			});
		} catch (error) {
			if (error.code === 'not_found')
				redirect(303, destination(await currentAddress(), `${kind}-missing`));
			const recovery = error.code === 'RECOVERY_REQUIRED';
			const message =
				error instanceof ValidationError
					? Object.values(error.fieldErrors).join(' ')
					: error.code
						? error.message
						: 'Deletion failed. Check storage permissions and reload the record before retrying.';
			return fail(recovery ? 503 : 400, { action: 'deleteRecord', error: message, recovery });
		}
		redirect(303, destination(await currentAddress(), `${kind}-deleted`));
	};
}
