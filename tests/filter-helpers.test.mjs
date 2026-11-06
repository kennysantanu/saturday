import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reminderLabel, resultCount, readableKey, filterLabels } from '../src/lib/filter-labels.js';
import { buildChips, hrefWithout, hrefWithoutValue, tagChips } from '../src/lib/filter-chips.js';

test('reminder labels treat legacy unset and not_scheduled as the same "Not set"', () => {
	assert.equal(reminderLabel('unset'), 'Not set');
	assert.equal(reminderLabel('not_scheduled'), 'Not set');
	assert.equal(reminderLabel('all'), 'Any');
	assert.equal(reminderLabel('mystery'), 'mystery');
});

test('resultCount uses natural language for filtered and unfiltered lists', () => {
	assert.equal(resultCount(1, { one: 'job', many: 'jobs' }), '1 job');
	assert.equal(
		resultCount(3, { one: 'job', many: 'jobs', filtered: true }),
		'3 jobs matching filters'
	);
	assert.equal(
		resultCount(2, { one: 'person', many: 'people', scope: 'in your network' }),
		'2 people in your network'
	);
	assert.equal(
		resultCount(0, {
			one: 'document',
			many: 'documents',
			filtered: true,
			qualifier: 'matching search'
		}),
		'0 documents matching search'
	);
});

test('readableKey and filterLabels give one vocabulary', () => {
	assert.equal(readableKey('follow_up_from'), 'follow up from');
	assert.equal(filterLabels.apply, 'Apply filters');
	assert.equal(filterLabels.clearSearch, 'Clear search');
});

test('hrefWithout drops the named filters and always resets paging', () => {
	const params = new URLSearchParams('name=ada&role=eng&sort=name&page=3');
	assert.equal(hrefWithout('/networks', params, 'name'), '/networks?role=eng&sort=name');
	assert.equal(hrefWithout('/networks', new URLSearchParams('page=2'), 'name'), '/networks');
});

test('hrefWithoutValue removes only one repeated value', () => {
	const params = new URLSearchParams('tag_ids=1&tag_ids=2&sort=name&page=2');
	assert.equal(
		hrefWithoutValue('/networks', params, 'tag_ids', 2),
		'/networks?sort=name&tag_ids=1'
	);
});

test('buildChips skips empty and default values and formats the rest', () => {
	const params = new URLSearchParams('name=ada&follow_up=overdue&role=');
	const chips = buildChips('/networks', params, { name: 'ada', role: '', follow_up: 'overdue' }, [
		['name', 'Name contains'],
		['role', 'Role contains'],
		['follow_up', 'Reminder', { skip: 'all', format: reminderLabel }]
	]);
	assert.deepEqual(
		chips.map((chip) => [chip.key, chip.label, chip.href]),
		[
			['name', 'Name contains: ada', '/networks?follow_up=overdue&role='],
			['follow_up', 'Reminder: Overdue', '/networks?name=ada&role=']
		]
	);
	assert.deepEqual(
		buildChips('/networks', params, { follow_up: 'all' }, [
			['follow_up', 'Reminder', { skip: 'all' }]
		]),
		[]
	);
});

test('tagChips link to the list without just that tag and keep its color', () => {
	const params = new URLSearchParams('tag_ids=1&tag_ids=2');
	const chips = tagChips('/networks', params, [
		{ id: 1, display_name: 'remote', color: '#112233' },
		{ id: 2, display_name: 'warm lead', color: '#445566' }
	]);
	assert.equal(chips[0].href, '/networks?tag_ids=2');
	assert.equal(chips[1].href, '/networks?tag_ids=1');
	assert.equal(chips[0].color, '#112233');
});
