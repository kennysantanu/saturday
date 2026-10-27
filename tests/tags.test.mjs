import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, assertMigrationHistory } from '../src/lib/server/migrations.js';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import { createJob, editJob, getJob, searchJobs, deleteJob } from '../src/lib/server/services.js';
import {
	createNetwork,
	editNetwork,
	getNetwork,
	listNetworks,
	deleteNetwork
} from '../src/lib/server/networks.js';
import * as tags from '../src/lib/server/tags.js';
import * as backups from '../src/lib/server/backups.js';
import { normalizeTagName, displayTagName, tagTextColor } from '../src/lib/tags.js';
let scratch;
const saved = {
	SATURDAY_DB_PATH: process.env.SATURDAY_DB_PATH,
	SATURDAY_FILES_PATH: process.env.SATURDAY_FILES_PATH
};
beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'saturday-tags-'));
	process.env.SATURDAY_DB_PATH = join(scratch, 'db.sqlite');
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	migrateDatabase();
});
afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	for (const [k, v] of Object.entries(saved))
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
});
const job = () => createJob({ job_title: 'Engineer', company_name: 'Example' });
const person = () => createNetwork({ name: 'Alex' });
const make = (collection, name = 'Career faIR', color = '#ABCDEF') =>
	tags.createTag({ collection, name, color });
const assigned = (collection, owner_id, tag_ids) =>
	tags.setTagAssignments({ collection, owner_id, tag_ids });

test('initial tag tables are idempotent and reject noncanonical names and colors', () => {
	const db = new DatabaseSync(':memory:');
	try {
		applyMigrations(db);
		const identity = db.prepare('SELECT dataset_id FROM app_metadata').get().dataset_id;
		applyMigrations(db);
		assertMigrationHistory(db);
		assert.equal(db.prepare('SELECT dataset_id FROM app_metadata').get().dataset_id, identity);
		for (const name of ['Career', 'career fair', '_fair', 'fair_', 'fair__2026', 'café', 'c++'])
			assert.throws(() =>
				db
					.prepare(
						"INSERT INTO job_tags(name,color,created_at,updated_at) VALUES(?,'#abcdef','x','x')"
					)
					.run(name)
			);
		assert.throws(() =>
			db.exec(
				"INSERT INTO job_tags(name,color,created_at,updated_at) VALUES('fair','#ABCDEF','x','x')"
			)
		);
		assert.equal(db.prepare('SELECT COUNT(*) n FROM job_tags').get().n, 0);
	} finally {
		db.close();
	}
});
test('canonical names, derived labels, colors and duplicate recovery stay scoped', () => {
	const a = make('job'),
		b = make('person');
	assert.equal(a.name, 'career_fair');
	assert.equal(a.display_name, 'career fair');
	assert.equal(a.color, '#abcdef');
	assert.equal(a.id, b.id);
	assert.throws(
		() => make('job', 'career__fair'),
		(e) => e.existingTag.id === a.id && e.fieldErrors.name.includes('already exists')
	);
	for (const name of ['___', ' ', 'C++', 'réseau', 'career-fair', 'a'.repeat(51)])
		assert.throws(() => make('job', name));
	assert.equal(make('job', '  2026__ NEW  ').name, '2026_new');
	assert.equal(normalizeTagName(' x___Y '), 'x_y');
	assert.equal(displayTagName('x_y'), 'x y');
	for (const color of ['red', '#abc', '#12345678', 'rgb(0,0,0)'])
		assert.throws(() => make('job', 'invalid', color));
	assert.equal(tagTextColor('#000000'), '#ffffff');
	assert.equal(tagTextColor('#ffffff'), '#000000');
});
test('tag search treats separators literally, paginates and rejects unsupported queries without broadening', () => {
	make('job');
	make('job', 'careerXfair');
	make('person', 'career fair');
	for (const query of ['CAREER FAIR', 'career_fair', 'career___fair'])
		assert.equal(tags.listTags({ collection: 'job', query }).total, 1);
	assert.equal(tags.listTags({ collection: 'job', query: '%' }).total, 0);
	assert(tags.listTags({ collection: 'job', query: '%' }).invalid_query);
	assert.equal(tags.listTags({ collection: 'job', query: '___' }).total, 2);
	const page = tags.listTags({ collection: 'job', page: 500, limit: 1 });
	assert.equal(page.page, 2);
	assert.equal(page.totalPages, 2);
});
test('parent saves preserve omitted tags, clear explicit empty and roll back invalid selections', () => {
	const a = make('job'),
		b = make('person');
	const j = createJob({ job_title: 'Role', company_name: 'Co', tag_ids: [a.id, a.id] });
	const p = createNetwork({ name: 'Person', tag_ids: [b.id] });
	assert.equal(j.tags.length, 1);
	assert.equal(getNetwork(p.id).tags[0].display_name, 'career fair');
	editJob(j.id, { job_title: 'New' });
	editNetwork(p.id, { role: 'Recruiter' });
	assert.equal(getJob(j.id).tags.length, 1);
	assert.equal(getNetwork(p.id).tags.length, 1);
	assert.throws(() => editJob(j.id, { job_title: 'Wrong', tag_ids: [900] }));
	assert.equal(getJob(j.id).title, 'New');
	assert.throws(() => createNetwork({ name: 'Wrong', tag_ids: [900] }));
	assert.equal(listNetworks().total, 1);
	editJob(j.id, { tag_ids: [] });
	editNetwork(p.id, { tag_ids: [] });
	assert.equal(getJob(j.id).tags.length, 0);
	assert.equal(getNetwork(p.id).tags.length, 0);
});
test('assignments are idempotent, scoped, alphabetic and filter without duplicates or activity changes', () => {
	const a = make('job', 'zebra'),
		b = make('job', 'alpha'),
		n = make('person', 'network');
	const j = job(),
		p = person();
	assigned('job', j.id, [a.id, b.id]);
	assigned('person', p.id, [n.id]);
	const stamp = getJob(j.id).updatedAt;
	assert(
		!tags.changeTagAssignment({ collection: 'job', owner_id: j.id, tag_id: a.id }, true).changed
	);
	assert.equal(getJob(j.id).updatedAt, stamp);
	assert.deepEqual(
		getJob(j.id).tags.map((t) => t.name),
		['alpha', 'zebra']
	);
	assert.equal(searchJobs({ tag_ids: [a.id, b.id] }).total, 1);
	assert.equal(searchJobs({ tag_ids: [a.id, 999] }).total, 0);
	assert.deepEqual(searchJobs({ tag_ids: [999] }).unavailableTagIds, [999]);
	assert.equal(listNetworks({ tag_ids: [n.id] }).total, 1);
	assert.equal(listNetworks({ tag_ids: [999] }).total, 0);
	assert.throws(() => assigned('bad', j.id, [a.id]));
	assert.throws(() => assigned('job', 900, [a.id]));
	assert.throws(() => assigned('job', j.id, [900]));
	assert.equal(getJob(j.id).tags.length, 2);
	assert(tags.getTagSelection({ collection: 'job', tag_ids: [a.id, 999] })[1].unavailable);
});
test('merge unions references once, retains first ID, accepts second name and separates counts', () => {
	for (const collection of ['job', 'person']) {
		const first = make(collection, 'first'),
			second = make(collection, 'second');
		const owners = Array.from({ length: 7 }, () => (collection === 'job' ? job() : person()));
		for (let i = 0; i < 5; i++) assigned(collection, owners[i].id, [first.id]);
		for (let i = 3; i < 7; i++)
			tags.changeTagAssignment({ collection, owner_id: owners[i].id, tag_id: second.id }, true);
		const read = (id) => (collection === 'job' ? getJob(id) : getNetwork(id)),
			firstStamp =
				collection === 'job' ? read(owners[0].id).updatedAt : read(owners[0].id).updated_at;
		const result = tags.mergeTags({
			collection,
			first_tag_id: first.id,
			second_tag_id: second.id,
			name: 'SECOND',
			color: '#123ABC',
			confirm: true
		});
		assert.equal(result.tag.id, first.id);
		assert.equal(result.tag.created_at, first.created_at);
		assert.equal(result.tag.name, 'second');
		assert.equal(result.tag.color, '#123abc');
		assert.equal(result.resulting_owner_count, 7);
		assert.equal(result.changed_owner_count, 4);
		for (const owner of owners)
			assert.deepEqual(
				read(owner.id).tags.map((t) => t.id),
				[first.id]
			);
		assert.equal(
			collection === 'job' ? read(owners[0].id).updatedAt : read(owners[0].id).updated_at,
			firstStamp
		);
		assert.throws(() =>
			tags.mergeTags({
				collection,
				first_tag_id: first.id,
				second_tag_id: second.id,
				confirm: true
			})
		);
	}
});
test('merge validation and mid-write failure roll back references, names and deletion', (t) => {
	const first = make('job', 'first'),
		second = make('job', 'second'),
		third = make('job', 'third'),
		j = job();
	assigned('job', j.id, [second.id]);
	const input = {
		collection: 'job',
		first_tag_id: first.id,
		second_tag_id: second.id,
		confirm: true
	};
	assert.throws(() => tags.mergeTags({ ...input, name: 'THIRD' }));
	assert.throws(() => tags.mergeTags({ ...input, second_tag_id: first.id }));
	assert.throws(() => tags.mergeTags({ ...input, confirm: false }));
	const original = DatabaseSync.prototype.prepare;
	for (const boundary of [
		'INSERT OR IGNORE INTO job_tag_assignments',
		'DELETE FROM job_tags',
		'UPDATE job_tags SET name'
	]) {
		const intercepted = t.mock.method(DatabaseSync.prototype, 'prepare', function (sql, ...args) {
			if (sql.startsWith(boundary)) throw new Error('Injected merge write failure');
			return original.call(this, sql, ...args);
		});
		assert.throws(() => tags.mergeTags(input), /Injected merge write failure/);
		intercepted.mock.restore();
		assert.equal(getJob(j.id).tags[0].id, second.id);
		assert.equal(tags.listTags({ collection: 'job' }).total, 3);
	}
	assert.throws(() => tags.mergeTags({ ...input, color: '#xyzxyz' }));
	assert.equal(getJob(j.id).tags[0].id, second.id);
	assert.equal(tags.listTags({ collection: 'job' }).total, 3);
	const unused = tags.mergeTags({ ...input, name: 'combined' });
	assert.equal(unused.resulting_owner_count, 1);
	assert.equal(third.name, 'third');
});
test('tag deletion and parent deletion preserve other definitions, owners and collections', async () => {
	const a = make('job'),
		b = make('person'),
		j = job(),
		p = person();
	assigned('job', j.id, [a.id]);
	assigned('person', p.id, [b.id]);
	assert.throws(() => tags.deleteTag({ collection: 'job', tag_id: a.id }));
	tags.deleteTag({ collection: 'job', tag_id: a.id, confirm: true });
	assert.equal(getJob(j.id).tags.length, 0);
	assert.equal(getNetwork(p.id).tags.length, 1);
	deleteNetwork({ network_id: p.id, dataset_id: getNetwork(p.id).dataset_id, confirm: true });
	assert.equal(tags.listTags({ collection: 'person' }).tags[0].usage_count, 0);
	const c = make('job', 'other');
	assigned('job', j.id, [c.id]);
	const { createDocument } = await import('../src/lib/server/files/documents.js');
	await createDocument({ scope: j.id, filename: 'owned.md', content: 'Job file' });
	await deleteJob({ job_id: j.id, dataset_id: getJob(j.id).dataset_id, confirm: true });
	assert.equal(tags.listTags({ collection: 'job' }).tags[0].usage_count, 0);
});
test('backup restores definitions, merged references and allocation counters; empty baselines restore empty', () => {
	const a = make('job', 'a'),
		b = make('job', 'b'),
		n = make('person'),
		j = job(),
		p = person();
	assigned('job', j.id, [a.id, b.id]);
	assigned('person', p.id, [n.id]);
	tags.mergeTags({ collection: 'job', first_tag_id: a.id, second_tag_id: b.id, confirm: true });
	const backup = backups.createBackup();
	const newer = make('job', 'newer');
	tags.deleteTag({ collection: 'job', tag_id: a.id, confirm: true });
	backups.restoreBackup(backups.prepareRestore(backup.backup_id).restore_id, true);
	assert.deepEqual(
		getJob(j.id).tags.map((t) => t.id),
		[a.id]
	);
	assert.equal(getNetwork(p.id).tags[0].id, n.id);
	assert(make('job', 'after').id > newer.id);
	const empty = join(scratch, 'empty.sqlite'),
		db = new DatabaseSync(empty);
	applyMigrations(db);
	db.close();
	const imported = backups.importBackup(empty);
	backups.restoreBackup(backups.prepareRestore(imported.backup_id).restore_id, true);
	assert.equal(tags.listTags({ collection: 'job' }).total, 0);
});

test('backup validation rejects noncanonical stored tags and fingerprints tag changes', () => {
	const a = make('job'),
		j = job();
	assigned('job', j.id, [a.id]);
	const backup = backups.createBackup(),
		preview = backups.prepareRestore(backup.backup_id);
	tags.editTag({ collection: 'job', tag_id: a.id, color: '#123456' });
	assert.throws(() => backups.restoreBackup(preview.restore_id, true), /changed|preview/i);
	withDatabase((db) =>
		db.exec("PRAGMA ignore_check_constraints=ON; UPDATE job_tags SET name='Career Fair'")
	);
	assert.throws(() => backups.createBackup());
});

test('built MCP supports scoped tags, normalized names, parent assignments and confirmed merges', async () => {
	const { spawn } = await import('node:child_process'),
		{ createInterface } = await import('node:readline');
	const child = spawn(process.execPath, ['build/mcp/index.js'], {
		env: { ...process.env },
		stdio: ['pipe', 'pipe', 'pipe']
	});
	const pending = new Map();
	let next = 1,
		stderr = '';
	child.stderr.on('data', (chunk) => (stderr += chunk));
	const lines = createInterface({ input: child.stdout });
	lines.on('line', (line) => {
		const msg = JSON.parse(line),
			p = pending.get(msg.id);
		if (p) {
			clearTimeout(p.timer);
			pending.delete(msg.id);
			msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
		}
	});
	const request = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = next++,
				timer = setTimeout(() => reject(new Error(`MCP timeout: ${stderr}`)), 10000);
			pending.set(id, { resolve, reject, timer });
			child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
		});
	const call = async (name, args) => {
		const result = await request('tools/call', { name, arguments: args });
		assert(!result.isError, result.content[0].text);
		return JSON.parse(result.content[0].text);
	};
	try {
		await request('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'tags-test', version: '1' }
		});
		child.stdin.write(
			JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
		);
		const definitions = (await request('tools/list')).tools;
		for (const name of [
			'list_tags',
			'create_tag',
			'edit_tag',
			'delete_tag',
			'merge_tags',
			'add_tag',
			'remove_tag'
		])
			assert(definitions.some((tool) => tool.name === name));
		const first = await call('create_tag', {
				collection: 'job',
				name: 'Career faIR',
				color: '#AABBCC'
			}),
			second = await call('create_tag', { collection: 'job', name: 'Campus' });
		const n = await call('create_tag', { collection: 'person', name: 'Career Fair' });
		assert.equal(n.id, first.id);
		const j = await call('create_job', {
			job_title: 'MCP job',
			company_name: 'Example',
			tag_ids: [second.id]
		});
		assert.equal(j.tags[0].name, 'campus');
		await call('add_tag', { collection: 'job', owner_id: j.id, tag_id: first.id });
		const denied = await request('tools/call', {
			name: 'merge_tags',
			arguments: { collection: 'job', first_tag_id: first.id, second_tag_id: second.id }
		});
		assert(denied.isError);
		const merged = await call('merge_tags', {
			collection: 'job',
			first_tag_id: first.id,
			second_tag_id: second.id,
			name: 'CAREER Fair',
			confirm: true
		});
		assert.equal(merged.resulting_owner_count, 1);
		assert.equal(merged.tag.display_name, 'career fair');
		assert.equal((await call('list_jobs', { tag_ids: [first.id] })).total, 1);
		await call('edit_job', { job_id: j.id, tag_ids: [] });
		assert.equal((await call('get_job', { job_id: j.id })).tags.length, 0);
		const p = await call('create_network', { name: 'Alex', tag_ids: [n.id] });
		assert.equal(p.network.tags[0].id, n.id);
		assert.equal((await call('list_networks', { tag_ids: [n.id] })).total, 1);
		await call('remove_tag', { collection: 'person', owner_id: p.network.id, tag_id: n.id });
		await call('delete_tag', { collection: 'person', tag_id: n.id, confirm: true });
		assert.equal((await call('list_tags', { collection: 'person' })).total, 0);
	} finally {
		for (const p of pending.values()) clearTimeout(p.timer);
		lines.close();
		child.stdin.end();
		child.kill();
		await new Promise((resolve) => child.once('exit', resolve));
	}
});
