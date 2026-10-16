// Browser-only presentation state; it never contains credentials or session identifiers.
type UploadRetry = { label: string; run: () => void | Promise<void>; pathname?: string };
export const authNotice = $state({
	required: false,
	restoring: false,
	retry: null as UploadRetry | null
});
export function authenticationRequired(retry?: UploadRetry) {
	authNotice.required = true;
	if (retry) authNotice.retry = { ...retry, pathname: window.location.pathname };
}
export function checkAuthResponse(response: Response, retry?: UploadRetry) {
	if (response.status === 401 && response.headers.get('x-saturday-auth') === 'required')
		authenticationRequired(retry);
	return response;
}
