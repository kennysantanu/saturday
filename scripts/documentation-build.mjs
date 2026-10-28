import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentationRegistry } from '../src/lib/documentation/registry.js';

export const headingSlug = (text) =>
	text
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/<[^>]+>/g, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}_\- ]/gu, '')
		.replace(/ /g, '-');
export function headings(markdown) {
	const result = [],
		counts = new Map();
	let fence = null,
		offset = 0;
	for (const line of markdown.split(/(?<=\n)/)) {
		const marker = line.match(/^\s*(`{3,}|~{3,})/);
		if (marker) {
			if (!fence) fence = marker[1][0];
			else if (fence === marker[1][0]) fence = null;
		} else if (!fence) {
			const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
			if (match) {
				const title = match[2],
					slug = headingSlug(title),
					count = counts.get(slug) ?? 0;
				counts.set(slug, count + 1);
				result.push({ title, id: slug + (count ? `-${count}` : ''), offset });
			}
		}
		offset += line.length;
	}
	return result;
}
export function buildDocumentation(root = fileURLToPath(new URL('../', import.meta.url))) {
	const cache = new Map();
	const read = (path) => {
		if (!cache.has(path)) cache.set(path, readFileSync(path, 'utf8'));
		return cache.get(path);
	};
	const documents = documentationRegistry.map((definition) => {
		const path = resolve(root, definition.source),
			markdown = read(path),
			found = headings(markdown);
		if (!found.length) throw new Error(`Documentation has no headings: ${definition.source}`);
		// Check every relative target and Markdown anchor in the maintained bundle.
		const withoutCode = markdown.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '');
		for (const match of withoutCode.matchAll(/\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
			const link = match[1].replace(/^<|>$/g, '');
			if (/^[a-z][a-z\d+.-]*:/i.test(link)) continue;
			const [file, anchor] = link.split('#'),
				target = file ? resolve(dirname(path), decodeURIComponent(file)) : path;
			if (!existsSync(target))
				throw new Error(`Missing documentation target ${definition.source}: ${link}`);
			if (
				anchor &&
				extname(target) === '.md' &&
				!headings(read(target)).some((h) => h.id === decodeURIComponent(anchor))
			)
				throw new Error(`Missing documentation anchor ${definition.source}: ${link}`);
		}
		const sections = [];
		if (found[0].offset) found.unshift({ id: 'introduction', title: definition.title, offset: 0 });
		for (let index = 0; index < found.length; index++) {
			const heading = found[index];
			let content = markdown.slice(heading.offset, found[index + 1]?.offset ?? markdown.length),
				part = 1;
			while (content.length) {
				let end = Math.min(content.length, 7000);
				if (end < content.length) {
					const boundary = content.lastIndexOf('\n', end);
					if (boundary > 3500) end = boundary + 1;
				}
				sections.push({
					id: heading.id + (part > 1 ? `--part-${part}` : ''),
					title: heading.title + (part > 1 ? ` (part ${part})` : ''),
					source: `${definition.source}#${heading.id}`,
					markdown: content.slice(0, end)
				});
				content = content.slice(end);
				part++;
			}
		}
		return { ...definition, markdown, sections };
	});
	for (const [id, topic] of [
		['installation', 'password'],
		['installation', 'LAN'],
		['installation', 'Updates'],
		['usage', 'reminders'],
		['contributing', 'development'],
		['extensions', 'extension']
	]) {
		if (
			!documents
				.find((d) => d.id === id)
				?.markdown.toLowerCase()
				.includes(topic.toLowerCase())
		)
			throw new Error(`Required help topic missing: ${id}/${topic}`);
	}
	return documents;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	console.log(`Checked ${buildDocumentation().length} bundled guides and their links.`);
