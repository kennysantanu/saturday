import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	visualMarkdownSupported,
	visualMarkdownSignature,
	visualMarkdownBlocker,
	visualMarkdownRoundTrip,
	visualEditorLoss,
	visualEditorMarkdown,
	visualEditorParse,
	visualEditorSchema
} from '../src/lib/markdown-visual.js';
import { EditorState } from '@tiptap/pm/state';
import { marked as globalMarked } from 'marked';
import { formatAge } from '../src/lib/dates.js';
import {
	markdownExtensions,
	privateMarkdown,
	literalHtmlMarked
} from '../src/lib/markdown-extensions.js';

test('visual markdown accepts pipes in prose, horizontal rules and strike', () => {
	assert(visualMarkdownSupported('**Email:** a@b.c | **Phone:** 555'));
	assert(visualMarkdownSupported('Intro paragraph\n\n---\n\nMore text'));
	assert(visualMarkdownSupported('# Title\n\n---\n'));
	assert(visualMarkdownSupported('Some ~~old~~ text'));
	// A `---` line that is not a whole underline is ordinary prose, not a setext heading.
	assert(visualMarkdownSupported('text\n---ordinary'));
	// Table-shaped text inside code is code, not a table.
	assert(visualMarkdownSupported('```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```'));
	assert(visualMarkdownSupported('Use `a | b` in prose'));
	// An ATX heading followed by `---` is a heading plus a horizontal rule, not a setext heading.
	assert(visualMarkdownSupported('# Contact\n---\nEmail: a@b.c | Phone: 555'));
	assert(visualMarkdownSupported('# Jane Doe\n---\n## Experience'));
	// An escaped pipe makes this prose, but the editor would write it back as a different document
	// ("a", a stray line, then "|b"), so the round trip keeps it in source mode.
	assert(!visualMarkdownSupported('a\\|b\n---|---'));
	assert(visualMarkdownSupported('a\\|b'));
});

test('visual markdown still rejects constructs the editor cannot keep, because they are lost', () => {
	for (const text of [
		'![alt](x.png)',
		'[ref]: https://example.com',
		'Text[^1]\n\n[^1]: Footnote',
		'Heading\n---',
		'Heading\n===',
		'Heading\n=',
		'Title\n---\n\n',
		'- Heading\n  ==='
	])
		assert(!visualMarkdownSupported(text), text);
	// `$$` and `:::` are plain text to the parser, so the editor keeps them as written.
	assert(visualMarkdownSupported('$$\nx^2\n$$'));
	assert(visualMarkdownSupported('::: note\nhi\n:::'));
});

// The gate round-trips with markdownExtensions(), the very list MarkdownEditor registers.
const roundTrip = visualMarkdownRoundTrip;

test('the editor and the gate share one extension configuration', () => {
	const editor = readFileSync('src/lib/components/app/markdown-editor.svelte', 'utf8');
	assert.match(editor, /\.\.\.markdownExtensions\(\), privateMarkdown\(\)/);
	assert(!/StarterKit|extension-table|extension-list/.test(editor), 'no second extension list');
	const names = markdownExtensions().map((extension) => extension.name);
	for (const name of ['starterKit', 'table', 'tableRow', 'tableHeader', 'tableCell', 'taskList'])
		assert(names.includes(name), name);
	const gate = readFileSync('src/lib/markdown-visual.js', 'utf8');
	assert.match(gate, /markdownExtensions\(\)/);
});

test('the editor and the gate each read with a Marked instance of their own', () => {
	const first = privateMarkdown().options.marked;
	const second = privateMarkdown().options.marked;
	assert(first && second && first !== second, 'every editor gets its own instance');
	assert.notEqual(first, globalMarked, 'never the global instance');
	const gate = readFileSync('src/lib/markdown-visual.js', 'utf8');
	assert.match(gate, /new MarkdownManager\(\{ extensions, marked: literalHtmlMarked\(\) \}\)/);
	assert.match(gate, /const reader = literalHtmlMarked\(\)/);
	assert(!/new Marked\(\)/.test(gate), 'every instance comes from the literal-HTML factory');
	assert.notEqual(literalHtmlMarked(), literalHtmlMarked(), 'the factory never shares an instance');
});

test('the editor never re-runs the gate per keystroke and guards the save', () => {
	const source = readFileSync('src/lib/components/app/document-editor.svelte', 'utf8');
	assert(!/\$derived\(visualMarkdownBlocker/.test(source), 'gate is cached per revision');
	assert.match(source, /guardedSave/);
	assert.match(source, /input\.cancel\(\)/);
	const editor = readFileSync('src/lib/components/app/markdown-editor.svelte', 'utf8');
	assert.match(editor, /event\.key === 'Enter' && inTableCell/);
});

test('text a Tiptap list item would truncate keeps the document in source mode', () => {
	// Tiptap strips two characters from every continuation line regardless of its real indent.
	for (const text of ['- [ ] task\n second', '- [x] done\n\tmore text'])
		assert(!visualMarkdownSupported(text), text);
	assert.match(visualMarkdownBlocker('- [ ] task\n second'), /task list/);
	// An ordinary bullet keeps its lazy continuation line, so it needs no protection.
	assert(visualMarkdownSupported('- item\n second'));
	// A continuation the editor would turn into a second paragraph is a structural change, so it too
	// stays in source mode; a nested checkbox is held faithfully and stays visual.
	assert(!visualMarkdownSupported('- [ ] task\n  second'));
	assert(visualMarkdownSupported('- [ ] task\n  - [x] sub'));
});

test('table cells whose code would change keep the document in source mode', () => {
	const header = '| a | b |\n| --- | --- |\n';
	assert(!visualMarkdownSupported(`${header}| \`x  y\` | z |`));
	assert.match(visualMarkdownBlocker(`${header}| \`x  y\` | z |`), /table/);
	// Whitespace outside code is collapsed by Markdown itself, so that is not a loss.
	assert(visualMarkdownSupported(`${header}| x   y | \`x y\` |`));
});

// Types one space into the code span `x y` of a table cell, as a person would, on the live document.
function typeSpaceIntoCode(json) {
	let state = EditorState.create({ doc: visualEditorSchema().nodeFromJSON(json) });
	let at = -1;
	state.doc.descendants((node, pos) => {
		if (node.isText && node.text === 'x y' && node.marks.some((m) => m.type.name === 'code'))
			at = pos + 1;
	});
	assert(at > 0, 'found the code span');
	state = state.apply(state.tr.insertText(' ', at));
	let typed = '';
	state.doc.descendants((node) => {
		if (node.isText && node.marks.some((m) => m.type.name === 'code')) typed = node.text;
	});
	assert.equal(typed, 'x  y', 'the live document now holds two spaces');
	return state.doc.toJSON();
}

test('a space typed inside code in a table cell is caught on the live document, not lost', () => {
	const accepted = '| a | b |\n| --- | --- |\n| `x y` | z |';
	assert.equal(visualMarkdownBlocker(accepted), null, 'the starting document opens visually');
	const opened = visualEditorParse(accepted);
	assert.equal(visualEditorLoss(opened), null, 'untouched, nothing would be lost');
	const typed = typeSpaceIntoCode(opened);
	const written = visualEditorMarkdown(typed);
	// What the old guard saw: the writer already squeezed the space out, and that text reads back cleanly.
	assert.match(written, /`x y`/);
	assert.equal(visualMarkdownBlocker(written), null, 'checking only the written text sees nothing');
	assert.equal(written, visualEditorMarkdown(opened), 'the edit vanished from the Markdown');
	// The guard compares the live document with what the written text reads back as.
	assert.match(visualEditorLoss(typed), /change/);
});

test('an empty or new document opens visually', () => {
	for (const text of ['', '\n', '  \n\n']) assert.equal(visualMarkdownBlocker(text), null, text);
	assert.equal(visualEditorLoss({ type: 'doc', content: [{ type: 'paragraph' }] }), null);
});

test('ordinary edits are not mistaken for loss', () => {
	const text =
		'# Title\n\nSome **bold** and `code` text.\n\n- [ ] one\n- [x] two\n\n| a | b |\n| --- | --- |\n| `x y` | z |\n';
	let state = EditorState.create({
		doc: visualEditorSchema().nodeFromJSON(visualEditorParse(text))
	});
	state = state.apply(state.tr.insertText(' more words', 9));
	assert.equal(visualEditorLoss(state.doc.toJSON()), null);
	// A blank paragraph cannot be kept by Markdown and is not worth refusing a save over.
	const withBlank = visualEditorParse(`${text}\nEnd.`);
	withBlank.content.splice(1, 0, { type: 'paragraph' });
	assert.equal(visualEditorLoss(withBlank), null);
});

test('a cancelled save shows its notice, moves focus to it and names the loss', () => {
	const source = readFileSync('src/lib/components/app/document-editor.svelte', 'utf8');
	assert.match(source, /visualEditor\?\.saveBlocker\(\)/);
	assert.match(source, /bind:this=\{visualEditor\}/);
	// saveBlocked is rendered as a "Not saved yet" notice carrying the reason, and in the status lines.
	// A refused save and a refused copy both say "Not saved yet" and carry the reason; a refused switch
	// to Markdown has its own title because nothing was being saved.
	assert.match(
		source,
		/\{#if saveBlocked\}[\s\S]*?\{:else if noticeKind === 'copy'\}\s*<Notice tone="error" title="Not saved yet">[\s\S]*?\{saveBlocked\}[\s\S]*?\{:else\}\s*<Notice tone="error" title="Not saved yet">[\s\S]*?\{saveBlocked\}/
	);
	assert.match(
		source,
		/noticeKind === 'switch'\}\s*<Notice tone="error" title="Can’t show Markdown yet">[\s\S]*?\{saveBlocked\}/
	);
	// The status reports the blocked save, except for a switch refusal where no save was attempted.
	assert.match(
		source,
		/const status = \$derived\(\s*saveBlocked && noticeKind !== 'switch'\s*\?\s*'Not saved yet'/
	);
	assert.match(source, /refuse\(problem, 'save'\)/);
	assert.match(source, /refuse\(problem, 'copy'\)/);
	assert.match(source, /refuse\(problem, 'switch'\)/);
	assert.equal((source.match(/\{status\}/g) ?? []).length, 2, 'both status lines use it');
	// Focus moves to the notice once it exists.
	assert.match(
		source,
		/tick\(\)\.then\([\s\S]*?saveBlockedNote\?\.querySelector[\s\S]*?\.focus\(\)/
	);
	const editor = readFileSync('src/lib/components/app/markdown-editor.svelte', 'utf8');
	assert.match(
		editor,
		/export function saveBlocker\(\)[\s\S]*?visualEditorLoss\(editor\.getJSON\(\)\)/
	);
	assert.match(editor, /editor\.state\.doc\.eq\(baselineDoc\)/);
});

test('the gate follows the editor parser, not a lookalike', () => {
	// A code pipe splits the row for plain marked but not for the editor's repaired tokenizer, which then
	// meets an image it has no node for.
	const row = '| a | b |\n| --- | --- |\n| `a|b` | ![x](y.png) |';
	assert(!visualMarkdownSupported(row));
	assert(!visualMarkdownSupported('| a | b |\n| --- | --- |\n| `a|b` | [l](u) ![x](y.png) |'));
	// A hard break in a cell would be written as <br>, which reads back as text; only a live document can
	// hold one (Enter is ignored in a cell), and visualEditorLoss refuses to save it (see below).
	const cell = (content) => ({
		type: 'doc',
		content: [
			{
				type: 'table',
				content: [
					{
						type: 'tableRow',
						content: [
							{
								type: 'tableHeader',
								content: [{ type: 'paragraph', content }]
							}
						]
					}
				]
			}
		]
	});
	assert.equal(visualEditorLoss(cell([{ type: 'text', text: 'x' }])), null);
	assert.match(
		visualEditorLoss(
			cell([{ type: 'text', text: 'x' }, { type: 'hardBreak' }, { type: 'text', text: 'y' }])
		),
		/change/
	);
});

test('a document shaped like the demo script opens visually and survives the round trip', () => {
	const demo = [
		'# Demo \u2014 Saturday',
		'',
		'**Slot:** 12 minutes (3 intro / 6 demo / 3 close)',
		'',
		'---',
		'',
		'## PRE-FLIGHT',
		'',
		...Array.from(
			{ length: 9 },
			(_, n) => `- [ ] Step ${n + 1}. Know the number \`create_job\` \u2192 ok`
		),
		'',
		'> "Quote with **bold** and _emphasis_.',
		'>',
		'> Second paragraph."',
		'',
		'### One \u2014 where the data lives',
		'',
		'| Time  | Screen         | Line                                  |',
		'| ----- | -------------- | ------------------------------------- |',
		'| 5:00  | VM desktop     | "Clean Windows 11." it took 4 minutes |',
		'| 5:30  | **Tool calls** | _"Add this job to Saturday."_         |',
		'| 6:20  | Browser \u2192 Jobs | `create_job` then **[Refresh]**       |',
		'',
		'**"Why not just use Notion?"**',
		'',
		'1. one',
		'2. two',
		''
	].join('\n');
	assert.equal(visualMarkdownBlocker(demo), null);
	const out = roundTrip(demo);
	assert.equal((out.match(/- \[ \]/g) ?? []).length, 9);
	for (const text of ['`create_job`', '5:30', 'Tool calls', 'Add this job to Saturday.'])
		assert(out.includes(text), text);
	assert.equal(roundTrip(out), out, 'a second pass changes nothing');
});

test('visual markdown accepts tables and task lists, and the editor keeps them', () => {
	const table = '| Time | Line |\n| --- | --- |\n| 5:00 | **bold** and `code` |';
	const tasks = '- [ ] first\n- [x] second\n  - [ ] nested';
	for (const text of [
		table,
		tasks,
		'a | b\n:-: | -:\n1 | 2',
		'> a | b\n> --- | ---\n> 1 | 2',
		'| a | b |\r\n| --- | --- |\r\n| 1 | 2 |'
	])
		assert(visualMarkdownSupported(text), text);
	// The serializer pads columns and widens the divider row; the cells themselves must be unchanged.
	const squash = (text) => text.replace(/-+/g, '-').replace(/ +/g, ' ').trim();
	assert.equal(squash(roundTrip(table)), squash(table));
	const kept = roundTrip(tasks);
	assert.match(kept, /- \[ \] first/);
	assert.match(kept, /- \[x\] second/);
	assert.match(kept, /\[ \] nested/);
	// A second pass changes nothing, so saving an untouched document is stable.
	for (const text of [table, tasks]) assert.equal(roundTrip(roundTrip(text)), roundTrip(text));
});

test('a mixed document keeps its table and checkboxes through the editor', () => {
	const text =
		'# Plan\n\n- [ ] one\n- [ ] two\n\n---\n\n| Time | Screen |\n| ---- | ------ |\n| 5:00 | VM |\n| 5:20 | Posting |\n\nEnd.';
	assert(visualMarkdownSupported(text));
	const out = roundTrip(text);
	assert.equal((out.match(/- \[ \]/g) ?? []).length, 2);
	assert.match(out, /\| 5:00 +\| VM +\|/);
	assert.match(out, /\| 5:20 +\| Posting +\|/);
	assert.match(out, /Time/);
});

test('the blocker names the construct that keeps a document in source mode', () => {
	const cases = [
		['![alt](x.png)', 'images'],
		['| a |\n| - |\n| ![x](y.png) |', 'images'],
		['[ref]: https://example.com', 'link or footnote definitions'],
		['Heading\n---', 'headings underlined with --- or ===']
	];
	for (const [text, reason] of cases) assert.equal(visualMarkdownBlocker(text), reason, text);
	assert.equal(visualMarkdownBlocker('# Fine\n\n- [ ] ok'), null);
});

// ---- HTML is literal text, and admission is decided by preservation ---------------------------------

// Synthetic prose of the reported shape. It is written for these tests; no user document is copied.
const websiteNotes = [
	'# Site notes',
	'',
	'- Put all CSS inside <style> in the <head>.',
	'- Use semantic HTML: <header>, <nav>, <main>, <section>, <footer>.',
	'- Project 1 -> project1.jpg',
	'- Wrap titles in <h1> and keep <script> at the end of <body>.',
	'',
	'The file must begin with <!DOCTYPE html>.',
	'',
	'After the <title> tag and a stray </body> the text goes on.'
].join('\n');

/** Every piece of text in an editor document, in order, without marks. */
function editorText(node, out = []) {
	if (node.text !== undefined) out.push(node.text);
	for (const child of node.content ?? []) editorText(child, out);
	return out;
}
const lastParagraphText = (json) => editorText(json.content.at(-1)).join('');
const plain = (markdown) => markdown.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const flat = (markdown) => plain(markdown).replace(/\\/g, '').replace(/\s+/g, ' ').trim();

function lexedTypes(tokens, found = new Set()) {
	for (const token of tokens) {
		found.add(token.type);
		for (const child of [
			token.tokens,
			...(token.items ?? []).map((item) => item.tokens),
			...(token.header ?? []).map((cell) => cell.tokens),
			...(token.rows ?? []).flat().map((cell) => cell.tokens)
		])
			if (child) lexedTypes(child, found);
	}
	return found;
}

// A table whose only cell holds the given inline content, as a live editor document.
const tableWith = (content) => ({
	type: 'doc',
	content: [
		{
			type: 'table',
			content: [
				{
					type: 'tableRow',
					content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content }] }]
				}
			]
		}
	]
});

test('prose that mentions HTML tag names opens visually and keeps every word', () => {
	assert.equal(visualMarkdownBlocker(websiteNotes), null);
	const written = plain(roundTrip(websiteNotes));
	for (const text of [
		'Put all CSS inside <style> in the <head>.',
		'<header>, <nav>, <main>, <section>, <footer>',
		'Project 1 -> project1.jpg',
		'<h1>',
		'<script> at the end of <body>',
		'The file must begin with <!DOCTYPE html>.',
		'After the <title> tag and a stray </body> the text goes on.'
	])
		assert(written.includes(text), text);
	// A second pass changes nothing, so repeated open and save cycles do not degrade the text.
	assert.equal(roundTrip(roundTrip(websiteNotes)), roundTrip(websiteNotes));
	for (const text of [
		'Put it in <style>.',
		'Use -> as an arrow.',
		'Begin with <!DOCTYPE html> here.',
		'- <header>, <footer>',
		'1. Open <html> then <body>',
		'> quoted <script> mention',
		'a < b and c > d',
		'Self-closing <br/> and <img src="a.png"> as text.'
	])
		assert.equal(visualMarkdownBlocker(text), null, text);
});

test('HTML is literal text: tags are kept as text and never swallow what follows', () => {
	// In a browser, a raw-text tag such as <style>, <script> or <title> swallows the content after it when it
	// reaches DOMParser, and <head>, <header> and a doctype produce nothing. They must never get that far.
	const tags = ['<style>', '<script>', '<title>', '<head>', '<header>', '<h1>', '<!DOCTYPE html>'];
	for (const tag of tags)
		for (const text of [
			`Before ${tag} after.\n\nFollowing paragraph.`,
			`- item with ${tag} inside\n- second item\n\nFollowing paragraph.`,
			`${tag}\n\nFollowing paragraph.`
		]) {
			const json = visualEditorParse(text);
			assert(editorText(json).join('').includes(tag), `${tag} stays as text in ${text}`);
			assert.equal(lastParagraphText(json), 'Following paragraph.', `text after ${tag} survives`);
			assert.equal(visualMarkdownBlocker(text), null, text);
		}
	// Complete blocks and paired inline tags are text too, not a container or an emphasis.
	assert.deepEqual(editorText(visualEditorParse('<div>real</div>\n\nAfter.')), [
		'<div>real</div>',
		'After.'
	]);
	const inline = visualEditorParse('a <em>hi</em> b');
	assert.deepEqual(editorText(inline), ['a <em>hi</em> b']);
	assert(!JSON.stringify(inline).includes('"marks"'), 'no emphasis mark');
	assert.equal(visualMarkdownBlocker('<div>real</div>\n\nAfter.'), null);
	assert.equal(visualMarkdownBlocker('a <em>hi</em> b'), null);
	// Comments are not special either: shown as text, nothing dropped.
	assert.deepEqual(editorText(visualEditorParse('<!-- note -->\n\nAfter.')), [
		'<!-- note -->',
		'After.'
	]);
	// Code keeps its literal code semantics.
	const code = '`<style>` and\n\n```html\n<style>\np { color: red }\n</style>\n```\n\nAfter.';
	assert.equal(visualMarkdownBlocker(code), null);
	assert.match(roundTrip(code), /```html\n<style>\np \{ color: red \}\n<\/style>\n```/);
});

test('neither Marked instance ever produces an HTML token, at block or inline level', () => {
	// Tiptap hands every html token to the browser's DOMParser. With both tokenizers off none exists, in the
	// editor's instance or in the gate's reader. Overriding only `html` would still leave inline tags.
	const samples = [
		'<div>block</div>',
		'a <em>inline</em> b',
		'- item <style> here',
		'| a |\n| - |\n| <b>x</b> |',
		'> <script>',
		'<!-- comment -->',
		'<!DOCTYPE html>'
	];
	for (const instance of [privateMarkdown().options.marked, literalHtmlMarked()])
		for (const sample of samples) {
			const types = lexedTypes(instance.lexer(sample));
			assert(!types.has('html'), `${sample} -> ${[...types]}`);
		}
	// The control: marked's own instance does produce them, so the check above can fail.
	assert(lexedTypes(globalMarked.lexer('a <em>b</em>')).has('html'));
	assert(lexedTypes(globalMarked.lexer('<div>b</div>')).has('html'));
});

test('equivalent spellings of the same text reach the same decision', () => {
	const pairs = [
		[
			'The file must begin with <!DOCTYPE html>.',
			'The file must begin with &lt;!DOCTYPE html&gt;.'
		],
		['Put CSS in <style> in <head>.', 'Put CSS in &lt;style&gt; in &lt;head&gt;.'],
		['Put CSS in <style>.', 'Put CSS in \\<style\\>.'],
		['Project 1 -> project1.jpg', 'Project 1 -&gt; project1.jpg'],
		['One.\n\nTwo.', 'One.\n\n\n\nTwo.']
	];
	for (const [raw, other] of pairs) {
		assert.equal(visualMarkdownBlocker(raw), null, raw);
		assert.equal(visualMarkdownBlocker(other), null, other);
		assert.equal(
			visualMarkdownSignature(raw).join('|'),
			visualMarkdownSignature(other).join('|'),
			`${raw} reads as ${other}`
		);
		assert.equal(flat(roundTrip(raw)), flat(roundTrip(other)));
	}
	// The same characters in different markup are a different meaning, and still differ.
	assert.notEqual(
		visualMarkdownSignature('a <b> c').join('|'),
		visualMarkdownSignature('a **b** c').join('|')
	);
});

test('losses are refused because the comparison finds them, and are named afterwards', () => {
	// The editor has no node for an image, so converting it keeps only its alt text. The conversion
	// completes and the JSON is valid; only the comparison notices.
	const inline = 'Some text ![alt](pic.png) more text.';
	assert.equal(roundTrip(inline), 'Some text alt more text.');
	assert.equal(visualMarkdownBlocker(inline), 'images');
	for (const text of [
		'![](pic.png)',
		'Photo: ![a photo](pic.png "Title") here',
		'- list item ![x](y.png)',
		'> quote ![x](y.png)',
		'**bold ![x](y.png)**',
		'[![badge](b.png)](https://example.com)',
		'| a | b |\n| - | - |\n| ![x](y.png) | z |',
		'![block](pic.png)',
		'Reference ![alt][pic] image.\n\n[pic]: pic.png',
		'Reference ![alt][pic] image.\n\n[pic]: pic.png "T"'
	])
		assert.equal(visualMarkdownBlocker(text), 'images', text);
	// Definitions carry information the editor drops.
	const definitions = 'link or footnote definitions';
	assert.equal(visualMarkdownBlocker('[ref]: https://example.com'), definitions);
	assert.equal(
		visualMarkdownBlocker('See [the site][ref].\n\n[ref]: https://example.com'),
		definitions
	);
	assert.equal(visualMarkdownBlocker('Text[^1]\n\n[^1]: Footnote'), definitions);
	// Loss in a document of otherwise ordinary prose still refuses it as a whole.
	assert.notEqual(visualMarkdownBlocker(`${websiteNotes}\n\nAnd a ![logo](logo.png) too.`), null);
	// Naming never admits: the same words without an image are admitted.
	assert.equal(visualMarkdownBlocker('Some text alt more text.'), null);
	assert.equal(visualMarkdownBlocker('A link [alt](pic.png) is fine.'), null);
});

test('schema success alone does not admit a document', () => {
	// This conversion yields a document the schema accepts and writes without error, so every schema-level
	// check passes; the lost image is found only by comparing meaning.
	const text = 'Some text ![alt](pic.png) more text.';
	const json = visualEditorParse(text);
	assert.doesNotThrow(() => visualEditorSchema().nodeFromJSON(json).check());
	assert.doesNotThrow(() => visualEditorMarkdown(json));
	assert.equal(visualEditorLoss(json), null, 'the live document reads back as itself');
	// The image is already gone from the parsed document, which is why the check above passes; only the
	// comparison against the source finds it. Remove the `image` signature case and these fail.
	const allText = (node) =>
		node.text ?? JSON.stringify(node.attrs ?? {}) + (node.content ?? []).map(allText).join('');
	assert(!allText(json).includes('pic.png'), 'the image destination is gone from the document');
	assert.notEqual(visualMarkdownBlocker(text), null);
	assert(!visualMarkdownSupported(text));
	const reference = 'Some text ![alt][pic] more text.\n\n[pic]: pic.png\n';
	const referenceJson = visualEditorParse(reference);
	assert(!allText(referenceJson).includes('pic.png'), 'the reference image is gone too');
	assert.notEqual(visualMarkdownBlocker(reference), null);
	assert(!visualMarkdownSupported(reference));
	// And schema validation still refuses what the schema cannot hold.
	assert.throws(() => roundTrip('![block](pic.png)'));
	assert.throws(() => roundTrip('[ref]: https://example.com'));
	assert.throws(() =>
		visualEditorSchema()
			.nodeFromJSON({ type: 'doc', content: [{ type: 'text', text: 'x' }] })
			.check()
	);
});

test('numeric character references are refused (known limitation, pinned)', () => {
	// The signature's entity decoding is narrower than Tiptap's, so `&#60;` reads back as `<` in the editor
	// but not in the comparison, and the document is refused as text the editor would rewrite. This is
	// pre-existing and deliberately not widened here; if the decoder grows, update this test with it.
	const text = 'a &#60; b';
	assert.match(visualMarkdownBlocker(text), /text the editor would rewrite/);
	assert(!visualMarkdownSupported(text));
});

test('the live document is still compared before a save, whatever the HTML policy', () => {
	assert.equal(
		visualEditorLoss(visualEditorParse(websiteNotes)),
		null,
		'literal tag text reads back'
	);
	const x = { type: 'text', text: 'x' };
	assert.equal(visualEditorLoss(tableWith([x])), null);
	// A hard break in a table cell is written as <br>, which reads back as text: still refused.
	assert.match(visualEditorLoss(tableWith([x, { type: 'hardBreak' }, x])), /change/);
});

test('admission has no syntax veto and HTML literalization is declared where it is applied', () => {
	const gate = readFileSync('src/lib/markdown-visual.js', 'utf8');
	assert(!/raw HTML/.test(gate), 'raw HTML is no longer a reason');
	assert(!/unsupportedTypes|firstUnsupported/.test(gate), 'no token-type pre-scan');
	const extensions = readFileSync('src/lib/markdown-extensions.js', 'utf8');
	assert.match(extensions, /html\(\)\s*\{\s*return undefined;/);
	assert.match(extensions, /tag\(\)\s*\{\s*return undefined;/);
});

test('age badge uses days, then months from 30 days, then years from 365 days', () => {
	const cases = [
		[1, '1d', '1 day'],
		[29, '29d', '29 days'],
		[30, '1mo', '1 month'],
		[59, '1mo', '1 month'],
		[60, '2mo', '2 months'],
		[364, '12mo', '12 months'],
		[365, '1y', '1 year'],
		[800, '2y', '2 years']
	];
	for (const [days, short, long] of cases) assert.deepEqual(formatAge(days), { short, long });
});

test('Jobs keeps Advanced filters collapsed for the milestone-history link only', () => {
	const source = readFileSync('src/routes/jobs/+page.svelte', 'utf8');
	const block = source.slice(source.indexOf('const advancedOpen'));
	assert.match(block.slice(0, 400), /key !== 'milestone_stage' && advancedKeys\.includes\(key\)/);
	for (const key of ['tag_ids', 'starred', 'title'])
		assert(source.includes(`'${key}'`), `${key} remains an advanced key`);
});
