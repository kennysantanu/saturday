export const PIPELINE_PAGE_SIZE = 20;

/** Invalid, fractional or unsafe page inputs reset to the first page. */
export function pipelinePage(value) {
	const text = String(value ?? '');
	const number = Number(text);
	return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(number) ? number : 1;
}

/** Build from authoritative columns, dropping obsolete stages and clamping their pages. */
export function pipelineHref(columns, stageId, page) {
	const query = new URLSearchParams();
	for (const column of columns) {
		const number = Math.max(
			1,
			Math.min(column.id === stageId ? page : column.page, column.totalPages)
		);
		if (number > 1) query.set(`pipeline_page_${column.id}`, String(number));
	}
	return `/${query.size ? `?${query}` : ''}#pipeline-stage-${stageId}`;
}
