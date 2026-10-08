import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { filePaths } from '../src/lib/server/files/store.js';
import * as n from '../src/lib/server/networks.js';
import * as b from '../src/lib/server/backups.js';
import * as pairs from '../src/lib/server/files/pairs.js';
import { createDocument, getDocument } from '../src/lib/server/files/documents.js';
import { createJob, getJob, dismissJob } from '../src/lib/server/services.js';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import { applyMigrations, schemaVersion } from '../src/lib/server/migrations.js';
import { ValidationError, localCalendarDate } from '../src/lib/server/validation.js';
let scratch;
const previous = {
	SATURDAY_DB_PATH: process.env.SATURDAY_DB_PATH,
	SATURDAY_FILES_PATH: process.env.SATURDAY_FILES_PATH
};
beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'saturday-network-'));
	process.env.SATURDAY_DB_PATH = join(scratch, 'db.sqlite');
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	migrateDatabase();
});
afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	for (const [key, value] of Object.entries(previous)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});
const invalid = (operation) => assert.throws(operation, ValidationError);
const notFound = (operation) => assert.throws(operation, (error) => error.code === 'not_found');
const job = () => createJob({ job_title: 'Engineer', company_name: 'Acme' });
function contents() {
	return withDatabase((db) =>
		Object.fromEntries(
			['networks', 'job_networks', 'network_updates'].map((table) => [
				table,
				db
					.prepare(
						`SELECT * FROM ${table} ORDER BY ${table === 'job_networks' ? 'job_id, network_id' : 'id'}`
					)
					.all()
			])
		)
	);
}

test('name-only creation, strict validation, partial edits and optional clearing', () => {
	const person = n.createNetwork(
		{
			name: '  Alex  ',
			phone: '+1 (212) 555-0100 ext. 2',
			email: 'Alex@Example.com',
			notes: ' General '
		},
		'mcp'
	);
	assert.equal(person.name, 'Alex');
	assert.equal(person.role, null);
	assert.equal(person.email, 'Alex@Example.com');
	assert.equal(person.created_via, 'mcp');
	assert.equal(person.latest_interaction_date, null);
	assert.equal(person.interaction_count, 0);
	const edited = n.editNetwork(person.id, { role: ' Recruiter ', email: '' });
	assert.equal(edited.role, 'Recruiter');
	assert.equal(edited.email, null);
	assert.equal(edited.phone, person.phone);
	assert.equal(edited.notes, 'General');
	assert.notEqual(n.createNetwork({ name: 'Alex', email: 'Alex@Example.com' }).id, person.id);
	for (const patch of [
		{ name: '' },
		{ phone: 123 },
		{ email: 'bad' },
		{ link: 'javascript:alert(1)' },
		{ link: '/relative' },
		{ role: 'a'.repeat(201) },
		{ notes: 'a'.repeat(20001) },
		{ follow_up_date: '2026-02-30' },
		{ follow_up_comment: 'without date' }
	])
		invalid(() => n.editNetwork(person.id, patch));
	invalid(() => n.editNetwork(person.id, {}));
	notFound(() => n.getNetwork(99999));
	invalid(() => n.createNetwork({ name: 'Alex' }, 'browser'));
});

test('literal AND fields, OR query, missing values and scoped jobs filter before pagination', () => {
	const a = n.createNetwork({ name: '100%_\\ Person', role: 'Recruiter', organization: 'Acme' });
	const c = n.createNetwork({ name: 'Other', role: 'Engineer', organization: 'Acme' });
	n.createNetwork({ name: 'Wrong company', role: 'Recruiter', organization: 'Elsewhere' });
	n.createNetwork({ name: '100xx Person' });
	const j = job();
	n.linkJobNetwork({ job_id: j.id, network_id: a.id });
	assert.deepEqual(
		n
			.listNetworks({ name: '%_\\', role: 'recruiter', organization: 'ACME' })
			.networks.map((x) => x.id),
		[a.id]
	);
	assert.equal(n.listNetworks({ role: 'recruiter', organization: 'acme' }).total, 1);
	assert.equal(n.listNetworks({ query: 'recruiter' }).total, 2);
	assert.equal(
		n.listNetworks({ query: 'recruiter', organization: 'acme', name: 'wrong' }).total,
		0
	);
	assert.equal(n.listNetworks({ job_id: j.id, role: 'engineer' }).total, 0);
	assert.equal(n.listNetworks({ job_id: j.id }).networks[0].job_link.job_id, j.id);
	assert.equal(n.listNetworks({ organization: 'acme' }).total, 2);
	assert.ok(c.id);
	notFound(() => n.listNetworks({ job_id: 99999 }));
	for (const input of [
		{ page: 0 },
		{ page: 'x' },
		{ limit: 101 },
		{ limit: 1.5 },
		{ sort: 'DROP TABLE networks' },
		{ follow_up: 'future' },
		{ name: 4 },
		{ role: 'x'.repeat(201) }
	])
		invalid(() => n.listNetworks(input));
});

test('stable complete pagination and clamping for more than 100 people', () => {
	for (let i = 0; i < 112; i++)
		n.createNetwork({
			name: `Person ${String(i).padStart(3, '0')}`,
			organization: i % 2 ? 'Acme' : 'Elsewhere'
		});
	const first = n.listNetworks(),
		second = n.listNetworks({ page: 2 }),
		last = n.listNetworks({ page: 100 });
	assert.equal(first.total, 112);
	assert.equal(first.limit, 50);
	assert.equal(first.totalPages, 3);
	assert.equal(last.page, 3);
	assert.equal(last.networks.length, 12);
	const ids = [...first.networks, ...second.networks, ...last.networks].map((x) => x.id);
	assert.equal(new Set(ids).size, 112);
	assert.equal(first.networks[0].name, 'Person 000');
	assert.equal(n.listNetworks({ organization: 'Acme', page: 2 }).networks.length, 6);
	assert.equal(n.listNetworks({ name: 'absent', page: 9 }).page, 1);
});

test('local calendar follow-up matching, nullable setter, dependency and missing-last sorts', () => {
	const today = localCalendarDate();
	const early = n.createNetwork({
		name: 'Earlier',
		follow_up_date: '2000-01-01',
		follow_up_comment: 'Call'
	});
	const due = n.createNetwork({ name: 'Due', follow_up_date: today });
	const future = n.createNetwork({ name: 'Future', follow_up_date: '2099-01-01' });
	const none = n.createNetwork({ name: 'Absent' });
	assert.deepEqual(
		n.listNetworks({ follow_up: 'overdue' }).networks.map((x) => x.id),
		[early.id]
	);
	assert.deepEqual(
		n.listNetworks({ follow_up: 'today' }).networks.map((x) => x.id),
		[due.id]
	);
	assert.deepEqual(
		n.listNetworks({ follow_up: 'upcoming' }).networks.map((x) => x.id),
		[future.id]
	);
	assert.deepEqual(
		n.listNetworks({ follow_up: 'not_scheduled' }).networks.map((x) => x.id),
		[none.id]
	);
	assert.deepEqual(
		n.listNetworks({ sort: 'follow_up' }).networks.map((x) => x.id),
		[early.id, due.id, future.id, none.id]
	);
	invalid(() => n.setNetworkFollowUp({ network_id: early.id }));
	const saved = n.setNetworkFollowUp({ network_id: early.id, follow_up_date: '2000-01-01' });
	assert.equal(saved.follow_up_comment, null);
	assert.deepEqual(
		n.setNetworkFollowUp({ network_id: early.id, follow_up_date: '2000-01-01' }),
		saved
	);
	n.editNetwork(early.id, { follow_up_comment: 'Changed' });
	assert.equal(n.editNetwork(early.id, { follow_up_date: '   ' }).follow_up_comment, null);
	invalid(() => n.editNetwork(none.id, { follow_up_comment: 'No date' }));
});

test('many-to-many links are retry safe, scoped notes never change parents, inactive jobs supported', () => {
	const a = n.createNetwork({ name: 'Alex', notes: 'Personal' }),
		c = n.createNetwork({ name: 'Casey' }),
		j = job(),
		other = job();
	dismissJob(other.id, '2026-01-01');
	const beforeJob = getJob(j.id),
		beforePerson = n.getNetwork(a.id);
	const first = n.linkJobNetwork({ job_id: j.id, network_id: a.id, notes: ' Referrer ' }, 'mcp');
	assert.equal(first.created, true);
	const retry = n.linkJobNetwork({ job_id: j.id, network_id: a.id, notes: 'Do not overwrite' });
	assert.equal(retry.created, false);
	assert.equal(retry.notes, 'Referrer');
	assert.equal(retry.created_via, 'mcp');
	n.linkJobNetwork({ job_id: other.id, network_id: a.id });
	n.linkJobNetwork({ job_id: j.id, network_id: c.id });
	assert.equal(n.listNetworkJobs({ network_id: a.id }).total, 2);
	assert.equal(n.listNetworks({ job_id: j.id }).total, 2);
	const updated = n.editJobNetwork({ job_id: j.id, network_id: a.id, notes: 'Hiring manager' });
	assert.equal(updated.created_at, first.created_at);
	assert.equal(
		n.listNetworkJobs({ network_id: a.id }).jobs.find((x) => x.id === j.id).job_link.notes,
		'Hiring manager'
	);
	assert.equal(
		n.listNetworks({ job_id: j.id }).networks.find((x) => x.id === a.id).job_link.notes,
		'Hiring manager'
	);
	assert.equal(n.editJobNetwork({ job_id: j.id, network_id: a.id, notes: '' }).notes, null);
	invalid(() => n.editJobNetwork({ job_id: j.id, network_id: a.id }));
	invalid(() => n.linkJobNetwork({ job_id: j.id, network_id: a.id, notes: 'a'.repeat(2001) }));
	assert.equal(n.unlinkJobNetwork({ job_id: j.id, network_id: a.id }).removed, true);
	assert.equal(n.unlinkJobNetwork({ job_id: j.id, network_id: a.id }).removed, false);
	notFound(() => n.editJobNetwork({ job_id: j.id, network_id: a.id, notes: null }));
	notFound(() => n.linkJobNetwork({ job_id: 99999, network_id: a.id }));
	assert.deepEqual(n.getNetwork(a.id), beforePerson);
	assert.deepEqual(getJob(j.id), beforeJob);
	assert.deepEqual(n.networkLinkIds({ network_id: a.id }), [other.id]);
	assert.equal(n.listNetworkJobs({ network_id: a.id }).jobs[0].is_active, 0);
});

test('optional interactions use actual date and insertion ties, support corrections and scoped confirmed deletion', () => {
	const a = n.createNetwork({ name: 'Alex', follow_up_date: '2099-01-01' }),
		c = n.createNetwork({ name: 'Casey' });
	const first = n.addNetworkUpdate(
		{ network_id: a.id, interaction_date: '2000-01-02', note: 'Message sent' },
		'mcp'
	);
	const tie = n.addNetworkUpdate({
		network_id: a.id,
		interaction_date: '2000-01-02',
		note: 'Response'
	});
	const backdated = n.addNetworkUpdate({
		network_id: a.id,
		interaction_date: '2000-01-01',
		note: 'Introduced'
	});
	assert.deepEqual(
		n.listNetworkUpdates({ network_id: a.id }).updates.map((x) => x.id),
		[tie.id, first.id, backdated.id]
	);
	assert.equal(n.getNetwork(a.id).latest_interaction_date, '2000-01-02');
	assert.equal(n.getNetwork(a.id).interaction_count, 3);
	n.editNetworkUpdate({ network_id: a.id, update_id: tie.id, interaction_date: '1999-12-31' });
	assert.equal(
		n.listNetworkUpdates({ network_id: a.id, date_from: '2000-01-02', date_to: '2000-01-02' })
			.total,
		1
	);
	assert.equal(
		n.editNetworkUpdate({ network_id: a.id, update_id: first.id, note: 'Corrected' }).created_via,
		'mcp'
	);
	notFound(() =>
		n.editNetworkUpdate({ network_id: c.id, update_id: first.id, note: 'Wrong person' })
	);
	notFound(() => n.deleteNetworkUpdate({ network_id: c.id, update_id: first.id, confirm: true }));
	invalid(() => n.deleteNetworkUpdate({ network_id: a.id, update_id: first.id }));
	invalid(() => n.editNetworkUpdate({ network_id: a.id, update_id: first.id }));
	for (const patch of [
		{ interaction_date: '2099-01-01', note: 'Future' },
		{ interaction_date: '2000-02-30', note: 'Bad date' },
		{ interaction_date: '2000-01-01', note: ' ' },
		{ interaction_date: localCalendarDate(), note: 'x'.repeat(20001) }
	])
		invalid(() => n.addNetworkUpdate({ network_id: a.id, ...patch }));
	invalid(() =>
		n.listNetworkUpdates({ network_id: a.id, date_from: '2001-01-01', date_to: '2000-01-01' })
	);
	n.deleteNetworkUpdate({ network_id: a.id, update_id: first.id, confirm: true });
	assert.equal(n.getNetwork(a.id).latest_interaction_date, '2000-01-01');
	notFound(() => n.deleteNetworkUpdate({ network_id: a.id, update_id: first.id, confirm: true }));
	const after = n.getNetwork(a.id);
	assert.equal(after.updated_at, a.updated_at);
	assert.equal(after.follow_up_date, a.follow_up_date);
	assert.equal(n.listNetworks({ sort: 'latest_interaction' }).networks[0].id, a.id);
	assert.equal(n.listNetworks({ sort: 'latest_interaction' }).networks.at(-1).id, c.id);
	for (const entry of n.listNetworkUpdates({ network_id: a.id }).updates)
		n.deleteNetworkUpdate({ network_id: a.id, update_id: entry.id, confirm: true });
	assert.equal(n.getNetwork(a.id).latest_interaction_date, null);
});

test('more than 100 interactions and linked jobs paginate without hidden caps', () => {
	const person = n.createNetwork({ name: 'Alex' });
	for (let i = 0; i < 103; i++) {
		n.addNetworkUpdate({
			network_id: person.id,
			interaction_date: '2000-01-01',
			note: `Interaction ${i}`
		});
		n.linkJobNetwork({ network_id: person.id, job_id: job().id });
	}
	const history = [1, 2, 3].flatMap(
		(page) => n.listNetworkUpdates({ network_id: person.id, page }).updates
	);
	assert.equal(history.length, 103);
	assert.equal(new Set(history.map((x) => x.id)).size, 103);
	assert.equal(history[0].note, 'Interaction 102');
	const jobs = [1, 2, 3].flatMap((page) => n.listNetworkJobs({ network_id: person.id, page }).jobs);
	assert.equal(jobs.length, 103);
	assert.equal(new Set(jobs.map((x) => x.id)).size, 103);
	assert.equal(n.listNetworkJobs({ network_id: person.id, page: 99 }).page, 3);
	assert.equal(n.networkLinkIds({ network_id: person.id }).length, 103);
});

function populated() {
	const person = n.createNetwork(
		{ name: 'Alex', follow_up_date: '2099-01-01', follow_up_comment: 'Call', notes: 'General' },
		'mcp'
	);
	const j = job();
	n.linkJobNetwork({ job_id: j.id, network_id: person.id, notes: 'Referrer' }, 'mcp');
	const entry = n.addNetworkUpdate(
		{ network_id: person.id, interaction_date: '2000-01-01', note: 'Introduced' },
		'mcp'
	);
	return { person, j, entry };
}
test('numeric baseline recovery preserves all identities, timestamps, notes, summaries and counts', () => {
	const { person, j } = populated();
	const before = contents();
	const backup = b.createBackup();
	assert.equal(backup.schema_version, schemaVersion);
	assert.equal(backup.network_count, 1);
	assert.equal(backup.network_link_count, 1);
	assert.equal(backup.network_update_count, 1);
	n.editNetwork(person.id, { name: 'Changed' });
	n.unlinkJobNetwork({ job_id: j.id, network_id: person.id });
	const replaced = contents();
	const preview = b.prepareRestore(backup.backup_id);
	const result = b.restoreBackup(preview.restore_id, true);
	assert.deepEqual(contents(), before);
	assert.equal(result.network_count, 1);
	const recovery = b.prepareRestore(result.recovery_backup_id);
	b.restoreBackup(recovery.restore_id, true);
	assert.deepEqual(contents(), replaced);
});
test('all same-count Network mutations invalidate a restore preview', () => {
	const { person, j, entry } = populated();
	const backup = b.createBackup();
	for (const mutate of [
		() => n.editNetwork(person.id, { notes: 'Changed general note' }),
		() => n.setNetworkFollowUp({ network_id: person.id, follow_up_date: '2099-02-01' }),
		() => n.editJobNetwork({ job_id: j.id, network_id: person.id, notes: 'Changed relationship' }),
		() =>
			n.editNetworkUpdate({
				network_id: person.id,
				update_id: entry.id,
				note: 'Corrected interaction'
			}),
		() =>
			n.editNetworkUpdate({
				network_id: person.id,
				update_id: entry.id,
				interaction_date: '1999-01-01'
			})
	]) {
		const preview = b.prepareRestore(backup.backup_id);
		mutate();
		assert.throws(
			() => b.restoreBackup(preview.restore_id, true),
			(error) => error.code === 'restore_stale'
		);
	}
});
test('people and interactions have independent numeric allocation and strict ID validation', () => {
	const person = n.createNetwork({ name: 'First' });
	assert.equal(person.id, 1);
	assert.equal(job().id, 1);
	const update = n.addNetworkUpdate({
		network_id: '1',
		interaction_date: '2000-01-01',
		note: 'First'
	});
	assert.equal(update.id, 1);
	n.deleteNetworkUpdate({ network_id: '1', update_id: '1', confirm: true });
	assert.equal(
		n.addNetworkUpdate({ network_id: person.id, interaction_date: '1999-01-01', note: 'Next' }).id,
		2
	);
	for (const id of ['01', '1x', '1e0', '1.0', ' 1', 0, -1, Infinity, 'uuid']) {
		invalid(() => n.getNetwork(id));
		invalid(() => n.listNetworks({ job_id: id }));
		invalid(() => n.networkLinkIds({ job_id: id }));
		invalid(() => n.editNetworkUpdate({ network_id: 1, update_id: id, note: 'Invalid' }));
	}
});
test('malformed/orphan Network backups fail without touching live records', () => {
	populated();
	const before = contents();
	for (const sql of [
		"UPDATE networks SET email='invalid'",
		"UPDATE networks SET follow_up_date='2000-02-30'",
		"UPDATE job_networks SET network_id='missing'",
		"UPDATE job_networks SET notes='" + 'x'.repeat(2001) + "'",
		"UPDATE network_updates SET interaction_date='bad'",
		'UPDATE network_updates SET id=-1',
		"UPDATE network_updates SET updated_at='invalid'",
		'CREATE TABLE surprise (id TEXT)'
	]) {
		const backup = b.createBackup();
		const path = b.getBackupFile(backup.backup_id).path;
		const db = new DatabaseSync(path);
		db.exec('PRAGMA foreign_keys=OFF');
		db.exec('PRAGMA ignore_check_constraints=ON');
		db.exec(sql);
		db.close();
		assert.throws(
			() => b.importBackup(path),
			(error) => ['invalid_backup', 'unsupported_schema'].includes(error.code)
		);
		assert.deepEqual(contents(), before);
	}
});
test('coordinated database/file restore includes Network and keeps a complete recovery', async () => {
	const { person, j, entry } = populated();
	const doc = await createDocument({ filename: 'cv.md', content: '# CV' });
	const before = contents(),
		pair = await pairs.createBackupPair();
	n.editNetwork(person.id, { notes: 'Later' });
	n.editJobNetwork({ job_id: j.id, network_id: person.id, notes: 'Changed' });
	n.deleteNetworkUpdate({ network_id: person.id, update_id: entry.id, confirm: true });
	const replaced = contents();
	const preview = await pairs.prepareBackupPairRestore({ file_backup_id: pair.file_backup_id });
	assert.equal(preview.database.incoming.network_update_count, 1);
	const result = await pairs.restoreBackupPair({ restore_id: preview.restore_id, confirm: true });
	assert.deepEqual(contents(), before);
	assert.equal((await getDocument({ id: doc.id, include_content: true })).content, '# CV');
	const recovery = b.prepareRestore(result.database.recovery_backup_id);
	b.restoreBackup(recovery.restore_id, true);
	assert.deepEqual(contents(), replaced);
});

test('concurrent link retries serialize into one relationship without overwriting notes', async () => {
	const person = n.createNetwork({ name: 'Alex' }),
		j = job();
	const run = (notes) =>
		new Promise((resolve, reject) => {
			const code = `import {linkJobNetwork} from './src/lib/server/networks.js'; console.log(JSON.stringify(linkJobNetwork(${JSON.stringify({ job_id: j.id, network_id: person.id, notes })},'mcp')));`;
			const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
				env: process.env,
				stdio: ['ignore', 'pipe', 'pipe']
			});
			let output = '',
				errors = '';
			child.stdout.on('data', (chunk) => (output += chunk));
			child.stderr.on('data', (chunk) => (errors += chunk));
			child.on('error', reject);
			child.on('close', (code) => (code ? reject(new Error(errors)) : resolve(JSON.parse(output))));
		});
	const results = await Promise.all([run('First context'), run('Second context')]);
	assert.equal(results.filter((row) => row.created).length, 1);
	assert.equal(results[0].notes, results[1].notes);
	assert.equal(n.listNetworkJobs({ network_id: person.id }).total, 1);
});

test('failed database replacement rolls back Network and retains complete recovery', () => {
	const { person } = populated();
	const backup = b.createBackup();
	n.editNetwork(person.id, { notes: 'Must survive failure' });
	const before = contents(),
		preview = b.prepareRestore(backup.backup_id);
	assert.throws(() =>
		b.restoreBackup(preview.restore_id, true, {
			beforeCommit: () => {
				throw new Error('Injected failure');
			}
		})
	);
	assert.deepEqual(contents(), before);
	const recovery = b.listBackups().backups.find((row) => row.kind === 'recovery');
	assert.equal(recovery.network_update_count, 1);
	const recovered = b.prepareRestore(recovery.backup_id);
	b.restoreBackup(recovered.restore_id, true);
	assert.deepEqual(contents(), before);
});

test('failed coordinated file publication recovers the replaced Network state', async () => {
	const { person } = populated();
	await createDocument({ filename: 'cv.md', content: '# Original' });
	const pair = await pairs.createBackupPair();
	n.editNetwork(person.id, { notes: 'Keep newer context' });
	const before = contents(),
		preview = await pairs.prepareBackupPairRestore({ file_backup_id: pair.file_backup_id });
	const record = JSON.parse(
		readFileSync(join(filePaths().state, `${preview.files.restore_id}.restore.json`), 'utf8')
	);
	await writeFile(join(record.stage, record.manifest.documents[0].key), 'Corrupt staged bytes');
	await assert.rejects(pairs.restoreBackupPair({ restore_id: preview.restore_id, confirm: true }), {
		code: 'RESTORE_FAILED'
	});
	assert.deepEqual(contents(), before);
});
