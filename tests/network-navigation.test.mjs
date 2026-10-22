import test from 'node:test';
import assert from 'node:assert/strict';
import {
	networkReturn,
	networkDetailUrl,
	networkEditReturn
} from '../src/lib/network-navigation.js';

test('person return links preserve Network filters and job context without unsafe or recursive destinations', () => {
	const results = '/networks?name=Alex&organization=Acme&sort=follow_up&page=3';
	assert.equal(networkReturn(results), results);
	const job =
		'/jobs/12?' +
		new URLSearchParams({
			return_to: '/?pipeline_page_2=3#job-pipeline',
			network_page: '2',
			saved: 'job',
			link_person: '1'
		});
	const target = new URL(networkReturn(job), 'http://saturday.local');
	assert.equal(target.pathname, '/jobs/12');
	assert.equal(target.searchParams.get('return_to'), '/?pipeline_page_2=3#job-pipeline');
	assert.equal(target.searchParams.get('network_page'), '2');
	assert(!target.searchParams.has('saved'));
	assert(!target.searchParams.has('link_person'));
	assert.equal(networkReturn('/networks?return_to=/jobs/12&saved=person&/unlink='), '/networks');
	for (const value of [
		undefined,
		'https://evil.example/networks',
		'//evil.example/networks',
		'/\\evil.example/networks',
		'/networks\n',
		'/settings',
		'/networks/2',
		'/jobs/0',
		'/jobs/1/edit',
		'/jobs/9007199254740992',
		'/' + 'x'.repeat(4000)
	])
		assert.equal(networkReturn(value), '/networks', String(value));
	assert.equal(
		new URL(
			networkReturn('/jobs/12?return_to=https://evil.example'),
			'http://saturday.local'
		).searchParams.get('return_to'),
		'/jobs'
	);
});

test('person edit returns only to the same person and retains independent pages and the validated origin', () => {
	const origin = '/networks?name=Alex&page=3';
	const detail = networkDetailUrl(
		7,
		origin,
		new URLSearchParams({ jobs_page: '2', updates_page: '3', link_job: '1' })
	);
	assert.equal(networkEditReturn(detail, 7), detail);
	const url = new URL(detail, 'http://saturday.local');
	assert.equal(url.searchParams.get('return_to'), origin);
	assert.equal(url.searchParams.get('jobs_page'), '2');
	assert.equal(url.searchParams.get('updates_page'), '3');
	assert(!url.searchParams.has('link_job'));
	for (const destination of [
		'/networks/8',
		'/jobs/7',
		'//evil.example',
		'/networks/7?return_to=//evil.example'
	])
		assert.equal(networkEditReturn(destination, 7), networkDetailUrl(7));
	assert.equal(networkEditReturn(detail + '&saved=person&/unlink=', 7), detail);
});
