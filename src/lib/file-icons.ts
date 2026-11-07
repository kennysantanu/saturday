import type { Component } from 'svelte';
import FileAudio from '@lucide/svelte/icons/file-audio';
import FileVideo from '@lucide/svelte/icons/file-video';
import FileChartColumn from '@lucide/svelte/icons/file-chart-column';
import FileText from '@lucide/svelte/icons/file-text';
import FileCode from '@lucide/svelte/icons/file-code';
import FileImage from '@lucide/svelte/icons/file-image';
import FileArchive from '@lucide/svelte/icons/file-archive';
import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
import FileIcon from '@lucide/svelte/icons/file';
import { fileType } from '$lib/file-types';

const icons: Record<string, Component<{ class?: string }>> = {
	markdown: FileText,
	text: FileText,
	pdf: FileText,
	html: FileCode,
	image: FileImage,
	sheet: FileSpreadsheet,
	archive: FileArchive,
	document: FileText,
	audio: FileAudio,
	video: FileVideo,
	presentation: FileChartColumn
};

/** The bare file icon for a filename, shared by Documents, Profile and the document picker. */
export const fileIconFor = (filename: string) => icons[fileType(filename).icon] ?? FileIcon;
