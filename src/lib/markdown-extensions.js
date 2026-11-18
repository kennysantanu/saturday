import StarterKit from '@tiptap/starter-kit';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Marked } from 'marked';
import { Markdown } from '@tiptap/markdown';

/**
 * The one extension set behind the visual Markdown editor. The editor adds the Markdown extension on top
 * of it; the gate that decides whether a document may open visually builds its manager from the very same
 * list, so the two can never disagree about how a document is read or written.
 */
export function markdownExtensions() {
	return [
		StarterKit.configure({
			link: {
				openOnClick: false,
				autolink: false,
				protocols: ['https', 'http', 'mailto'],
				isAllowedUri: (/** @type {string} */ url) => /^(https?:|mailto:|\/[^/]|#)/i.test(url)
			},
			underline: false
		}),
		Table,
		TableRow,
		TableHeader,
		TableCell,
		TaskList,
		TaskItem.configure({ nested: true })
	];
}

/**
 * A Marked instance on which HTML is plain text. Saturday's visual editor does not interpret embedded HTML:
 * a tag in Markdown is shown, edited and saved as the text it is. Marked lexes HTML in two places, `html`
 * for blocks and `tag` for inline fragments, so both are switched off (returning nothing, not `false`,
 * stops the fallback to the built-in tokenizer). With only `html` overridden every inline tag still
 * becomes an HTML token, which Tiptap then hands to the browser's DOMParser; there `<style>` or `<script>`
 * swallows the text after it, while Node, which has no DOMParser, keeps it as text. Never reaching that
 * path makes the browser and the server read a document identically.
 *
 * Every reader gets an instance of its own: the editor's Markdown extension registers its table and task
 * tokenizers on whichever instance it is given.
 */
export function literalHtmlMarked() {
	const instance = new Marked();
	instance.use({
		tokenizer: {
			html() {
				return undefined;
			},
			tag() {
				return undefined;
			}
		}
	});
	return instance;
}

/**
 * The editor's Markdown extension, given a literal-HTML Marked instance of its own. Left alone it would use
 * marked's global instance, onto which Tiptap registers its table and task tokenizers and which would read
 * HTML as markup; any other reader sharing that instance would make the same mistakes as the editor and
 * hide them.
 */
export const privateMarkdown = () => Markdown.configure({ marked: literalHtmlMarked() });
