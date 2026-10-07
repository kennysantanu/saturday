export function fileType(filename) {
	const extension = filename.includes('.') ? filename.split('.').at(-1)?.toLowerCase() : '';
	const type =
		{ md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html', txt: 'text', pdf: 'pdf' }[
			extension
		] ?? 'other';
	let icon = type;
	if (/^(docx?|odt|rtf)$/.test(extension)) icon = 'document';
	else if (/^(pptx?|odp)$/.test(extension)) icon = 'presentation';
	else if (/^(mp3|wav|ogg|m4a|flac|aac)$/.test(extension)) icon = 'audio';
	else if (/^(mp4|webm|mov|mkv|avi)$/.test(extension)) icon = 'video';
	else if (/^(png|jpe?g|webp|gif|avif|bmp|tiff?|heic|svg)$/.test(extension)) icon = 'image';
	else if (/^(xlsx?|ods|csv|tsv)$/.test(extension)) icon = 'sheet';
	else if (/^(zip|7z|rar|tar|gz|bz2|xz)$/.test(extension)) icon = 'archive';
	return {
		type,
		icon,
		label:
			{
				markdown: 'Markdown',
				html: 'HTML',
				text: 'Text',
				pdf: 'PDF',
				image: 'Image',
				sheet: 'Spreadsheet',
				archive: 'Archive',
				document: 'Document',
				presentation: 'Presentation',
				audio: 'Audio',
				video: 'Video'
			}[icon] ?? 'File',
		text: ['markdown', 'html', 'text'].includes(type),
		preview: type !== 'other'
	};
}
// Be conservative: unsupported constructs stay in source mode, never silently disappear.
export function visualMarkdownSupported(text) {
	return !/(<\/?[a-z!]|!\[|\||\[[ x]\]|^\s*\[.*\]:|\$\$|^\s*:::|~~|^\s*[^\n]+\n\s*[-=]{2,}\s*$)/im.test(
		text
	);
}
