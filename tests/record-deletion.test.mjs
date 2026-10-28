import { createBackup, prepareRestore, restoreBackup } from '../src/lib/server/backups.js';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
	createJob,
	getJob,
	deleteJob,
	addJobUpdate,
	getDashboardStats
} from '../src/lib/server/local/jobs.js';
import * as n from '../src/lib/server/local/people.js';
import * as d from '../src/lib/server/files/documents.js';
import { withDatabase } from '../src/lib/server/database.js';
import { filePaths } from '../src/lib/server/files/store.js';
import { recoverJobDeletion } from '../src/lib/server/job-deletion.js';
import { jobDeletionPath, hasPendingJobDeletion } from '../src/lib/server/job-deletion-state.js';

let root;
test.beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'saturday-deletion-'));
	Object.assign(process.env, {
		SATURDAY_INSTALLATION_PATH: '',
		SATURDAY_DB_PATH: join(root, 'db.sqlite'),
		SATURDAY_FILES_PATH: join(root, 'files'),
		SATURDAY_EXTENSION_STATE_PATH: join(root, 'extensions')
	});
});
test.afterEach(async () => rm(root, { recursive: true, force: true }));
const job = () => {
	const value = createJob({ job_title: 'Delete target', company_name: 'Example' });
	return getJob(value.id);
};
const input = (value) => ({ job_id: value.id, dataset_id: value.dataset_id, confirm: true });
const manifest = async () =>
	JSON.parse(await readFile(join(filePaths().root, 'manifest.json'), 'utf8'));
function worker(options) {
	const child = spawn(
		process.execPath,
		['tests/helpers/record-deletion-worker.mjs', JSON.stringify(options)],
		{ env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }
	);
	let output = '';
	child.stdout.on('data', (data) => (output += data));
	child.stderr.on('data', (data) => (output += data));
	const ready = new Promise((resolve) => child.once('message', resolve));
	const done = new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('exit', (code, signal) => resolve({ code, signal, output }));
	});
	return { child, ready, done };
}
async function attached(value) {
	await d.createDocument({ scope: value.id, filename: 'a.md', content: 'first' });
	await d.createDocument({ scope: value.id, filename: 'b.txt', content: 'second' });
}

test('job deletion includes latest history, relationships and documents while preserving shared records, files and IDs', async () => {
	const value = job(),
		other = job();
	const person = n.createNetwork({ name: 'Same name' });
	n.linkJobNetwork({ job_id: value.id, network_id: person.id, notes: 'remove link' });
	n.linkJobNetwork({ job_id: other.id, network_id: person.id, notes: 'keep link' });
	n.addNetworkUpdate({ network_id: person.id, interaction_date: '2020-01-01', note: 'keep' });
	const general = await d.createDocument({
		filename: 'keep.md',
		content: 'general',
		designation: 'master_cv',
		catalog_token: (await d.listDocuments()).catalog_token
	});
	await attached(value);
	await d.createDocument({ scope: other.id, filename: 'a.md', content: 'other' });
	addJobUpdate({
		job_id: value.id,
		event_date: '2020-01-01',
		note: 'new after confirmation',
		stage_id: null
	});
	const savedPerson = n.getNetwork(person.id),
		savedOther = getJob(other.id);
	assert.equal((await deleteJob(input(value))).documents_deleted, 2);
	assert.equal(getJob(value.id), null);
	assert.deepEqual(n.getNetwork(person.id), savedPerson);
	assert.deepEqual(getJob(other.id), savedOther);
	assert.equal(n.listNetworks({ job_id: other.id }).total, 1);
	assert.equal(n.listNetworkUpdates({ network_id: person.id }).total, 1);
	assert.equal((await d.getDocument({ id: general.id })).filename, 'keep.md');
	assert.equal(
		(
			await d.getDocument({
				designation: 'master_cv',
				catalog_token: (await d.listDocuments()).catalog_token
			})
		).id,
		general.id
	);
	assert.equal((await d.listDocuments({ scope: other.id })).total, 1);
	assert(!(await manifest()).documents.some((entry) => entry.key.startsWith(`jobs/${value.id}/`)));
	assert(!existsSync(join(filePaths().root, 'jobs', String(value.id))));
	assert.equal(withDatabase((db) => db.prepare('PRAGMA foreign_key_check').all()).length, 0);
	assert.equal(
		withDatabase(
			(db) => db.prepare('SELECT COUNT(*) AS n FROM job_updates WHERE job_id=?').get(value.id).n
		),
		0
	);
	assert.equal(getDashboardStats().totalJobs, 1);
	assert(job().id > other.id);
	await assert.rejects(deleteJob(input(value)), (e) => e.code === 'not_found');
});

test('person deletion removes only their interactions and links, and preserves jobs and unrelated timestamps', async () => {
	const value = job(),
		person = n.createNetwork({ name: 'Remove' }),
		other = n.createNetwork({ name: 'Keep' });
	n.linkJobNetwork({ job_id: value.id, network_id: person.id });
	n.linkJobNetwork({ job_id: value.id, network_id: other.id });
	n.addNetworkUpdate({ network_id: person.id, interaction_date: '2020-01-01', note: 'remove' });
	const before = getJob(value.id);
	const result = n.deleteNetwork({
		network_id: person.id,
		dataset_id: value.dataset_id,
		confirm: true
	});
	assert.equal(result.deleted, true);
	assert.deepEqual(getJob(value.id), before);
	assert.equal(n.listNetworks({ job_id: value.id }).total, 1);
	assert.equal(n.getNetwork(other.id).name, 'Keep');
	assert.throws(
		() => n.getNetwork(person.id),
		(e) => e.code === 'not_found'
	);
	assert.equal(
		withDatabase(
			(db) =>
				db.prepare('SELECT COUNT(*) AS n FROM network_updates WHERE network_id=?').get(person.id).n
		),
		0
	);
	assert(n.createNetwork({ name: 'Later' }).id > other.id);
});

test('confirmation and dataset checks preserve data; SQL failures roll back all children and leave documents untouched', async () => {
	const value = job();
	await attached(value);
	for (const changes of [
		{ confirm: false },
		{ dataset_id: 'invalid' },
		{ job_id: '../1' },
		{ dataset_id: randomUUID() }
	])
		await assert.rejects(deleteJob({ ...input(value), ...changes }));
	const prepare = DatabaseSync.prototype.prepare;
	DatabaseSync.prototype.prepare = function (sql, ...args) {
		if (sql === 'DELETE FROM jobs WHERE id=?')
			return {
				run() {
					throw new Error('test rollback');
				}
			};
		return prepare.call(this, sql, ...args);
	};
	try {
		await assert.rejects(deleteJob(input(value)), /test rollback/);
	} finally {
		DatabaseSync.prototype.prepare = prepare;
	}
	assert.equal(getJob(value.id).updates.length, 1);
	assert.equal((await d.listDocuments({ scope: value.id })).total, 2);
	assert.equal(hasPendingJobDeletion(), false);
	assert.equal(
		(
			await d.getDocument({
				id: (await manifest()).documents[0].id,
				scope: value.id,
				include_content: true
			})
		).content,
		'first'
	);
});

test('missing file bytes are tolerated; unknown files, symlinks and a foreign manifest block before mutation', async () => {
	const value = job();
	await attached(value);
	await rm(join(filePaths().root, `jobs/${value.id}/a.md`));
	await writeFile(join(filePaths().root, `jobs/${value.id}/unknown.txt`), 'unknown');
	await assert.rejects(deleteJob(input(value)), /Unregistered/);
	assert(getJob(value.id));
	await rm(join(filePaths().root, `jobs/${value.id}/unknown.txt`));
	const outside = join(root, 'outside.txt');
	await writeFile(outside, 'keep');
	await symlink(outside, join(filePaths().root, `jobs/${value.id}/a.md`));
	await assert.rejects(deleteJob(input(value)), /Unsafe/);
	assert.equal(await readFile(outside, 'utf8'), 'keep');
	await rm(join(filePaths().root, `jobs/${value.id}/a.md`));
	const original = await manifest();
	await writeFile(
		join(filePaths().root, 'manifest.json'),
		JSON.stringify({ ...original, dataset_id: randomUUID() })
	);
	await assert.rejects(deleteJob(input(value)), (e) => e.code === 'DATASET_MISMATCH');
	await writeFile(join(filePaths().root, 'manifest.json'), JSON.stringify(original));
	assert.equal((await deleteJob(input(value))).deleted, true);
});

for (const point of [
	'before-intent',
	'after-intent',
	'before-commit',
	'after-commit',
	'after-file-1',
	'after-file-2',
	'after-manifest',
	'before-clear',
	'after-clear'
]) {
	test(`process interruption at ${point} recovers to the database decision`, async () => {
		const value = job();
		await attached(value);
		const result = await worker({ ...input(value), point }).done;
		assert.equal(result.signal, 'SIGKILL', result.output);
		const beforeCommit = ['before-intent', 'after-intent', 'before-commit'].includes(point);
		if (hasPendingJobDeletion()) {
			assert.throws(
				() => getJob(value.id),
				(e) => e.code === 'RECOVERY_REQUIRED'
			);
			await assert.rejects(d.listDocuments(), (e) => e.code === 'RECOVERY_REQUIRED');
			assert.throws(
				() => createBackup(),
				(e) => e.code === 'RECOVERY_REQUIRED'
			);
		}
		await recoverJobDeletion();
		assert.equal(!!getJob(value.id), beforeCommit);
		const remaining = (await manifest()).documents.filter((entry) =>
			entry.key.startsWith(`jobs/${value.id}/`)
		);
		assert.equal(remaining.length, beforeCommit ? 2 : 0);
		assert.equal(existsSync(join(filePaths().root, `jobs/${value.id}/a.md`)), beforeCommit);
		assert.equal(existsSync(join(filePaths().root, `jobs/${value.id}/b.txt`)), beforeCommit);
		assert.equal(hasPendingJobDeletion(), false);
		assert.deepEqual(await recoverJobDeletion(), { recovered: false });
	});
}

test('post-commit cleanup failure retains the intent and recovers without recreating the job', async () => {
	const value = job();
	await attached(value);
	const result = await worker({ ...input(value), point: 'fail-file' }).done;
	assert.equal(result.code, 1);
	assert.match(result.output, /RECOVERY_REQUIRED/);
	assert(hasPendingJobDeletion());
	await recoverJobDeletion();
	assert.equal(getJob(value.id), null);
	assert.equal((await manifest()).documents.length, 0);
});

test('publication before deletion is included; an upload staged before deletion cannot publish afterwards', async () => {
	const value = job();
	assert.equal((await worker({ mode: 'create', job_id: value.id }).done).code, 0);
	const upload = worker({ mode: 'upload', job_id: value.id });
	try {
		await upload.ready;
		assert.equal((await deleteJob(input(value))).documents_deleted, 1);
		upload.child.send('continue');
		const result = await upload.done;
		assert.equal(result.code, 1);
		assert.match(result.output, /NOT_FOUND/);
		assert(!(await readdir(filePaths().state)).some((name) => name.startsWith('upload-')));
	} finally {
		if (upload.child.exitCode === null) upload.child.kill('SIGKILL');
	}
});

test('an active committed deletion gates other processes and ordinary record/file access until cleanup finishes', async () => {
	const value = job();
	await attached(value);
	const deletion = worker({ ...input(value), point: 'hold-file' });
	try {
		await deletion.ready;
		assert.throws(
			() => job(),
			(e) => e.code === 'RECOVERY_REQUIRED'
		);
		await assert.rejects(d.listDocuments(), (e) => e.code === 'RECOVERY_REQUIRED');
		assert.equal((await worker({ mode: 'create', job_id: value.id }).done).code, 1);
		deletion.child.send('continue');
		assert.equal((await deletion.done).code, 0);
		assert.equal(getJob(value.id), null);
	} finally {
		if (deletion.child.exitCode === null) deletion.child.kill('SIGKILL');
	}
});

test('a copy holding the file lock can validate its destination while deletion holds the database gate', async () => {
	const value = job();
	const source = await d.createDocument({
		filename: 'source.md',
		content: 'preserve general source'
	});
	const copy = worker({ mode: 'copy', job_id: value.id, id: source.id, token: source.token });
	let deletion;
	try {
		await copy.ready;
		deletion = worker({ ...input(value), point: 'notify-lock' });
		await deletion.ready;
		copy.child.send('continue');
		assert.equal((await copy.done).code, 0);
		const result = await deletion.done;
		assert.equal(result.code, 0, result.output);
		assert.match(result.output, /"documents_deleted":1/);
		assert.equal((await d.listDocuments()).total, 1);
		assert.equal(getJob(value.id), null);
	} finally {
		for (const item of [copy, deletion])
			if (item?.child.exitCode === null) item.child.kill('SIGKILL');
	}
});

test('invalid, foreign and unsafe recovery intents fail closed and remain available for repair', async () => {
	const value = job();
	await attached(value);
	const documents = (await manifest()).documents.map(({ id, key }) => ({ id, key }));
	const original = {
		format: 'saturday.job-deletion',
		version: 1,
		operation_id: randomUUID(),
		dataset_id: value.dataset_id,
		job_id: value.id,
		documents
	};
	for (const record of [
		{ ...original, version: 99 },
		{ ...original, dataset_id: randomUUID() },
		{ ...original, documents: [{ id: randomUUID(), key: 'documents/keep.md' }] }
	]) {
		await writeFile(jobDeletionPath(), JSON.stringify(record));
		await assert.rejects(recoverJobDeletion());
		assert(hasPendingJobDeletion());
		assert.equal(await readFile(join(filePaths().root, `jobs/${value.id}/a.md`), 'utf8'), 'first');
		await rm(jobDeletionPath());
	}
	assert(getJob(value.id));
});

test('the host recovery command completes a committed deletion and is safe to run again', async () => {
	const value = job();
	await attached(value);
	await worker({ ...input(value), point: 'after-commit' }).done;
	const run = () =>
		new Promise((resolve, reject) => {
			const child = spawn(process.execPath, ['scripts/files.mjs', 'recover-job-deletion'], {
				env: process.env
			});
			let stdout = '',
				stderr = '';
			child.stdout.on('data', (c) => (stdout += c));
			child.stderr.on('data', (c) => (stderr += c));
			child.once('error', reject);
			child.once('exit', (code) => resolve({ code, stdout, stderr }));
		});
	const result = await run();
	assert.equal(result.code, 0, result.stderr);
	assert.equal(JSON.parse(result.stdout).deleted, true);
	assert.equal(getJob(value.id), null);
	assert.equal((await manifest()).documents.length, 0);
	assert.equal(JSON.parse((await run()).stdout).recovered, false);
});

test('PDF publication rechecks the job after rendering and cannot recreate deleted attachments', async () => {
	const value = job();
	const source = await d.createDocument({
		scope: value.id,
		filename: 'source.html',
		content: '<html><body>Job file</body></html>'
	});
	const pdf = worker({ mode: 'pdf', job_id: value.id, id: source.id, token: source.token });
	try {
		await pdf.ready;
		await deleteJob(input(value));
		pdf.child.send('continue');
		const result = await pdf.done;
		assert.equal(result.code, 1, result.output);
		assert.match(result.output, /NOT_FOUND/);
		assert.equal((await manifest()).documents.length, 0);
	} finally {
		if (pdf.child.exitCode === null) pdf.child.kill('SIGKILL');
	}
});

test('a prior backup restores deleted records explicitly and prepared restores become stale after deletion', async () => {
	const value = job();
	await attached(value);
	const backup = createBackup(),
		preview = prepareRestore(backup.backup_id);
	await deleteJob(input(value));
	assert.throws(
		() => restoreBackup(preview.restore_id, true),
		(e) => e.code === 'restore_stale'
	);
	const fresh = prepareRestore(backup.backup_id);
	restoreBackup(fresh.restore_id, true);
	assert.equal(getJob(value.id).title, value.title);
	// Database-only restore cannot reconstruct file bytes; those require a file/combined backup.
	assert.equal((await d.listDocuments({ scope: value.id })).total, 0);
});
