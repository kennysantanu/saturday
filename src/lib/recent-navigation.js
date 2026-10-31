/** Only a successfully rendered record detail can become a recently viewed item. */
export function recentViewForPage(pathname, data, status = 200) {
	if (status >= 400) return null;
	const match = /^\/(jobs|networks)\/([1-9]\d*)$/.exec(pathname);
	if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
	const record = match[1] === 'jobs' ? data.job : data.person;
	if (!record || Number(record.id) !== Number(match[2]) || !record.dataset_id) return null;
	return {
		kind: match[1] === 'jobs' ? 'job' : 'person',
		id: Number(match[2]),
		dataset_id: record.dataset_id
	};
}
