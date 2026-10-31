import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import * as app from '../src/lib/server/application.js';
import { recentViewForPage } from '../src/lib/recent-navigation.js';

const saved = { ...process.env };
let scratch;
beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'saturday-recents-'));
	Object.assign(process.env, {
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(scratch, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(scratch, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(scratch, 'extensions'),
		SATURDAY_EXTENSIONS_PATH: join(scratch, 'code')
	});
	migrateDatabase();
});
afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
	Object.assign(process.env, saved);
});
const job = async (title = 'Engineer') => {
	const created = await app.createJob({ job_title: title, company_name: 'Example' });
	return app.getJob(created.id);
};
const view = (kind, record) =>
	app.recordRecentView({ kind, id: record.id, dataset_id: record.dataset_id });

test('reads do not record views; explicit views deduplicate, reorder and leave career records unchanged', async () => {
	const a = await job('First'),
		b = await job('Second');
	const p = await app.createNetwork({ name: 'Alex', organization: 'Example' });
	const person = await app.getNetwork(p.id);
	assert.deepEqual(await app.getNavigationSettings(), { enabled: true, limit: 10 });
	assert.equal((await app.listRecentViews()).jobs.length, 0);
	await view('job', a);
	await view('job', b);
	await view('person', person);
	await view('job', a);
	assert.deepEqual(
		(await app.listRecentViews()).jobs.map((row) => row.id),
		[a.id, b.id]
	);
	assert.equal((await app.listRecentViews()).people[0].title, 'Alex');
	assert.deepEqual(await app.getJob(a.id), a);
	assert.deepEqual(await app.getNetwork(person.id), person);
	await app.editJob(a.id, { job_title: 'Renamed' });
	await app.editNetwork(person.id, { organization: 'New organization' });
	assert.equal((await app.listRecentViews()).jobs[0].title, 'Renamed');
	assert.equal((await app.listRecentViews()).people[0].subtitle, 'New organization');
});

test('retains 50 per type, applies display limits and preserves history while disabled', async () => {
	for (let i = 0; i < 53; i++) {
		await view('job', await job(`Job ${i}`));
		const person = await app.createNetwork({ name: `Person ${i}` });
		await view('person', await app.getNetwork(person.id));
	}
	withDatabase((db) => {
		for (const table of ['recent_job_views', 'recent_network_views'])
			assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 50);
	});
	for (const limit of [5, 10, 20]) {
		await app.setNavigationSettings({ enabled: true, limit });
		const recent = await app.listRecentViews();
		assert.equal(recent.jobs.length, limit);
		assert.equal(recent.people.length, limit);
		assert.equal(recent.jobs[0].title, 'Job 52');
	}
	await app.setNavigationSettings({ enabled: false, limit: 5 });
	assert.equal((await view('job', await job('Untracked'))).recorded, false);
	assert.equal((await app.listRecentViews()).jobs.length, 0);
	await app.setNavigationSettings({ enabled: true, limit: 5 });
	assert.equal((await app.listRecentViews()).jobs[0].title, 'Job 52');
	await app.clearRecentViews();
	assert.deepEqual(await app.listRecentViews(), {
		settings: { enabled: true, limit: 5 },
		jobs: [],
		people: []
	});
});

test('rejects invalid inputs and stale datasets; record deletion cascades to recents', async () => {
	const a = await job();
	const p = await app.createNetwork({ name: 'Alex' }),
		person = await app.getNetwork(p.id);
	await assert.rejects(
		app.recordRecentView({ kind: 'job', id: a.id, dataset_id: randomUUID() }),
		(e) => e.code === 'DATASET_MISMATCH'
	);
	await assert.rejects(
		app.recordRecentView({ kind: 'job', id: 9999, dataset_id: a.dataset_id }),
		(e) => e.code === 'not_found'
	);
	for (const input of [
		{ kind: 'document', id: 1 },
		{ kind: 'job', id: -1 },
		{ kind: 'job', id: '1 OR 1' }
	])
		await assert.rejects(app.recordRecentView({ ...input, dataset_id: a.dataset_id }));
	for (const input of [
		{ enabled: true, limit: 50 },
		{ enabled: 'false', limit: 10 }
	])
		await assert.rejects(app.setNavigationSettings(input));
	await view('job', a);
	await view('person', person);
	await app.deleteNetwork({ network_id: person.id, dataset_id: person.dataset_id, confirm: true });
	await app.deleteJob({ job_id: a.id, dataset_id: a.dataset_id, confirm: true });
	assert.equal((await app.listRecentViews()).jobs.length, 0);
	assert.equal((await app.listRecentViews()).people.length, 0);
	withDatabase((db) => assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0));
});

test('backup round trip preserves navigation and browsing does not invalidate a restore preview', async () => {
	const a = await job('First'),
		b = await job('Second');
	await view('job', a);
	await app.setNavigationSettings({ enabled: true, limit: 5 });
	const backup = await app.createBackup();
	const preview = await app.prepareRestore(backup.backup_id);
	await view('job', b);
	await app.restoreBackup(preview.restore_id, true);
	assert.deepEqual(
		(await app.listRecentViews()).jobs.map((row) => row.id),
		[a.id]
	);
	assert.deepEqual(await app.getNavigationSettings(), { enabled: true, limit: 5 });
});

test('fresh version 1 includes navigation defaults and empty record lists', async () => {
	assert.equal(migrateDatabase().version, 1);
	assert.deepEqual(await app.getNavigationSettings(), { enabled: true, limit: 10 });
	assert.deepEqual(await app.listRecentViews(), {
		settings: { enabled: true, limit: 10 },
		jobs: [],
		people: []
	});
	withDatabase((db) => {
		assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n, 1);
		assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get().n, 0);
		assert.equal(db.prepare('SELECT COUNT(*) n FROM networks').get().n, 0);
	});
});

test('only successful matching detail pages qualify as browser views', () => {
	const record = { id: 12, dataset_id: randomUUID() },
		data = { job: record, person: record };
	assert.equal(recentViewForPage('/jobs/12', data).kind, 'job');
	assert.equal(recentViewForPage('/networks/12', data).kind, 'person');
	for (const path of [
		'/jobs',
		'/jobs/new',
		'/jobs/12/edit',
		'/jobs/12/documents',
		'/networks/12/edit',
		'/jobs/13'
	])
		assert.equal(recentViewForPage(path, data), null);
	assert.equal(recentViewForPage('/jobs/12', data, 404), null);
	assert.equal(recentViewForPage('/jobs/12', {}), null);
});
