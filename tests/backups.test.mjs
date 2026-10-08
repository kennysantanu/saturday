import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdtempSync,
	mkdirSync,
	unlinkSync,
	rmSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	symlinkSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { migrateDatabase, openDatabase } from '../src/lib/server/database.js';
import {
	createJob,
	addJobUpdate,
	dismissJob,
	reopenJob,
	getJob,
	getDashboardStats,
	editJob
} from '../src/lib/server/services.js';
import * as backups from '../src/lib/server/backups.js';
import { schemaVersion } from '../src/lib/server/migrations.js';
import { readBuildInfo } from '../scripts/build-info.mjs';
let scratch;
const initialPath = process.env.SATURDAY_DB_PATH;
const initialFiles = process.env.SATURDAY_FILES_PATH;
beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'saturday-backup-test-'));
	process.env.SATURDAY_DB_PATH = join(scratch, 'career data.db');
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	migrateDatabase();
});
afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	if (initialFiles === undefined) delete process.env.SATURDAY_FILES_PATH;
	else process.env.SATURDAY_FILES_PATH = initialFiles;
	if (initialPath === undefined) delete process.env.SATURDAY_DB_PATH;
	else process.env.SATURDAY_DB_PATH = initialPath;
});
const failure = (code) => (error) => error.code === code;
function raw(path = process.env.SATURDAY_DB_PATH) {
	return new DatabaseSync(path);
}
function rows() {
	const db = raw();
	try {
		return {
			jobs: db.prepare('SELECT * FROM jobs ORDER BY id').all(),
			updates: db.prepare('SELECT * FROM job_updates ORDER BY recorded_order').all()
		};
	} finally {
		db.close();
	}
}
function populated() {
	const job = createJob({ job_title: 'Engineer', company_name: 'Acme' }, 'mcp');
	for (const event_type of ['applied', 'interview_1', 'interview_1'])
		addJobUpdate({ job_id: job.id, event_type, event_date: '2028-10-07' }, 'mcp');
	dismissJob(job.id, '2026-10-05');
	reopenJob(job.id, '2026-10-06');
	addJobUpdate({ job_id: job.id, event_date: '2026-10-05', note: 'Context' }, 'manual');
	const accepted = createJob({ job_title: 'Designer', company_name: 'Elsewhere' });
	addJobUpdate({ job_id: accepted.id, event_type: 'accepted', event_date: '2026-10-05' });
	return job;
}
test('populated round-trip preserves records, status, counts, insertion order and recovery', () => {
	const job = populated();
	const before = rows();
	const stats = getDashboardStats().stats;
	const backup = backups.createBackup();
	const ledger = raw();
	const migrations = ledger.prepare('SELECT * FROM schema_migrations').all();
	ledger.close();
	const extra = createJob({ job_title: 'Later', company_name: 'New' });
	const replaced = rows();
	const preview = backups.prepareRestore(backup.backup_id);
	assert.equal(preview.current.job_count, 3);
	assert.equal(preview.incoming.job_count, 2);
	const result = backups.restoreBackup(preview.restore_id, true);
	assert.deepEqual(rows(), before);
	assert.deepEqual(getDashboardStats().stats, stats);
	assert.equal(getJob(job.id).isActive, true);
	assert.equal(getJob(extra.id), null);
	const recovered = backups.prepareRestore(result.recovery_backup_id);
	backups.restoreBackup(recovered.restore_id, true);
	assert.deepEqual(rows(), replaced);
	const db = raw();
	assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), migrations);
	db.close();
	addJobUpdate({ job_id: job.id, event_type: 'offer', event_date: '2026-10-08' });
	assert.ok(rows().updates.at(-1).recorded_order > before.updates.at(-1).recorded_order);
});
test('empty backup restores a healthy installation', () => {
	const b = backups.createBackup();
	populated();
	const p = backups.prepareRestore(b.backup_id);
	backups.restoreBackup(p.restore_id, true);
	assert.equal(rows().jobs.length, 0);
});
test('confirmation, expiry and replay guards leave data unchanged', () => {
	populated();
	const b = backups.createBackup();
	const before = rows();
	const p = backups.prepareRestore(b.backup_id, { now: 1000 });
	assert.throws(
		() => backups.restoreBackup(p.restore_id, false, { now: 1001 }),
		failure('confirmation_required')
	);
	assert.throws(
		() => backups.restoreBackup(p.restore_id, true, { now: 601001 }),
		failure('restore_expired')
	);
	assert.throws(() => backups.restoreBackup(p.restore_id, true), failure('restore_consumed'));
	assert.deepEqual(rows(), before);
});
test('changed live records invalidate a preview even with unchanged counts', () => {
	const job = populated();
	const b = backups.createBackup();
	const p = backups.prepareRestore(b.backup_id);
	editJob(job.id, { job_title: 'Edited', company_name: 'Acme' });
	const before = rows();
	assert.throws(() => backups.restoreBackup(p.restore_id, true), failure('restore_stale'));
	assert.deepEqual(rows(), before);
});
test('tampered staging cannot be restored', () => {
	const b = backups.createBackup();
	const p = backups.prepareRestore(b.backup_id);
	const path = `${process.env.SATURDAY_DB_PATH}.restore/${p.restore_id}.sqlite`;
	const db = raw(path);
	db.exec('PRAGMA user_version=42');
	db.close();
	assert.throws(() => backups.restoreBackup(p.restore_id, true), failure('restore_stale'));
});
test('failure after record replacement rolls back and retains recovery backup', () => {
	populated();
	const b = backups.createBackup();
	createJob({ job_title: 'Later', company_name: 'New' });
	const before = rows();
	const p = backups.prepareRestore(b.backup_id);
	assert.throws(() =>
		backups.restoreBackup(p.restore_id, true, {
			beforeCommit: () => {
				throw new Error('Injected failure');
			}
		})
	);
	assert.deepEqual(rows(), before);
	assert.equal(backups.listBackups().backups.filter((b) => b.kind === 'recovery').length, 1);
});
test('cleanup failure after commit reports a successful restore with a warning', () => {
	populated();
	const b = backups.createBackup();
	createJob({ job_title: 'Later', company_name: 'New' });
	const p = backups.prepareRestore(b.backup_id);
	const result = backups.restoreBackup(p.restore_id, true, {
		beforeCommit: () => {
			const metadata = `${process.env.SATURDAY_DB_PATH}.restore/${p.restore_id}.json`;
			unlinkSync(metadata);
			mkdirSync(metadata);
		}
	});
	assert.equal(rows().jobs.length, 2);
	assert.ok(result.cleanup_warning);
	assert.ok(result.recovery_backup_id);
});

test('invalid files and unrelated databases do not modify live records', () => {
	populated();
	const before = rows();
	const p = join(scratch, 'bad.sqlite');
	writeFileSync(p, 'not sqlite');
	assert.throws(() => backups.importBackup(p), failure('invalid_backup'));
	rmSync(p);
	const db = raw(p);
	db.exec('CREATE TABLE unrelated(id TEXT)');
	db.close();
	assert.throws(() => backups.importBackup(p), failure('invalid_backup'));
	assert.deepEqual(rows(), before);
});
test('newer schema is rejected by imports and normal application connections', () => {
	const b = backups.createBackup();
	const source = backups.getBackupFile(b.backup_id).path;
	const db = raw(source);
	db.prepare('INSERT INTO schema_migrations VALUES(?, ?, ?)').run(
		schemaVersion + 1,
		'future',
		'2026-10-05'
	);
	db.close();
	assert.throws(() => backups.importBackup(source), failure('unsupported_schema'));
	const live = raw();
	live
		.prepare('INSERT INTO schema_migrations VALUES(?, ?, ?)')
		.run(schemaVersion + 1, 'future', '2026-10-05');
	live.close();
	assert.throws(() => openDatabase(), /Unsupported database schema/);
});
test('extra triggers, invalid dates and orphaned relationships are rejected', () => {
	const job = populated();
	const b = backups.createBackup();
	const source = backups.getBackupFile(b.backup_id).path;
	let db = raw(source);
	db.exec('CREATE TRIGGER surprise AFTER INSERT ON jobs BEGIN SELECT 1; END;');
	db.close();
	assert.throws(() => backups.importBackup(source), failure('unsupported_schema'));
	db = raw(source);
	db.exec('DROP TRIGGER surprise');
	db.prepare('UPDATE job_updates SET event_date=? WHERE job_id=?').run('2026-02-30', job.id);
	db.close();
	assert.throws(() => backups.importBackup(source), failure('invalid_backup'));
	db = raw(source);
	db.exec('PRAGMA foreign_keys=OFF');
	db.prepare('UPDATE job_updates SET job_id=?').run('missing');
	db.close();
	assert.throws(() => backups.importBackup(source), failure('invalid_backup'));
});
test('oversized, symlink and overwrite destinations are rejected', () => {
	assert.throws(
		() => backups.importBackupBytes(Buffer.alloc(backups.MAX_BACKUP_BYTES + 1)),
		failure('backup_too_large')
	);
	const b = backups.createBackup();
	const output = join(scratch, 'my backup.sqlite');
	backups.exportBackup(b.backup_id, output);
	assert.throws(() => backups.exportBackup(b.backup_id, output), failure('destination_exists'));
	const link = join(scratch, 'link.sqlite');
	symlinkSync(output, link);
	assert.throws(() => backups.importBackup(link), failure('invalid_backup'));
});
test('automatic schedule defaults, catch-up, idempotent updates and retention', () => {
	populated();
	assert.equal(backups.getBackupSettings().enabled, false);
	assert.equal(backups.runScheduledBackup({ now: 1000 }).ran, false);
	const manual = backups.createBackup();
	backups.setBackupSettings({ enabled: true, interval_hours: 1, keep_count: 2 }, { now: 1000 });
	assert.equal(backups.runScheduledBackup({ now: 1000 }).ran, true);
	assert.equal(backups.runScheduledBackup({ now: 2000 }).ran, false);
	const due = backups.getBackupSettings().next_due_at;
	backups.setBackupSettings({ enabled: true, interval_hours: 1 }, { now: 3000 });
	assert.equal(backups.getBackupSettings().next_due_at, due);
	assert.equal(backups.runScheduledBackup({ now: 86401000 }).ran, true);
	assert.equal(backups.runScheduledBackup({ now: 86401001 }).ran, false);
	backups.runScheduledBackup({ now: 90001000 });
	const catalog = backups.listBackups().backups;
	assert.equal(catalog.filter((b) => b.kind === 'scheduled').length, 2);
	assert.ok(catalog.some((b) => b.backup_id === manual.backup_id));
	backups.setBackupSettings({ enabled: false });
	assert.equal(backups.runScheduledBackup({ now: 999999999 }).ran, false);
	assert.throws(() => backups.setBackupSettings({ interval_hours: 0 }), failure('invalid_request'));
});
test('retention protects a backup with a prepared restore, preserves settings after restore', () => {
	backups.setBackupSettings({ enabled: true, interval_hours: 1, keep_count: 1 }, { now: 1000 });
	const first = backups.runScheduledBackup({ now: 1000 }).backup;
	const p = backups.prepareRestore(first.backup_id, { now: 3600999 });
	backups.runScheduledBackup({ now: 3601000 });
	assert.equal(backups.listBackups().backups.filter((b) => b.kind === 'scheduled').length, 2);
	backups.restoreBackup(p.restore_id, true, { now: 3601001 });
	assert.equal(backups.getBackupSettings().enabled, true);
	backups.runScheduledBackup({ now: 7201000 });
	assert.equal(backups.listBackups().backups.filter((b) => b.kind === 'scheduled').length, 1);
	assert.equal(backups.listBackups().backups.filter((b) => b.kind === 'recovery').length, 1);
});
test('backup publication failure preserves last success and defers retry', () => {
	backups.setBackupSettings({ enabled: true }, { now: 1000 });
	// Existing metadata is sound but a live content invariant is broken after enabling.
	const job = createJob({ job_title: 'Broken', company_name: 'State' });
	const db = raw();
	db.prepare('UPDATE jobs SET is_active=0 WHERE id=?').run(job.id);
	db.close();
	assert.equal(backups.runScheduledBackup({ now: 1000 }).error.code, 'invalid_backup');
	assert.equal(backups.getBackupSettings().retry_after, new Date(301000).toISOString());
	assert.equal(backups.runScheduledBackup({ now: 2000 }).ran, false);
	assert.equal(backups.getBackupSettings().last_success_at, null);
});
function childScript(code) {
	return spawn(process.execPath, ['--input-type=module', '-e', code], {
		cwd: resolve('.'),
		env: { ...process.env },
		stdio: ['ignore', 'pipe', 'pipe']
	});
}
function completed(child) {
	return new Promise((resolve, reject) => {
		let out = '',
			err = '';
		child.stdout.on('data', (c) => (out += c));
		child.stderr.on('data', (c) => (err += c));
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`))
		);
	});
}
test('two processes coordinate one scheduled backup and concurrent migrations', async () => {
	backups.setBackupSettings({ enabled: true }, { now: 1000 });
	const code =
		"import {runScheduledBackup} from './src/lib/server/backups.js';console.log(JSON.stringify(runScheduledBackup({now:1000})));";
	const results = await Promise.all([completed(childScript(code)), completed(childScript(code))]);
	assert.equal(results.map(JSON.parse).filter((r) => r.ran).length, 1);
	const newDb = join(scratch, 'new.sqlite');
	const migration = `process.env.SATURDAY_DB_PATH=${JSON.stringify(newDb)};const {migrateDatabase}=await import('./src/lib/server/database.js');migrateDatabase();`;
	await Promise.all([completed(childScript(migration)), completed(childScript(migration))]);
	const db = raw(newDb);
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, schemaVersion);
	db.close();
});
test('live snapshots remain consistent while a separate process writes', async () => {
	const writer =
		childScript(`import {createJob,addJobUpdate,dismissJob,reopenJob} from './src/lib/server/services.js';
 for(let i=0;i<20;i++){const job=createJob({job_title:'Concurrent '+i,company_name:'Writer'});
 addJobUpdate({job_id:job.id,event_type:'applied',event_date:'2026-10-05'});dismissJob(job.id,'2026-10-05');reopenJob(job.id,'2026-10-05');
 await new Promise(r=>setTimeout(r,3));}`);
	const done = completed(writer);
	for (let i = 0; i < 5; i++) {
		const b = backups.createBackup();
		assert.ok(b.job_count <= 20);
		assert.equal(backups.inspectBackup(b.backup_id).job_count, b.job_count);
	}
	await done;
	assert.equal(rows().jobs.length, 20);
});

test('only one of two processes can execute the same prepared restore', async () => {
	populated();
	const b = backups.createBackup();
	const p = backups.prepareRestore(b.backup_id);
	const code = `import {restoreBackup} from './src/lib/server/backups.js';try{console.log(JSON.stringify({ok:true,...restoreBackup('${p.restore_id}',true)}));}catch(error){console.log(JSON.stringify({ok:false,code:error.code}));}`;
	const results = (
		await Promise.all([completed(childScript(code)), completed(childScript(code))])
	).map(JSON.parse);
	assert.equal(results.filter((r) => r.ok).length, 1);
	assert.equal(results.find((r) => !r.ok).code, 'restore_consumed');
});

test('process death before commit rolls back and recovery remains available', async () => {
	populated();
	const b = backups.createBackup();
	createJob({ job_title: 'Later', company_name: 'New' });
	const before = rows();
	const p = backups.prepareRestore(b.backup_id);
	const child = childScript(
		`import {restoreBackup} from './src/lib/server/backups.js';restoreBackup('${p.restore_id}',true,{beforeCommit:()=>process.exit(17)});`
	);
	await new Promise((r) => child.on('close', r));
	assert.deepEqual(rows(), before);
	assert.equal(backups.listBackups().backups.filter((b) => b.kind === 'recovery').length, 1);
	assert.throws(() => backups.restoreBackup(p.restore_id, true), failure('restore_consumed'));
});
test('CLI exports, previews, confirms and emits structured errors', () => {
	populated();
	const output = join(scratch, 'portable backup.sqlite');
	const run = (script, args) =>
		spawnSync(process.execPath, [`scripts/${script}.mjs`, ...args, '--json'], {
			encoding: 'utf8',
			env: { ...process.env }
		});
	const b = run('backup', ['--output', output]);
	assert.equal(b.status, 0);
	assert.equal(JSON.parse(b.stdout).ok, true);
	const p = run('restore', [output, '--inspect']);
	assert.equal(p.status, 0);
	const preview = JSON.parse(p.stdout);
	const r = run('restore', ['--restore-id', preview.restore_id, '--confirm']);
	assert.equal(r.status, 0);
	assert.ok(JSON.parse(r.stdout).recovery_path);
	const invalid = run('restore', [output]);
	assert.equal(invalid.status, 2);
	assert.equal(JSON.parse(invalid.stdout).error.code, 'invalid_arguments');
	const settings = run('backup', [
		'schedule',
		'set',
		'--enabled',
		'true',
		'--interval-hours',
		'1',
		'--keep',
		'2'
	]);
	assert.equal(settings.status, 0);
	assert.equal(JSON.parse(settings.stdout).enabled, true);
});
test('development build identity handles clean, dirty and non-Git sources', () => {
	const source = join(scratch, 'source');
	mkdirSync(source);
	assert.deepEqual(readBuildInfo(source), { id: 'development', commit: null, dirty: null });
	const git = (args) => {
		const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		return result.stdout.trim();
	};
	git(['init']);
	git([
		'-c',
		'user.name=Saturday Test',
		'-c',
		'user.email=test@example.invalid',
		'-c',
		'commit.gpgsign=false',
		'commit',
		'--allow-empty',
		'-m',
		'Build identity fixture'
	]);
	const commit = git(['rev-parse', 'HEAD']);
	assert.deepEqual(readBuildInfo(source), {
		id: `dev.${commit.slice(0, 12)}`,
		commit,
		dirty: false
	});
	writeFileSync(join(source, 'untracked.txt'), 'local change');
	assert.deepEqual(readBuildInfo(source), {
		id: `dev.${commit.slice(0, 12)}.dirty`,
		commit,
		dirty: true
	});
	git(['add', 'untracked.txt']);
	assert.equal(readBuildInfo(source).dirty, true);
});
test('built MCP preserves legacy tools and exposes document tools and complete backup/restore workflow without private paths', async () => {
	const child = spawn(process.execPath, ['build/mcp/index.js'], {
		env: { ...process.env },
		stdio: ['pipe', 'pipe', 'pipe']
	});
	const pending = new Map();
	let next = 1;
	const lines = createInterface({ input: child.stdout });
	let stderr = '';
	child.stderr.on('data', (c) => (stderr += c));
	lines.on('line', (line) => {
		const message = JSON.parse(line);
		const entry = pending.get(message.id);
		if (entry) {
			pending.delete(message.id);
			clearTimeout(entry.timer);
			message.error
				? entry.reject(new Error(JSON.stringify(message.error)))
				: entry.resolve(message.result);
		}
	});
	const request = (method, params) =>
		new Promise((resolve, reject) => {
			const id = next++;
			const timer = setTimeout(() => reject(new Error(`MCP timeout ${stderr}`)), 5000);
			pending.set(id, { resolve, reject, timer });
			child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
		});
	const call = async (name, args = {}) => {
		const result = await request('tools/call', { name, arguments: args });
		const text = result.content[0].text;
		assert.ok(!text.includes(scratch));
		return JSON.parse(text);
	};
	try {
		const initialized = await request('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'backup-test', version: '1' }
		});
		assert.equal(initialized.serverInfo.version, readBuildInfo().id);
		child.stdin.write(
			JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
		);
		const listing = await request('tools/list', {});
		for (const name of [
			'create_job',
			'list_jobs',
			'restore_backup',
			'list_documents',
			'get_document',
			'generate_document_pdf',
			'restore_backup_pair'
		])
			assert.ok(listing.tools.some((t) => t.name === name));
		for (const [name, fields] of [
			['list_documents', ['scope', 'query', 'page', 'limit', 'catalog_token']],
			['create_document', ['scope', 'filename', 'content']],
			['edit_document', ['id', 'scope', 'token', 'filename', 'content']]
		])
			assert.deepEqual(
				Object.keys(listing.tools.find((t) => t.name === name).inputSchema.properties).sort(),
				fields.sort()
			);
		const job = await call('create_job', {
			job_title: 'Engineer',
			company_name: 'Example',
			location: 'Remote',
			posting_url: 'https://example.com/job',
			job_description: 'Original description',
			notes: 'Original notes',
			is_starred: true,
			score: 7.5,
			score_comment: 'Initial fit'
		});
		assert.equal(listing.tools.length, 40);
		for (const name of [
			'list_networks',
			'get_network',
			'create_network',
			'edit_network',
			'link_job_network',
			'edit_job_network',
			'unlink_job_network',
			'set_network_follow_up',
			'list_network_updates',
			'add_network_update',
			'edit_network_update',
			'delete_network_update'
		])
			assert.ok(listing.tools.some((t) => t.name === name));
		for (const name of ['list_networks', 'get_network', 'list_network_updates'])
			assert.equal(listing.tools.find((t) => t.name === name).annotations.readOnlyHint, true);
		for (const name of ['link_job_network', 'unlink_job_network', 'set_network_follow_up'])
			assert.equal(listing.tools.find((t) => t.name === name).annotations.idempotentHint, true);
		assert.equal(
			listing.tools.find((t) => t.name === 'delete_network_update').annotations.destructiveHint,
			true
		);
		const person = (
			await call('create_network', {
				name: 'Alex',
				role: 'Recruiter',
				organization: 'Acme',
				notes: 'General'
			})
		).network;
		assert.equal(person.created_via, 'mcp');
		assert.equal(person.follow_up_date, null);
		await call('edit_network', { network_id: person.id, phone: '+1 555 0100' });
		await call('edit_network', { network_id: person.id, email: null });
		assert.equal((await call('get_network', { network_id: person.id })).network.email, null);
		assert.equal((await call('get_network', { network_id: person.id })).network.notes, 'General');
		const linked = await call('link_job_network', {
			job_id: job.id,
			network_id: person.id,
			notes: 'Referrer'
		});
		assert.equal(linked.created, true);
		assert.equal(
			(
				await call('link_job_network', {
					job_id: job.id,
					network_id: person.id,
					notes: 'Keep existing'
				})
			).notes,
			'Referrer'
		);
		await call('edit_job_network', {
			job_id: job.id,
			network_id: person.id,
			notes: 'Hiring manager'
		});
		const people = await call('list_networks', {
			role: 'recruiter',
			organization: 'acme',
			job_id: job.id
		});
		assert.equal(people.total, 1);
		assert.equal(people.networks[0].job_link.notes, 'Hiring manager');
		assert.equal(
			(await call('list_networks', { role: 'engineer', organization: 'acme' })).total,
			0
		);
		const detailed = await call('get_network', { network_id: person.id, jobs_limit: 1 });
		assert.equal(detailed.linked_jobs.jobs[0].id, job.id);
		assert.equal(detailed.linked_jobs.limit, 1);
		await call('set_network_follow_up', {
			network_id: person.id,
			follow_up_date: '2000-01-01',
			follow_up_comment: 'Check in'
		});
		assert.equal(
			(await call('list_networks', { follow_up: 'overdue', sort: 'follow_up' })).networks[0].id,
			person.id
		);
		const interaction = (
			await call('add_network_update', {
				network_id: person.id,
				interaction_date: '2000-01-01',
				note: 'Met'
			})
		).update;
		assert.equal(interaction.created_via, 'mcp');
		await call('edit_network_update', {
			network_id: person.id,
			update_id: interaction.id,
			note: 'Introduced'
		});
		assert.equal(
			(
				await call('list_network_updates', {
					network_id: person.id,
					date_from: '2000-01-01',
					date_to: '2000-01-01'
				})
			).updates[0].note,
			'Introduced'
		);
		assert.equal(
			(await call('get_network', { network_id: person.id })).network.follow_up_comment,
			'Check in'
		);
		const otherPerson = (await call('create_network', { name: 'Casey' })).network;
		assert.equal(
			(
				await call('delete_network_update', {
					network_id: otherPerson.id,
					update_id: interaction.id,
					confirm: true
				})
			).error.code,
			'not_found'
		);
		assert.equal(
			(await call('edit_network', { network_id: person.id })).error.code,
			'validation_error'
		);
		assert.equal(
			(
				await call('delete_network_update', {
					network_id: person.id,
					update_id: interaction.id,
					confirm: true
				})
			).deleted,
			true
		);
		assert.equal(
			(await call('unlink_job_network', { job_id: job.id, network_id: person.id })).removed,
			true
		);
		assert.equal(
			(await call('unlink_job_network', { job_id: job.id, network_id: person.id })).removed,
			false
		);
		await call('edit_job', { job_id: job.id, compensation: '$140k/year' });
		const edited = await call('get_job', { job_id: job.id });
		assert.equal(edited.location, 'Remote');
		assert.equal(edited.posting_url, 'https://example.com/job');
		assert.equal(edited.job_description, 'Original description');
		assert.equal(edited.notes, 'Original notes');
		assert.equal(edited.compensation, '$140k/year');
		assert.equal(edited.is_starred, true);
		assert.equal(edited.score, 7.5);
		await call('set_job_follow_up', {
			job_id: job.id,
			follow_up_date: '2026-11-01',
			follow_up_comment: 'Check progress'
		});
		await call('set_job_score', {
			job_id: job.id,
			score: 8.25,
			score_comment: 'Relevant experience'
		});
		const assessed = await call('get_job', { job_id: job.id });
		assert.equal(assessed.follow_up_comment, 'Check progress');
		assert.equal(assessed.score_comment, 'Relevant experience');
		assert.equal(assessed.score, 8.25);
		assert.equal(assessed.updates.length, 0);

		const legacyList = await call('list_jobs', { query: 'Example' });
		assert.equal(legacyList.jobs[0].id, job.id);
		assert.equal(legacyList.total, 1);
		assert.equal(legacyList.limit, 50);
		const filteredList = await call('list_jobs', {
			title: 'engineer',
			company: 'example',
			location: 'remote',
			starred: 'starred',
			score_min: 8,
			score_max: 9,
			status: ['new'],
			created_via: ['mcp'],
			limit: 1
		});
		assert.equal(filteredList.total, 1);
		assert.equal(filteredList.page, 1);
		assert.equal(filteredList.totalPages, 1);
		assert.equal(filteredList.jobs[0].score, 8.25);
		assert.equal((await call('list_jobs', { company: 'Other' })).total, 0);
		const invalidSearch = await request('tools/call', {
			name: 'list_jobs',
			arguments: { score_min: 10, score_max: 0 }
		});
		assert.equal(invalidSearch.isError, true);
		await call('edit_job', { job_id: job.id, source: 'Referral' });
		assert.equal((await call('get_job', { job_id: job.id })).follow_up_date, '2026-11-01');
		await call('set_job_follow_up', { job_id: job.id, follow_up_date: null });
		assert.equal((await call('get_job', { job_id: job.id })).follow_up_comment, null);
		await call('add_job_update', {
			job_id: job.id,
			event_type: 'accepted',
			event_date: '2026-10-01'
		});
		assert.equal((await call('list_jobs', { query: 'Example' })).total, 1);
		assert.equal((await call('list_jobs', { query: 'Example', view: 'active' })).total, 0);
		assert.equal((await call('list_jobs', { step: ['accepted'], view: 'active' })).total, 1);
		const b = await call('create_backup');
		assert.ok(b.backup_id);
		const p = await call('prepare_restore', { backup_id: b.backup_id });
		assert.equal(p.requires_confirmation, true);
		const restored = await call('restore_backup', { restore_id: p.restore_id, confirm: true });
		assert.ok(restored.recovery_backup_id);
		const replay = await call('restore_backup', { restore_id: p.restore_id, confirm: true });
		assert.equal(replay.error.code, 'restore_consumed');
		const settings = await call('set_backup_settings', { enabled: true, keep_count: 2 });
		assert.equal(settings.keep_count, 2);
		const doc = await call('create_document', { filename: 'master.md', content: '# Career' });
		assert.equal(doc.created_via, 'mcp');
		const catalog = await call('list_documents');
		await call('set_master_document', {
			id: doc.id,
			token: doc.token,
			catalog_token: catalog.catalog_token
		});
		assert.equal(
			(await call('get_document', { designation: 'master_cv', include_content: true })).content,
			'# Career'
		);
		const copied = await call('copy_document', {
			id: doc.id,
			token: doc.token,
			destination_scope: job.id,
			filename: 'tailored.md'
		});
		assert.equal(copied.designation, null);
		assert.equal(
			(await call('get_document', { id: copied.id, scope: job.id, include_content: true })).content,
			'# Career'
		);
		assert.equal((await call('get_document', { id: copied.id })).error.code, 'NOT_FOUND');
		const fileSettings = await call('set_backup_settings', {
			kind: 'files',
			enabled: true,
			interval_hours: 3,
			keep_count: 4
		});
		assert.equal(fileSettings.keep_count, 4);
		assert.equal((await call('get_backup_settings')).keep_count, 2);
		const fileBackup = await call('create_file_backup');
		const filePreview = await call('prepare_file_restore', { backup_id: fileBackup.backup_id });
		assert.ok(
			(await call('restore_files', { restore_id: filePreview.restore_id, confirm: true }))
				.recovery_backup_id
		);
	} finally {
		lines.close();
		child.kill();
		await new Promise((r) => child.on('close', r));
		for (const p of pending.values()) clearTimeout(p.timer);
	}
});
