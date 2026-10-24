export type Tag = {
	id: number;
	name: string;
	display_name: string;
	color: string;
	usage_count?: number;
	unavailable?: boolean;
};
export type TagPage = {
	tags: Tag[];
	total: number;
	totalPages: number;
	page: number;
	limit: number;
	invalid_query?: boolean;
};
export type TagPickerData = TagPage & { selectedTags: Tag[] };
export type TagCollection = 'job' | 'person';
