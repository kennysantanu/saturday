import { listTags, getTagSelection } from './tags.js';
export function tagPickerData(collection, ids = []) {
	return {
		...listTags({ collection }),
		selectedTags: getTagSelection({ collection, tag_ids: ids })
	};
}
export function tagFormValues(data) {
	const values = Object.fromEntries(
		Array.from(data.entries(), ([key, value]) => [key, typeof value === 'string' ? value : ''])
	);
	if (data.get('tags_present') === '1') values.tag_ids = data.getAll('tag_ids');
	else delete values.tag_ids;
	return values;
}

export function tagFailureSelection(collection, values) {
	const ids = Array.isArray(values.tag_ids)
		? values.tag_ids.filter(
				(id) => /^[1-9]\d*$/.test(String(id)) && Number.isSafeInteger(Number(id))
			)
		: [];
	return getTagSelection({ collection, tag_ids: ids });
}
