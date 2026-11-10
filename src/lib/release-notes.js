// Turns release notes (a small Markdown subset) into plain data that Svelte renders as text.
// No HTML is produced, so notes from GitHub cannot inject markup or scripts.

/**
 * @typedef {{type: 'text' | 'strong' | 'code', text: string} | {type: 'link', text: string, href: string}} Inline
 * @typedef {{type: 'heading', level: 1 | 2 | 3, inlines: Inline[]}
 *   | {type: 'paragraph', inlines: Inline[]}
 *   | {type: 'list', items: Inline[][]}} Block
 */

// `code`, **bold**, or [text](https://...). Other Markdown stays literal text.
const inlinePattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** @param {string} text @returns {Inline[]} */
export function parseInlines(text) {
	/** @type {Inline[]} */
	const inlines = [];
	let last = 0;
	for (const match of text.matchAll(inlinePattern)) {
		if (match.index > last) inlines.push({ type: 'text', text: text.slice(last, match.index) });
		if (match[1] !== undefined) inlines.push({ type: 'code', text: match[1] });
		else if (match[2] !== undefined) inlines.push({ type: 'strong', text: match[2] });
		else inlines.push({ type: 'link', text: match[3], href: match[4] });
		last = match.index + match[0].length;
	}
	if (last < text.length) inlines.push({ type: 'text', text: text.slice(last) });
	return inlines;
}

/** @param {string} markdown @returns {Block[]} */
export function parseReleaseNotes(markdown) {
	/** @type {Block[]} */
	const blocks = [];
	/** @type {string[]} */
	let paragraph = [];
	/** @type {Inline[][] | null} */
	let list = null;
	const flush = () => {
		if (paragraph.length)
			blocks.push({ type: 'paragraph', inlines: parseInlines(paragraph.join(' ')) });
		paragraph = [];
		if (list) blocks.push({ type: 'list', items: list });
		list = null;
	};
	for (const raw of String(markdown ?? '').split(/\r?\n/)) {
		const line = raw.trim();
		const heading = /^(#{1,6})\s+(.+)$/.exec(line);
		const item = /^[-*+]\s+(.+)$/.exec(line);
		if (!line) flush();
		else if (heading) {
			flush();
			const level = /** @type {1 | 2 | 3} */ (Math.min(heading[1].length, 3));
			blocks.push({
				type: 'heading',
				level,
				inlines: parseInlines(heading[2].replace(/\s+#+$/, ''))
			});
		} else if (item) {
			if (paragraph.length) flush();
			(list ??= []).push(parseInlines(item[1]));
		} else if (list && /^\s{2,}\S/.test(raw)) {
			// An indented continuation line belongs to the previous list item.
			list[list.length - 1].push({ type: 'text', text: ` ${line}` });
		} else {
			if (list) flush();
			paragraph.push(line);
		}
	}
	flush();
	return blocks;
}
