const bundle = typeof __SATURDAY_DOCUMENTATION__ === 'undefined' ? [] : __SATURDAY_DOCUMENTATION__;
const aliases = {
	phone: 'lan',
	wifi: 'lan',
	stage: 'workflow',
	stages: 'workflow',
	forgot: 'password recovery',
	locked: 'password recovery',
	feature: 'development',
	develop: 'development',
	logout: 'sign out'
};
const stop = new Set([
	'a',
	'an',
	'the',
	'i',
	'my',
	'to',
	'of',
	'for',
	'how',
	'do',
	'can',
	'is',
	'it',
	'in',
	'on',
	'with',
	'saturday'
]);
export function createDocumentationHelp(
	documents = bundle,
	build = { id: 'development', commit: null }
) {
	const index = () =>
		documents.map(({ id, title, summary, source, aliases }) => ({
			document_id: id,
			title,
			summary,
			topics: aliases,
			source
		}));
	const invalid = (message) => {
		throw new Error(`${message} Use search_documentation with no query to list valid guide IDs.`);
	};
	return {
		search({ query = '', limit = 5 } = {}) {
			if (
				typeof query !== 'string' ||
				query.length > 200 ||
				!Number.isInteger(limit) ||
				limit < 1 ||
				limit > 10
			)
				invalid('Use a query of at most 200 characters and a limit from 1 to 10.');
			if (!query.trim()) return { build, guides: index() };
			const words = [
				...new Set(
					query
						.toLowerCase()
						.split(/[^\p{L}\p{N}_]+/u)
						.filter((w) => w && !stop.has(w))
						.flatMap((w) => [w, ...(aliases[w]?.split(' ') ?? [])])
				)
			];
			const matches = [];
			for (const document of documents)
				for (const section of document.sections) {
					const title = document.title.toLowerCase(),
						heading = section.title.toLowerCase(),
						body = section.markdown.toLowerCase();
					const score = words.reduce(
						(sum, word) =>
							sum +
							(heading.includes(word) ? 12 : 0) +
							(title.includes(word) ? 6 : 0) +
							(body.includes(word) ? 2 : 0),
						0
					);
					if (score) {
						const first = Math.min(
							...words.map((word) => body.indexOf(word)).filter((n) => n >= 0)
						);
						const start = Number.isFinite(first) ? Math.max(0, first - 60) : 0;
						matches.push({
							document_id: document.id,
							section_id: section.id,
							title: document.title,
							section_title: section.title,
							source: section.source,
							excerpt: section.markdown.slice(start, start + 320),
							score
						});
					}
				}
			matches.sort(
				(a, b) =>
					b.score - a.score ||
					a.document_id.localeCompare(b.document_id) ||
					a.section_id.localeCompare(b.section_id)
			);
			return {
				build,
				query,
				results: matches.slice(0, limit),
				total: matches.length,
				more_results: matches.length > limit,
				...(matches.length
					? {}
					: {
							message:
								'No matching documentation. Try another keyword or omit the query for the guide index.'
						})
			};
		},
		read({ document_id, section_id } = {}) {
			const document = documents.find((d) => d.id === document_id);
			if (!document) invalid('Unknown document ID.');
			const section =
				section_id === undefined ? null : document.sections.find((s) => s.id === section_id);
			if (section_id !== undefined && !section) invalid('Unknown section ID.');
			const selected =
				section ??
				(document.markdown.length <= 12000
					? { markdown: document.markdown, source: document.source }
					: document.sections[0]);
			const position = document.sections.indexOf(selected);
			return {
				build,
				document_id,
				title: document.title,
				source: selected.source,
				markdown: selected.markdown,
				available_sections: document.sections.map(({ id, title, source }) => ({
					section_id: id,
					title,
					source
				})),
				remaining_sections:
					position >= 0 ? document.sections.slice(position + 1).map((s) => s.id) : [],
				complete_document: position < 0 || document.sections.length === 1,
				continuation:
					position >= 0 && document.sections.length > 1
						? 'Read the remaining section IDs individually with read_documentation; content has not been silently omitted.'
						: null
			};
		}
	};
}
