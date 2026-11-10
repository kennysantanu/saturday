import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReleaseNotes, parseInlines } from '../src/lib/release-notes.js';

test('release notes parse headings, lists, paragraphs and safe inline formatting', () => {
	const blocks = parseReleaseNotes(
		[
			'## Saturday 0.1.2',
			'',
			'Updates are **safer** and easier to follow.',
			'Second line of the same paragraph.',
			'',
			'### Updates',
			'- See `0.1.1 → 0.1.2` before installing',
			'* Read the [installation guide](https://github.com/example/docs)',
			'  with a continuation line',
			'#### Deep heading ###'
		].join('\r\n')
	);
	assert.deepEqual(blocks, [
		{ type: 'heading', level: 2, inlines: [{ type: 'text', text: 'Saturday 0.1.2' }] },
		{
			type: 'paragraph',
			inlines: [
				{ type: 'text', text: 'Updates are ' },
				{ type: 'strong', text: 'safer' },
				{ type: 'text', text: ' and easier to follow. Second line of the same paragraph.' }
			]
		},
		{ type: 'heading', level: 3, inlines: [{ type: 'text', text: 'Updates' }] },
		{
			type: 'list',
			items: [
				[
					{ type: 'text', text: 'See ' },
					{ type: 'code', text: '0.1.1 → 0.1.2' },
					{ type: 'text', text: ' before installing' }
				],
				[
					{ type: 'text', text: 'Read the ' },
					{ type: 'link', text: 'installation guide', href: 'https://github.com/example/docs' },
					{ type: 'text', text: ' with a continuation line' }
				]
			]
		},
		{ type: 'heading', level: 3, inlines: [{ type: 'text', text: 'Deep heading' }] }
	]);
});

test('release notes never produce markup or unsafe links', () => {
	assert.deepEqual(parseInlines('<img src=x onerror=alert(1)> [x](javascript:alert(1))'), [
		{ type: 'text', text: '<img src=x onerror=alert(1)> [x](javascript:alert(1))' }
	]);
	assert.deepEqual(parseReleaseNotes(''), []);
	assert.deepEqual(parseReleaseNotes(undefined), []);
});
