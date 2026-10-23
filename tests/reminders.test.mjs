import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations, assertMigrationHistory } from '../src/lib/server/migrations.js';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import {
	createJob,
	getJob,
	addJobUpdate,
	moveJobStage,
	searchJobs,
	getDashboardStats,
	correctJobUpdate
} from '../src/lib/server/services.js';
import * as people from '../src/lib/server/networks.js';
import * as reminders from '../src/lib/server/reminders.js';
import * as backups from '../src/lib/server/backups.js';
let scratch;
const saved = {
	SATURDAY_DB_PATH: process.env.SATURDAY_DB_PATH,
	SATURDAY_FILES_PATH: process.env.SATURDAY_FILES_PATH,
	TZ: process.env.TZ
};
beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'saturday-reminders-'));
	process.env.SATURDAY_DB_PATH = join(scratch, 'db.sqlite');
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	migrateDatabase();
});
afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	for (const [key, value] of Object.entries(saved))
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
});
const job = () => createJob({ job_title: 'Engineer', company_name: 'Example' });
const person = () => people.createNetwork({ name: 'Alex' });
const at = '2099-08-01T00:00';
const list = (owner, view = 'all') => reminders.listReminders({ ...owner, view }).reminders;

test('schema 1 reminders migrate without resetting identity, relationships or allocation counters', () => {
	const db = new DatabaseSync(':memory:');
	try {
		db.exec('PRAGMA foreign_keys=ON');
		applyMigrations(db, 1);
		const stamp = '2026-01-01T00:00:00.000Z';
		db.prepare(
			"INSERT INTO jobs(job_title,company_name,current_stage_id,created_via,created_at,updated_at,follow_up_date,follow_up_comment) VALUES('Engineer','Example',1,'mcp',?,?,'2026-08-01','Call')"
		).run(stamp, stamp);
		db.prepare(
			"INSERT INTO networks(name,created_via,created_at,updated_at,follow_up_date) VALUES('Alex','manual',?,?,'2026-08-02')"
		).run(stamp, stamp);
		db.prepare(
			"INSERT INTO job_networks(job_id,network_id,created_via,created_at,updated_at) VALUES(1,1,'manual',?,?)"
		).run(stamp, stamp);
		db.exec(
			"UPDATE sqlite_sequence SET seq=100 WHERE name='jobs'; UPDATE sqlite_sequence SET seq=200 WHERE name='networks'"
		);
		const identity = db.prepare('SELECT dataset_id FROM app_metadata').get().dataset_id;
		applyMigrations(db);
		assertMigrationHistory(db);
		const rows = db.prepare('SELECT * FROM reminders ORDER BY id').all();
		assert.equal(rows.length, 2);
		assert.equal(rows[0].scheduled_at, '2026-08-01T00:00');
		assert.equal(rows[0].note, 'Call');
		assert.equal(rows[0].created_via, 'mcp');
		assert.equal(rows[1].network_id, 1);
		assert.equal(db.prepare('SELECT dataset_id FROM app_metadata').get().dataset_id, identity);
		assert.equal(db.prepare("SELECT seq FROM sqlite_sequence WHERE name='jobs'").get().seq, 100);
		assert.equal(
			db.prepare("SELECT seq FROM sqlite_sequence WHERE name='networks'").get().seq,
			200
		);
		assert.equal(db.prepare('SELECT COUNT(*) n FROM job_networks').get().n, 1);
		assert(
			!db
				.prepare('PRAGMA table_info(jobs)')
				.all()
				.some((c) => c.name === 'follow_up_date')
		);
		applyMigrations(db);
		assert.equal(db.prepare('SELECT COUNT(*) n FROM reminders').get().n, 2);
	} finally {
		db.close();
	}
});

test('shared owner-scoped lifecycle preserves dismissal dates and supports explicit restoration', () => {
	const j = job(),
		p = person();
	for (const owner of [{ job_id: j.id }, { network_id: p.id }]) {
		const first = reminders.createReminder({ ...owner, scheduled_at: at, note: ' Call ' }, 'mcp');
		assert.equal(first.note, 'Call');
		assert(first.is_active);
		assert.equal(first.dismissed_at, null);
		reminders.createReminder({ ...owner, scheduled_at: '2099-08-01T09:30' });
		assert.equal(list(owner).length, 2);
		const dismissed = reminders.dismissReminder({ ...owner, reminder_id: first.id });
		assert(!dismissed.is_active);
		assert(dismissed.dismissed_at);
		const edited = reminders.editReminder({ ...owner, reminder_id: first.id, note: 'Corrected' });
		assert.equal(edited.dismissed_at, dismissed.dismissed_at);
		assert(!edited.is_active);
		assert.deepEqual(reminders.dismissReminder({ ...owner, reminder_id: first.id }), edited);
		const restored = reminders.editReminder({ ...owner, reminder_id: first.id, is_active: true });
		assert(restored.is_active);
		assert.equal(restored.dismissed_at, null);
		assert.throws(() => reminders.deleteReminder({ ...owner, reminder_id: first.id }));
		reminders.deleteReminder({ ...owner, reminder_id: first.id, confirm: true });
		assert.equal(list(owner).length, 1);
	}
	assert.equal(getJob(j.id).updates.length, 1);
	assert.equal(people.getNetwork(p.id).interaction_count, 0);
});

test('strict schedules, IDs and exclusive ownership reject malformed or cross-owner writes', () => {
	const j = job(),
		other = job(),
		p = person();
	for (const scheduled_at of [
		'2026-02-30T00:00',
		'2026-08-01',
		'2026-08-01T24:00',
		'2026-08-01T01:60',
		'2026-08-01T11:00Z',
		'2026-08-01T11:00-07:00'
	])
		assert.throws(() => reminders.createReminder({ job_id: j.id, scheduled_at }));
	for (const owner of [
		{},
		{ job_id: j.id, network_id: p.id },
		{ job_id: '01' },
		{ network_id: 99999 }
	])
		assert.throws(() => reminders.createReminder({ ...owner, scheduled_at: at }));
	const r = reminders.createReminder({ job_id: j.id, scheduled_at: at });
	for (const owner of [{ job_id: other.id }, { network_id: p.id }])
		assert.throws(() => reminders.editReminder({ ...owner, reminder_id: r.id, note: 'Wrong' }));
	assert.equal(list({ job_id: j.id })[0].note, null);
	withDatabase((db) =>
		assert.throws(() =>
			db
				.prepare(
					"INSERT INTO reminders(job_id,network_id,scheduled_at,created_via,created_at,updated_at) VALUES(?,?,'2026-01-01T00:00','manual','x','x')"
				)
				.run(j.id, p.id)
		)
	);
});

test('combined activity and reminder saves roll back together and remain independent after creation', () => {
	const j = job(),
		p = person(),
		date = '2020-01-01';
	assert.throws(() =>
		addJobUpdate({
			job_id: j.id,
			event_date: date,
			note: 'Note',
			reminder: { scheduled_at: 'bad' }
		})
	);
	assert.equal(getJob(j.id).updates.length, 1);
	assert.throws(() =>
		moveJobStage(j.id, { stage_id: 2, event_date: date, reminder: { scheduled_at: 'bad' } })
	);
	assert.equal(getJob(j.id).currentStageId, 1);
	assert.throws(() =>
		people.addNetworkUpdate({
			network_id: p.id,
			interaction_date: date,
			note: 'Called',
			reminder: { scheduled_at: 'bad' }
		})
	);
	assert.equal(people.getNetwork(p.id).interaction_count, 0);
	const u = addJobUpdate({
		job_id: j.id,
		event_date: date,
		note: 'Note',
		reminder: { scheduled_at: at, note: 'Follow up' }
	});
	assert.equal(list({ job_id: j.id }).length, 1);
	correctJobUpdate(u.id, { job_id: j.id, remove: true });
	assert.equal(list({ job_id: j.id }).length, 1);
	const interaction = people.addNetworkUpdate({
		network_id: p.id,
		interaction_date: date,
		note: 'Called',
		reminder: { scheduled_at: at }
	});
	people.deleteNetworkUpdate({ network_id: p.id, update_id: interaction.id, confirm: true });
	assert.equal(list({ network_id: p.id }).length, 1);
});

test('active summaries and filters match any reminder, remain ordered, and include closed jobs in Dashboard', () => {
	const j = job(),
		p = person();
	const late = reminders.createReminder({ job_id: j.id, scheduled_at: at });
	reminders.createReminder({ job_id: j.id, scheduled_at: '2000-01-01T09:30' });
	reminders.createReminder({ network_id: p.id, scheduled_at: '2000-01-01T00:00' });
	assert.equal(getJob(j.id).nextReminder, '2000-01-01T09:30');
	assert.equal(searchJobs({ follow_up: 'overdue' }).total, 1);
	assert.equal(
		searchJobs({ follow_up: 'range', follow_up_from: '2099-08-01', follow_up_to: '2099-08-01' })
			.total,
		1
	);
	assert.equal(people.listNetworks({ follow_up: 'overdue' }).total, 1);
	moveJobStage(j.id, { stage_id: 6, event_date: '2020-01-01' });
	const feed = getDashboardStats().reminders;
	assert.equal(feed.length, 3);
	assert(feed.some((r) => r.job_id === j.id && r.job_closed));
	reminders.dismissReminder({ job_id: j.id, reminder_id: late.id });
	assert.equal(
		searchJobs({
			view: 'all',
			follow_up: 'range',
			follow_up_from: '2099-08-01',
			follow_up_to: '2099-08-01'
		}).total,
		0
	);
});

test('fixed schedules survive timezone changes, daylight-saving gaps, and pagination', () => {
	const j = job();
	process.env.TZ = 'America/Los_Angeles';
	for (let i = 0; i < 3; i++)
		reminders.createReminder({ job_id: j.id, scheduled_at: '2026-03-08T02:30' });
	process.env.TZ = 'America/New_York';
	const result = reminders.listReminders({ job_id: j.id, limit: 2, page: 99 });
	assert.equal(result.page, 2);
	assert.equal(result.total, 3);
	assert.equal(result.reminders[0].scheduled_at, '2026-03-08T02:30');
	assert.equal(
		searchJobs({ follow_up: 'range', follow_up_from: '2026-03-08', follow_up_to: '2026-03-08' })
			.total,
		1
	);
});

test('backup restores reminder values, dismissal metadata and counters and rejects invalid schedules', () => {
	const j = job(),
		r = reminders.createReminder({ job_id: j.id, scheduled_at: at });
	reminders.dismissReminder({ job_id: j.id, reminder_id: r.id });
	const original = list({ job_id: j.id });
	const backup = backups.createBackup();
	reminders.deleteReminder({ job_id: j.id, reminder_id: r.id, confirm: true });
	const newer = reminders.createReminder({ job_id: j.id, scheduled_at: at });
	backups.restoreBackup(backups.prepareRestore(backup.backup_id).restore_id, true);
	assert.deepEqual(list({ job_id: j.id }), original);
	assert(reminders.createReminder({ job_id: j.id, scheduled_at: at }).id > newer.id);
	withDatabase((db) => db.prepare("UPDATE reminders SET scheduled_at='2026-02-30T00:00'").run());
	assert.throws(() => backups.createBackup());
});

test('schema 1 backups restore through the reminder migration', () => {
	const path = join(scratch, 'old.sqlite'),
		db = new DatabaseSync(path);
	applyMigrations(db, 1);
	const stamp = '2026-01-01T00:00:00.000Z';
	db.prepare(
		"INSERT INTO jobs(job_title,company_name,current_stage_id,created_via,created_at,updated_at,follow_up_date,follow_up_comment) VALUES('Old','Example',1,'manual',?,?,'2026-08-01','Keep')"
	).run(stamp, stamp);
	db.prepare(
		"INSERT INTO job_updates(job_id,stage_id,event_date,created_via,created_at,updated_at) VALUES(1,1,'2026-01-01','manual',?,?)"
	).run(stamp, stamp);
	db.close();
	const imported = backups.importBackup(path),
		preview = backups.prepareRestore(imported.backup_id);
	backups.restoreBackup(preview.restore_id, true);
	assert.equal(getJob(1).title, 'Old');
	assert.equal(list({ job_id: 1 })[0].scheduled_at, '2026-08-01T00:00');
	assert.equal(list({ job_id: 1 })[0].note, 'Keep');
});

test('built MCP exposes shared reminder tools and atomic activity scheduling without legacy setters', async () => {
	const { spawn } = await import('node:child_process'),
		{ createInterface } = await import('node:readline');
	const child = spawn(process.execPath, ['build/mcp/index.js'], {
		env: { ...process.env },
		stdio: ['pipe', 'pipe', 'pipe']
	});
	const pending = new Map();
	let next = 1,
		stderr = '';
	child.stderr.on('data', (data) => (stderr += data));
	const lines = createInterface({ input: child.stdout });
	lines.on('line', (line) => {
		const message = JSON.parse(line),
			p = pending.get(message.id);
		if (p) {
			pending.delete(message.id);
			clearTimeout(p.timer);
			message.error
				? p.reject(new Error(JSON.stringify(message.error)))
				: p.resolve(message.result);
		}
	});
	const request = (method, params) =>
		new Promise((resolve, reject) => {
			const id = next++,
				timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`MCP timeout: ${stderr}`));
				}, 5000);
			pending.set(id, { resolve, reject, timer });
			child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
		});
	const call = async (name, args) => {
		const result = await request('tools/call', { name, arguments: args });
		assert(!result.isError, result.content?.[0]?.text);
		return JSON.parse(result.content[0].text);
	};
	try {
		await request('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'reminders-test', version: '1' }
		});
		child.stdin.write(
			JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
		);
		const tools = (await request('tools/list', {})).tools;
		for (const name of [
			'create_reminder',
			'list_reminders',
			'edit_reminder',
			'dismiss_reminder',
			'delete_reminder'
		])
			assert(tools.some((t) => t.name === name));
		assert(!tools.some((t) => ['set_job_follow_up', 'set_network_follow_up'].includes(t.name)));
		const j = await call('create_job', { job_title: 'Engineer', company_name: 'Example' }),
			p = (await call('create_network', { name: 'Alex' })).network;
		for (const owner of [{ job_id: j.id }, { network_id: p.id }]) {
			const r = await call('create_reminder', { ...owner, scheduled_at: at, note: 'Call' });
			await call('dismiss_reminder', { ...owner, reminder_id: r.id });
			assert.equal((await call('list_reminders', { ...owner, view: 'inactive' })).total, 1);
			await call('edit_reminder', { ...owner, reminder_id: r.id, is_active: true });
			await call('delete_reminder', { ...owner, reminder_id: r.id, confirm: true });
			assert.equal((await call('list_reminders', { ...owner, view: 'all' })).total, 0);
		}
		await call('add_job_update', {
			job_id: j.id,
			event_date: '2020-01-01',
			note: 'Applied',
			reminder: { scheduled_at: at }
		});
		assert.equal((await call('get_job', { job_id: j.id })).next_reminder, at);
		await call('add_network_update', {
			network_id: p.id,
			interaction_date: '2020-01-01',
			note: 'Called',
			reminder: { scheduled_at: at }
		});
		assert.equal((await call('get_network', { network_id: p.id })).network.next_reminder_at, at);
		const invalid = await request('tools/call', {
			name: 'create_reminder',
			arguments: { job_id: j.id, network_id: p.id, scheduled_at: at }
		});
		assert(invalid.isError);
	} finally {
		for (const p of pending.values()) clearTimeout(p.timer);
		lines.close();
		child.stdin.end();
		child.kill();
		await new Promise((resolve) => child.once('exit', resolve));
	}
});
