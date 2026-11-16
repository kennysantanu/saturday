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
 * The editor's Markdown extension, given a Marked instance of its own. Left alone it would use marked's
 * global instance, onto which Tiptap registers its table and task tokenizers; any other reader sharing that
 * instance would then make the same mistakes as the editor and hide them.
 */
export const privateMarkdown = () => Markdown.configure({ marked: new Marked() });
