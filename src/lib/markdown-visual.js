import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { markdownExtensions, literalHtmlMarked } from './markdown-extensions.js';

// The visual editor must never silently change a document. Deciding whether a document may open there is
// therefore done by doing exactly what the editor will do: read it with the editor's own extensions, write
// it back, and compare what a reader would see in the source with what the round trip leaves. Two deliberate
// policies sit ahead of that comparison: setext headings (the editor has no underlined heading) and HTML
// outside code (the editor can only escape raw HTML, rewriting the user's bytes). Otherwise preserving
// meaning is the only authority; once a document has been refused, syntax is used only to put a name to the
// loss.
//
// HTML is still literal text in literalHtmlMarked(), so no HTML token ever reaches Tiptap's browser-only
// DOMParser path if a document is parsed directly.

// A parser of our own. The editor's Markdown extension registers its table and task tokenizers on whichever
// marked instance it is given, so reading the *source* with a shared one would make the source and the
// round trip agree on the same mistakes, hiding exactly the losses this gate exists to find. Neither the
// reader below nor the editor's manager may share it. It applies the same literal-HTML policy as the
// editor, by policy and not by sharing an instance.
const reader = literalHtmlMarked();
const marked = { lexer: (text) => reader.lexer(text) };

const childTokens = (token) => [
	token.tokens,
	...(token.items ?? []).map((item) => item.tokens),
	...(token.header ?? []).map((cell) => cell.tokens),
	...(token.rows ?? []).flat().map((cell) => cell.tokens)
];

/** Names an image or definition inside these tokens, for the message only: it decides nothing. */
function namedConstruct(tokens) {
	for (const token of tokens) {
		if (token.type === 'def') return 'link or footnote definitions';
		if (token.type === 'image') return 'images';
		for (const child of childTokens(token)) {
			const found = child && namedConstruct(child);
			if (found) return found;
		}
	}
	return null;
}

/**
 * True for a setext heading (`Title` underlined with `-` or `=`). The lexer reports the underline inside
 * the heading's own `raw`, which distinguishes it from an ATX heading followed by a horizontal rule, so
 * no guessing at the source text is needed. A single underline character is enough, trailing blank lines
 * are ignored, and list items are traversed because a setext heading may be the item's only content.
 */
function hasSetextHeading(tokens) {
	return tokens.some((token) => {
		if (token.type === 'heading' && /\n[ \t]*(?:-+|={1,})[ \t]*\n*$/.test(token.raw ?? ''))
			return true;
		if (token.tokens && hasSetextHeading(token.tokens)) return true;
		if (token.items?.some((item) => item.tokens && hasSetextHeading(item.tokens))) return true;
		return false;
	});
}

const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (text) =>
	String(text ?? '').replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => entities[m]);

/**
 * Flattens parsed Markdown into the things a reader would see: text, code exactly as written, link targets,
 * structure and task state. Formatting the editor always rewrites (bullet characters, `_x_` versus `*x*`,
 * escaping, entity encoding, table padding) does not appear, so two spellings of the same document produce
 * the same list. Both sides of the comparison are read by the same parser, so it needs no parity with the
 * editor's own tokenizers.
 */
function signature(tokens, out = []) {
	for (const token of tokens) {
		switch (token.type) {
			case 'space':
				break;
			case 'hr':
				out.push('hr');
				break;
			case 'br':
				out.push('br');
				break;
			case 'code':
				out.push(`code:${token.lang ?? ''}:${token.text}`);
				break;
			case 'codespan':
				out.push(`codespan:${decode(token.text)}`);
				break;
			case 'text':
			case 'escape':
				if (token.tokens) {
					out.push('para');
					signature(token.tokens, out);
					out.push('para');
				} else out.push(`t:${decode(token.text)}`);
				break;
			case 'paragraph':
				out.push('para');
				signature(token.tokens ?? [], out);
				out.push('para');
				break;
			case 'heading':
				out.push(`h${token.depth}(`);
				signature(token.tokens ?? [], out);
				out.push(')');
				break;
			case 'blockquote':
				out.push('quote(');
				signature(token.tokens ?? [], out);
				out.push(')');
				break;
			case 'list':
				out.push(token.ordered ? `ol:${token.start === '' ? 1 : token.start}(` : 'ul(');
				for (const item of token.items) {
					out.push(item.task ? `li:${item.checked ? 'x' : ' '}(` : 'li(');
					signature(item.tokens ?? [], out);
					out.push(')');
				}
				out.push(')');
				break;
			case 'checkbox':
				break; // Already recorded by the list item.
			case 'table':
				out.push(`table:${(token.align ?? []).map((a) => a ?? '-').join('')}(`);
				for (const row of [token.header, ...token.rows]) {
					out.push('row(');
					for (const cell of row) {
						out.push('cell(');
						signature(cell.tokens ?? [], out);
						out.push(')');
					}
					out.push(')');
				}
				out.push(')');
				break;
			case 'link':
				out.push(`a:${token.href}:${token.title ?? ''}(`);
				signature(token.tokens ?? [], out);
				out.push(')');
				break;
			case 'image':
				// An image is its destination, title and description; keeping only its alt text is a loss.
				out.push(`img:${token.href}:${token.title ?? ''}:${decode(token.text)}`);
				break;
			case 'strong':
			case 'em':
			case 'del':
				out.push(`${token.type}(`);
				signature(token.tokens ?? [], out);
				out.push(')');
				break;
			default:
				// Anything unforeseen is compared as written, so a difference is never overlooked.
				if (token.tokens) {
					out.push(`${token.type}(`);
					signature(token.tokens, out);
					out.push(')');
				} else out.push(`${token.type}:${token.raw ?? token.text ?? ''}`);
		}
	}
	return out;
}

/** Merges adjacent text and collapses its whitespace (code is untouched; it never carries the `t:` prefix). */
function normalized(tokens) {
	const merged = [];
	for (const entry of signature(tokens)) {
		const last = merged.length - 1;
		if (entry.startsWith('t:') && last >= 0 && merged[last].startsWith('t:'))
			merged[last] += entry.slice(2);
		else if (entry === 'para' && last >= 0 && merged[last] === 'para') continue;
		else merged.push(entry);
	}
	return merged
		.map((entry) =>
			entry.startsWith('t:') ? `t:${entry.slice(2).replace(/\s+/g, ' ').trim()}` : entry
		)
		.filter((entry) => entry !== 't:');
}

/** What a reader would see in this Markdown; exported so tests can show why two spellings differ. */
export const visualMarkdownSignature = (text) => normalized(marked.lexer(text));

const sameList = (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]);

let manager;
let schema;
function editorMachinery() {
	if (!manager) {
		const extensions = markdownExtensions();
		manager = new MarkdownManager({ extensions, marked: literalHtmlMarked() });
		schema = getSchema(extensions);
	}
	return { manager, schema };
}

/** What the editor would write back for this Markdown, or throws when it cannot hold it at all. */
export function visualMarkdownRoundTrip(text) {
	const machine = editorMachinery();
	const json = machine.manager.parse(text);
	// The schema silently drops what it has no node for when the editor loads, so insist it all fits.
	machine.schema.nodeFromJSON(json).check();
	return machine.manager.serialize(json);
}

/** Reads Markdown into an editor document the way the editor does. Exported so tests can edit it. */
export function visualEditorParse(text) {
	return editorMachinery().manager.parse(text);
}

/** Writes an editor document as Markdown, exactly as the editor will on save. */
export function visualEditorMarkdown(json) {
	return editorMachinery().manager.serialize(json);
}

/** The editor's schema, for tests that edit a document without a browser. */
export const visualEditorSchema = () => editorMachinery().schema;

/**
 * The document reduced to what it holds: schema defaults filled in, adjacent text with the same marks
 * joined, marks in a fixed order, and empty paragraphs dropped (Markdown has no way to keep them).
 */
function canonical(node) {
	if (!node || typeof node !== 'object') return node;
	const out = { type: node.type };
	if (node.attrs && Object.keys(node.attrs).length) out.attrs = node.attrs;
	if (node.marks?.length)
		out.marks = [...node.marks].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
	if (node.text !== undefined) out.text = node.text;
	if (node.content) {
		const content = [];
		for (const child of node.content.map(canonical)) {
			const last = content[content.length - 1];
			if (
				child.text !== undefined &&
				last?.text !== undefined &&
				JSON.stringify(last.marks) === JSON.stringify(child.marks)
			)
				last.text += child.text;
			else if (child.type === 'paragraph' && !child.content?.length) continue;
			else content.push(child);
		}
		if (content.length) out.content = content;
	}
	return out;
}

const comparable = (json) =>
	JSON.stringify(canonical(editorMachinery().schema.nodeFromJSON(json).toJSON()));

/**
 * Names what saving this editor document would lose, or returns null when the Markdown written for it reads
 * back as the very same document. This looks at the live document, not at the Markdown written for it:
 * text the writer already changed (whitespace squeezed inside code in a table cell, say) reads back cleanly
 * and would pass any check made on the written text alone.
 */
export function visualEditorLoss(json) {
	try {
		const machine = editorMachinery();
		const back = machine.manager.parse(machine.manager.serialize(json));
		return comparable(json) === comparable(back)
			? null
			: 'text the editor would change when saving';
	} catch {
		return 'text the editor could not write';
	}
}

function nameBlock(token) {
	if (token.type === 'table') return 'a table the editor would rewrite';
	if (token.type === 'list' && token.items?.some((item) => item.task))
		return 'a task list the editor would rewrite';
	if (token.type === 'list') return 'a list the editor would rewrite';
	if (token.type === 'code') return 'a code block the editor would rewrite';
	if (token.type === 'blockquote') return 'a quote the editor would rewrite';
	return 'text the editor would rewrite';
}

/**
 * True when the editor would write these tokens back with everything a reader sees still in them. The
 * editor's own conversion decides: a throw (a block image, a document the schema cannot hold) preserved
 * nothing, and a conversion that completes still has to compare equal, so valid JSON alone never admits.
 */
function preserved(text, tokens) {
	try {
		return sameList(normalized(tokens), normalized(marked.lexer(visualMarkdownRoundTrip(text))));
	} catch {
		return false;
	}
}

export const HTML_BLOCKER = 'HTML, which the visual editor would save as escaped text';
const URI_AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>\n\u0000]*>/g;
const EMAIL_AUTOLINK =
	/<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*>/g;
const ANGLE_LINK_DEST = /\]\([ \t]*<[^<>\n\u0000]*>/g;
const ANGLE_REF_DEST = /^\[[^\]\n\u0000]+\]:[ \t]*<[^<>\n\u0000]*>/;
const HTML_DECLARATION = /<(?:!--|!\[CDATA\[|![A-Za-z]|\?[A-Za-z])/;
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^(`{3,}|~{3,})[ \t]*$/;
const LIST_MARKER = /^(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)/;
const ATX_HEADING = /^#{1,6}(?:[ \t]|$)/;
const THEMATIC_BREAK = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;

const isAsciiLetter = (ch) => (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
const isTagNameChar = (ch) => isAsciiLetter(ch) || (ch >= '0' && ch <= '9') || ch === '-';
const isAttrStart = (ch) => isAsciiLetter(ch) || ch === '_' || ch === ':';
const isAttrChar = (ch) =>
	isAsciiLetter(ch) ||
	(ch >= '0' && ch <= '9') ||
	ch === '_' ||
	ch === '.' ||
	ch === ':' ||
	ch === '-';
const isSpace = (ch) => ch === ' ' || ch === '\t';
const isUnquotedAttrChar = (ch) =>
	ch !== ' ' &&
	ch !== '\t' &&
	ch !== '\r' &&
	ch !== '\n' &&
	ch !== '\u0000' &&
	ch !== '"' &&
	ch !== "'" &&
	ch !== '=' &&
	ch !== '<' &&
	ch !== '>' &&
	ch !== '`';

/** Expands leading spaces and tabs starting from column `startCol`, returning `{ indent, col, index }`. */
function measureIndent(str, startIndex = 0, startCol = 0) {
	let i = startIndex;
	let col = startCol;
	while (i < str.length) {
		const ch = str[i];
		if (ch === ' ') {
			col++;
			i++;
		} else if (ch === '\t') {
			col += 4 - (col % 4);
			i++;
		} else {
			break;
		}
	}
	return { indent: col - startCol, col, index: i };
}

/** Strips CommonMark blockquote prefixes (0–3 columns, `>`, optional space) from a line. */
function stripBlockquotes(line) {
	let i = 0;
	let quotes = 0;
	let col = 0;
	while (i < line.length) {
		const ws = measureIndent(line, i, col);
		if (ws.indent <= 3 && line[ws.index] === '>') {
			quotes++;
			i = ws.index + 1;
			col = ws.col + 1;
			if (line[i] === ' ') {
				i++;
				col++;
			} else if (line[i] === '\t') {
				const spaces = 4 - (col % 4) - 1;
				line = ' '.repeat(spaces) + line.slice(i + 1);
				i = 0;
				col = 4 - spaces;
			}
		} else {
			break;
		}
	}
	return { quotes, rest: line.slice(i), startCol: col };
}

/**
 * Replaces backtick inline code spans on a single line with a NUL sentinel in O(L) time.
 * Keeps unmatched backticks intact so text across separate lines or blocks can never pair.
 */
function stripInlineCodeLine(line) {
	if (!line.includes('`')) return line;
	const len = line.length;
	/** @type {Map<number, number[]>} */
	const runsByLen = new Map();
	for (let i = 0; i < len;) {
		if (line[i] !== '`') {
			i++;
			continue;
		}
		const start = i;
		while (i < len && line[i] === '`') i++;
		const runLen = i - start;
		let list = runsByLen.get(runLen);
		if (!list) {
			list = [];
			runsByLen.set(runLen, list);
		}
		list.push(start);
	}
	/** @type {Map<number, number>} */
	const cursorByLen = new Map();
	let out = '';
	for (let i = 0; i < len;) {
		if (line[i] !== '`') {
			const next = line.indexOf('`', i);
			if (next === -1) {
				out += line.slice(i);
				break;
			}
			out += line.slice(i, next);
			i = next;
			continue;
		}
		let backslashes = 0;
		for (let k = i - 1; k >= 0 && line[k] === '\\'; k--) backslashes++;
		if (backslashes % 2 === 1) {
			out += line[i++];
			continue;
		}
		let n = 0;
		while (i + n < len && line[i + n] === '`') n++;
		const list = runsByLen.get(n);
		let closedAt = -1;
		if (list) {
			let idx = cursorByLen.get(n) ?? 0;
			while (idx < list.length && list[idx] < i + n) idx++;
			cursorByLen.set(n, idx);
			if (idx < list.length) {
				closedAt = list[idx] + n;
				cursorByLen.set(n, idx + 1);
			}
		}
		if (closedAt !== -1) {
			out += '\u0000';
			i = closedAt;
		} else {
			out += line.slice(i, i + n);
			i += n;
		}
	}
	return out;
}

/**
 * Linear-time check for an HTML open tag (`<name ...>` / `<name .../>`) or closing tag (`</name>`)
 * on a single line. Follows CommonMark §6.6 open/closing tag syntax. Memoizing failed attribute
 * start positions guarantees O(L) worst-case time on a line of length L.
 */
function hasHtmlTagOnLine(line) {
	const len = line.length;
	let i = line.indexOf('<');
	if (i === -1 || !line.includes('>')) return false;
	const hasNul = line.includes('\u0000');
	/** @type {Set<number> | null} */
	let failedAttr = null;
	for (; i !== -1; i = line.indexOf('<', i + 1)) {
		if (i + 1 >= len) break;
		if (line[i + 1] === '/') {
			let p = i + 2;
			if (p < len && isAsciiLetter(line[p])) {
				p++;
				while (p < len && isTagNameChar(line[p])) p++;
				while (p < len && isSpace(line[p])) p++;
				if (p < len && line[p] === '>') return true;
			}
			continue;
		}
		if (!isAsciiLetter(line[i + 1])) continue;
		let p = i + 2;
		while (p < len && isTagNameChar(line[p])) p++;
		while (p < len) {
			const wsStart = p;
			while (p < len && isSpace(line[p])) p++;
			const hadSpace = p > wsStart;
			if (p >= len) break;
			if (line[p] === '>') return true;
			if (line[p] === '/' && p + 1 < len && line[p + 1] === '>') return true;
			if (!hadSpace || !isAttrStart(line[p])) break;
			if (failedAttr?.has(p)) break;
			if (!failedAttr && line.indexOf('<', i + 1) !== -1) failedAttr = new Set();
			failedAttr?.add(p);
			p++;
			while (p < len && isAttrChar(line[p])) p++;
			let eq = p;
			while (eq < len && isSpace(line[eq])) eq++;
			if (eq < len && line[eq] === '=') {
				let v = eq + 1;
				while (v < len && isSpace(line[v])) v++;
				if (v >= len) break;
				const q = line[v];
				if (q === '"' || q === "'") {
					const close = line.indexOf(q, v + 1);
					if (close === -1) break;
					if (hasNul) {
						let k = v + 1;
						while (k < close && line[k] !== '\u0000') k++;
						if (k < close) break;
					}
					p = close + 1;
				} else {
					const vStart = v;
					while (v < len && isUnquotedAttrChar(line[v])) v++;
					if (v === vStart) break;
					p = v;
				}
			}
		}
	}
	return false;
}

/** True when a single non-code line contains HTML outside inline code, autolinks, and link destinations. */
function lineHasHtml(line) {
	if (!line.includes('<')) return false;
	const cleaned = stripInlineCodeLine(line)
		.replace(/\\[^\n\u0000]/g, ' ')
		.replace(ANGLE_REF_DEST, '\u0000')
		.replace(ANGLE_LINK_DEST, '](\u0000')
		.replace(URI_AUTOLINK, '\u0000')
		.replace(EMAIL_AUTOLINK, '\u0000');
	if (!cleaned.includes('<')) return false;
	if (HTML_DECLARATION.test(cleaned)) return true;
	const piOpen = cleaned.indexOf('<?');
	if (piOpen !== -1) {
		const piClose = cleaned.lastIndexOf('?>');
		if (piClose >= piOpen + 2) {
			const nul = cleaned.indexOf('\u0000', piOpen + 2);
			if (nul === -1 || nul > piClose) return true;
		}
	}
	return hasHtmlTagOnLine(cleaned);
}

/**
 * True when the source contains HTML markup (comments, declarations, CDATA, processing instructions,
 * or opening/closing tags) outside fenced code blocks, CommonMark indented code blocks, and inline
 * code spans. Markdown autolinks (`<https://...>`, `<mailto:...>`, other `<scheme:...>`, `<name@host>`),
 * angle-bracket link destinations (`[f](<...>)`), and backslash-escaped `<` are excluded.
 * Scans each line once in O(N) worst-case time over a document of N characters.
 */
function hasHtmlMarkup(text) {
	const lines = String(text ?? '').split(/\r?\n/);
	let fenceChar = '';
	let fenceLen = 0;
	let fenceQuotes = 0;
	let fenceMinIndent = 0;
	let lastQuotes = 0;
	let inParagraph = false;
	/** @type {number[]} */
	let listIndents = [];

	for (const rawLine of lines) {
		const { quotes, rest, startCol } = stripBlockquotes(rawLine);
		if (quotes !== lastQuotes) {
			listIndents = [];
			inParagraph = false;
			lastQuotes = quotes;
		}
		const ws = measureIndent(rest, 0, startCol);
		const isBlank = ws.index === rest.length;

		if (fenceChar) {
			if (quotes < fenceQuotes) {
				fenceChar = '';
				fenceLen = 0;
				fenceQuotes = 0;
				fenceMinIndent = 0;
			} else if (isBlank) {
				continue;
			} else if (ws.indent < fenceMinIndent) {
				fenceChar = '';
				fenceLen = 0;
				fenceQuotes = 0;
				fenceMinIndent = 0;
			} else {
				const relIndent = ws.indent - fenceMinIndent;
				if (relIndent <= 3) {
					const close = rest.slice(ws.index).match(FENCE_CLOSE);
					if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
						fenceChar = '';
						fenceLen = 0;
						fenceQuotes = 0;
						fenceMinIndent = 0;
					}
				}
				continue;
			}
		}

		if (isBlank) {
			inParagraph = false;
			continue;
		}

		let indent = ws.indent;
		let col = ws.col;
		let index = ws.index;

		while (listIndents.length > 0 && indent < listIndents[listIndents.length - 1]) {
			listIndents.pop();
		}
		let containerIndent = listIndents.length > 0 ? listIndents[listIndents.length - 1] : 0;
		let relIndent = indent - containerIndent;

		// CommonMark indented code block: 4+ columns relative to container, and cannot interrupt a paragraph.
		if (!inParagraph && relIndent >= 4) {
			continue;
		}

		// Consume any nested list markers at this container level (indented 0–3 columns).
		let indentedCodeOnListLine = false;
		while (relIndent <= 3 && index < rest.length) {
			const tail = rest.slice(index);
			if (THEMATIC_BREAK.test(tail)) break;
			const markerMatch = tail.match(LIST_MARKER);
			if (!markerMatch) break;
			const markerLen = markerMatch[0].length;
			const afterMarkerIndex = index + markerLen;
			const afterMarkerCol = col + markerLen;
			const afterWs = measureIndent(rest, afterMarkerIndex, afterMarkerCol);
			inParagraph = false;
			if (afterWs.index === rest.length) {
				listIndents.push(indent + markerLen + 1);
				index = rest.length;
				break;
			}
			const contentIndent =
				afterWs.indent <= 4 ? indent + markerLen + afterWs.indent : indent + markerLen + 1;
			listIndents.push(contentIndent);
			containerIndent = contentIndent;
			indent = indent + markerLen + afterWs.indent;
			col = afterWs.col;
			index = afterWs.index;
			relIndent = indent - containerIndent;
			if (relIndent >= 4) {
				indentedCodeOnListLine = true;
				break;
			}
		}

		if (indentedCodeOnListLine || index >= rest.length) {
			continue;
		}

		const content = rest.slice(index);

		if (relIndent <= 3) {
			const open = content.match(FENCE_OPEN);
			if (open && (open[1][0] === '~' || !open[2].includes('`'))) {
				fenceChar = open[1][0];
				fenceLen = open[1].length;
				fenceQuotes = quotes;
				fenceMinIndent = containerIndent;
				inParagraph = false;
				continue;
			}
		}

		if (lineHasHtml(content)) return true;

		if (relIndent <= 3 && (ATX_HEADING.test(content) || THEMATIC_BREAK.test(content))) {
			inParagraph = false;
		} else {
			inParagraph = true;
		}
	}

	return false;
}

/**
 * Why a Markdown document must stay in source mode, as a short plain phrase, or null when the visual
 * editor can hold it without loss. Run it once when a document opens or when the user asks for Visual;
 * it is far too costly to run on every keystroke.
 */
export function visualMarkdownBlocker(text) {
	// A new or empty document has nothing to lose; the editor starts it as one empty paragraph.
	if (!String(text ?? '').trim()) return null;
	let tokens;
	try {
		tokens = marked.lexer(text);
	} catch {
		// A document the parser cannot read must stay in source mode rather than be rewritten.
		return 'text the editor could not read';
	}
	// Deliberate policies ahead of the round-trip check: the editor has no underlined heading, and
	// would escape HTML outside code into entities instead of keeping the user's bytes.
	if (hasSetextHeading(tokens)) return 'headings underlined with --- or ===';
	if (hasHtmlMarkup(text)) return HTML_BLOCKER;
	if (preserved(text, tokens)) return null;
	// Refused. An image or definition anywhere in the document is itself a loss (the editor keeps neither),
	// and naming it is more useful than the block around it. Otherwise find the block responsible.
	const named = namedConstruct(tokens);
	if (named) return named;
	for (const token of tokens) {
		if (token.type === 'space') continue;
		if (!preserved(token.raw, [token])) return nameBlock(token);
	}
	return 'text the editor would rewrite';
}

export function visualMarkdownSupported(text) {
	return visualMarkdownBlocker(text) === null;
}
