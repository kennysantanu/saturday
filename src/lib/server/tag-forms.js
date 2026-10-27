import { listTags, getTagSelection } from './application.js';
export async function tagPickerData(collection, ids = []) {
	return {
		...(await listTags({ collection })),
		selectedTags: await getTagSelection({ collection, tag_ids: ids })
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
export async function tagFailureSelection(collection, values) {
	const ids = Array.isArray(values.tag_ids)
		? values.tag_ids.filter(
				(id) => /^[1-9]\d*$/.test(String(id)) && Number.isSafeInteger(Number(id))
			)
		: [];
	return await getTagSelection({ collection, tag_ids: ids });
}
