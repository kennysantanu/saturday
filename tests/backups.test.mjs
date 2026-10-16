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
import { migrateDatabase, openDatabase, inTransaction } from '../src/lib/server/database.js';
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
import { defaultAccessSettings } from '../src/lib/server/access-settings.js';
import { passwordHash } from '../src/lib/server/access-auth.js';
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
			updates: db.prepare('SELECT * FROM job_updates ORDER BY id').all()
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
	assert.ok(rows().updates.at(-1).id > before.updates.at(-1).id);
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
	db.prepare('UPDATE job_updates SET job_id=?').run(99999);
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
test('concurrent numeric allocations have distinct IDs and one dataset identity', async () => {
	const code = `import {createJob,addJobUpdate} from './src/lib/server/services.js';
 import {createNetwork,addNetworkUpdate} from './src/lib/server/networks.js';
 import {withDatabase} from './src/lib/server/database.js';
 const job=createJob({job_title:'Concurrent',company_name:'Writer'});
 const update=addJobUpdate({job_id:job.id,event_date:'2000-01-01',note:'Concurrent'});
 const person=createNetwork({name:'Concurrent'});
 const interaction=addNetworkUpdate({network_id:person.id,interaction_date:'2000-01-01',note:'Concurrent'});
 console.log(JSON.stringify({job:job.id,update:update.id,person:person.id,interaction:interaction.id,dataset:withDatabase(db=>db.prepare('SELECT dataset_id FROM app_metadata').get().dataset_id)}));`;
	const results = (
		await Promise.all(Array.from({ length: 4 }, () => completed(childScript(code))))
	).map(JSON.parse);
	for (const key of ['job', 'update', 'person', 'interaction'])
		assert.deepEqual(
			results.map((row) => row[key]).sort((a, b) => a - b),
			[1, 2, 3, 4]
		);
	assert.equal(new Set(results.map((row) => row.dataset)).size, 1);
});
test('restore preserves deleted allocation counters, dataset identity and stale counter guards', () => {
	const first = createJob({ job_title: 'First', company_name: 'Example' });
	const update = addJobUpdate({
		job_id: first.id,
		event_date: '2000-01-01',
		note: 'Delete highest update'
	});
	const db = raw();
	db.prepare('DELETE FROM job_updates WHERE id=?').run(update.id);
	db.exec(
		"UPDATE sqlite_sequence SET seq=20 WHERE name='jobs'; UPDATE sqlite_sequence SET seq=40 WHERE name='job_updates'"
	);
	const identity = db.prepare('SELECT dataset_id FROM app_metadata').get().dataset_id;
	db.close();
	const backup = backups.createBackup();
	const stale = backups.prepareRestore(backup.backup_id);
	const changed = raw();
	changed.exec("UPDATE sqlite_sequence SET seq=30 WHERE name='jobs'");
	changed.close();
	assert.throws(() => backups.restoreBackup(stale.restore_id, true), failure('restore_stale'));
	const preview = backups.prepareRestore(backup.backup_id);
	backups.restoreBackup(preview.restore_id, true);
	assert.equal(createJob({ job_title: 'After restore', company_name: 'Example' }).id, 31);
	assert.equal(
		addJobUpdate({ job_id: first.id, event_date: '2000-01-01', note: 'Next update' }).id,
		41
	);
	const check = raw();
	assert.equal(check.prepare('SELECT dataset_id FROM app_metadata').get().dataset_id, identity);
	check.close();
});
test('two processes coordinate concurrent migrations', async () => {
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
	const removed = run('backup', ['schedule', 'show']);
	assert.equal(removed.status, 2);
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
	const accessPath = join(scratch, 'access.json');
	const protectedAccess = JSON.stringify({
		...defaultAccessSettings(),
		password: await passwordHash('test')
	});
	writeFileSync(accessPath, protectedAccess, { mode: 0o600 });
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
		assert.ok(
			!listing.tools.some((tool) =>
				/password|access_settings|run_command|execute_command/.test(tool.name)
			),
			'core MCP has no authentication-management or command-execution tool'
		);
		for (const name of ['disable_password', 'recover_access', 'set_password', 'run_command']) {
			await request('tools/call', { name, arguments: { confirm: true } }).then(
				(result) => assert.equal(result.isError, true),
				(error) => assert.match(error.message, /"code":-3260[12]/)
			);
		}
		const traversal = await call('create_document', { filename: '../access.json', content: '{}' });
		assert.ok(traversal.error, 'MCP document writes cannot overwrite authentication settings');
		assert.equal(readFileSync(accessPath, 'utf8'), protectedAccess);
		const info = await call('get_saturday_info', {});
		assert.equal(typeof info.dataset_id, 'string');
		assert.equal(info.jobs, 0);
		assert.equal(info.build.id, initialized.serverInfo.version);
		assert.equal(
			listing.tools.find((t) => t.name === 'get_saturday_info').annotations.readOnlyHint,
			true
		);
		for (const [tool, fields] of [
			['get_job', ['job_id']],
			['get_network', ['network_id']],
			['link_job_network', ['job_id', 'network_id']],
			['edit_network_update', ['network_id', 'update_id']]
		]) {
			const shape = listing.tools.find((entry) => entry.name === tool).inputSchema.properties;
			for (const field of fields) assert.equal(shape[field].type, 'integer');
		}
		for (const [tool, input] of [
			['get_job', { job_id: '1' }],
			['get_network', { network_id: '1' }],
			['get_job', { job_id: 1.5 }]
		]) {
			const invalid = await request('tools/call', { name: tool, arguments: input });
			assert.equal(invalid.isError, true);
		}
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
		assert.equal(job.id, 1);
		assert.equal(listing.tools.length, 43);
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
		for (const invalidId of ['1', '01', '1e0', 0, -1, 1.5, 9007199254740992]) {
			const result = await request('tools/call', {
				name: 'get_job',
				arguments: { job_id: invalidId }
			});
			assert.equal(result.isError, true);
		}
		assert.ok(
			!listing.tools.some((t) => ['set_backup_settings', 'get_backup_settings'].includes(t.name))
		);
		assert.ok((await call('list_backup_history')).backups.length);
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

		const letter = await call('create_document', {
			filename: 'letter.html',
			content: '<p>Dear team</p>'
		});
		const letterCatalog = await call('list_documents');
		await call('set_master_document', {
			designation: 'cover_letter_template',
			id: letter.id,
			token: letter.token,
			catalog_token: letterCatalog.catalog_token
		});
		assert.equal(
			(await call('get_document', { designation: 'cover_letter_template', include_content: true }))
				.content,
			'<p>Dear team</p>'
		);
		const letterNow = await call('get_document', { id: letter.id });
		assert.equal(
			(
				await call('delete_document', {
					id: letter.id,
					token: letterNow.token,
					confirm: true,
					catalog_token: letterNow.catalog_token
				})
			).error.code,
			'CONFIRMATION'
		);
		await call('delete_document', {
			id: letter.id,
			token: letterNow.token,
			confirm: true,
			catalog_token: letterNow.catalog_token,
			clear_designations: true
		});
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
		const fileBackup = await call('create_file_backup');
		const filePreview = await call('prepare_file_restore', { backup_id: fileBackup.backup_id });
		assert.ok(
			(await call('restore_files', { restore_id: filePreview.restore_id, confirm: true }))
				.recovery_backup_id
		);
		assert.equal(
			readFileSync(accessPath, 'utf8'),
			protectedAccess,
			'MCP writes and career backup/restore must preserve password protection'
		);
	} finally {
		lines.close();
		child.kill();
		await new Promise((r) => child.on('close', r));
		for (const p of pending.values()) clearTimeout(p.timer);
	}
});

test('an already-open connection rejects a schema changed by another process before mutation', () => {
	const db = openDatabase();
	try {
		const child = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				`import { DatabaseSync } from 'node:sqlite'; const db=new DatabaseSync(process.env.SATURDAY_DB_PATH); db.exec("INSERT INTO schema_migrations VALUES(2,'future','2026-10-08')"); db.close();`
			],
			{ env: process.env, encoding: 'utf8' }
		);
		assert.equal(child.status, 0, child.stderr);
		const before = readFileSync(process.env.SATURDAY_DB_PATH);
		let entered = false;
		assert.throws(
			() =>
				inTransaction(db, () => {
					entered = true;
					db.exec('DELETE FROM jobs');
				}),
			/Unsupported database schema/
		);
		assert.equal(entered, false);
		assert.deepEqual(readFileSync(process.env.SATURDAY_DB_PATH), before);
	} finally {
		db.close();
	}
});

test('disk-full metadata publication keeps existing backups and database intact, then retries', async () => {
	const fs = (await import('node:fs')).default;
	const { syncBuiltinESMExports } = await import('node:module');
	const job = createJob({ job_title: 'Preserve me', company_name: 'Example' });
	const previous = backups.createBackup();
	const directory = backups.getBackupPaths().backups;
	const before = readdirSync(directory).sort();
	const write = fs.writeFileSync;
	try {
		fs.writeFileSync = (...args) => {
			if (String(args[0]).startsWith(directory) && String(args[0]).endsWith('.tmp'))
				throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
			return write(...args);
		};
		syncBuiltinESMExports();
		assert.throws(() => backups.createBackup(), { code: 'io_error' });
	} finally {
		fs.writeFileSync = write;
		syncBuiltinESMExports();
	}
	assert.deepEqual(readdirSync(directory).sort(), before);
	assert.ok(getJob(job.id));
	assert.equal(backups.listBackups().backups[0].backup_id, previous.backup_id);
	assert.ok(backups.createBackup().backup_id);
});
