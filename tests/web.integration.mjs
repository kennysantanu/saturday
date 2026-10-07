import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { parse } from 'devalue';
import { migrateDatabase } from '../src/lib/server/database.js';
import { createJob, getJob, setJobScore } from '../src/lib/server/services.js';
import { setBackupSettings, listBackups } from '../src/lib/server/backups.js';

test('production Settings download/upload/preview/confirm and supervised worker lifecycle', async () => {
	const scratch = mkdtempSync(join(tmpdir(), 'saturday-web-backup-'));
	const previous = process.env.SATURDAY_DB_PATH;
	const previousFiles = process.env.SATURDAY_FILES_PATH;
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	process.env.SATURDAY_DB_PATH = join(scratch, 'career.sqlite');
	migrateDatabase();
	const job = createJob({ job_title: 'Backup QA', company_name: 'Example' });
	setBackupSettings({ enabled: true, interval_hours: 1, keep_count: 2 });
	const socket = createServer();
	await new Promise((r) => socket.listen(0, '127.0.0.1', r));
	const port = socket.address().port;
	await new Promise((r) => socket.close(r));
	const base = `http://127.0.0.1:${port}`;
	const child = spawn(process.execPath, ['scripts/start.mjs'], {
		cwd: resolve('.'),
		env: { ...process.env, PORT: String(port) },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let logs = '';
	child.stdout.on('data', (c) => (logs += c));
	child.stderr.on('data', (c) => (logs += c));
	try {
		let ready = false;
		for (let i = 0; i < 80; i++) {
			try {
				if ((await fetch(`${base}/settings`)).ok) {
					ready = true;
					break;
				}
			} catch {}
			await new Promise((r) => setTimeout(r, 100));
		}
		assert.ok(ready, logs);
		const settings = await (await fetch(`${base}/settings`)).text();
		assert.ok(settings.includes('Backup and restore'));
		assert.ok(settings.replace(/\s+/g, ' ').includes('Automatic backups'));
		for (let i = 0; i < 30 && !listBackups().backups.some((b) => b.kind === 'scheduled'); i++)
			await new Promise((r) => setTimeout(r, 100));
		assert.ok(
			listBackups().backups.some((b) => b.kind === 'scheduled'),
			'supervisor starts the backup worker'
		);
		const created = await fetch(`${base}/settings?/download`, {
			method: 'POST',
			headers: {
				origin: base,
				accept: 'text/html',
				'content-type': 'application/x-www-form-urlencoded'
			},
			body: '',
			redirect: 'manual'
		});
		assert.equal(created.status, 303);
		const path = created.headers.get('location');
		const download = await fetch(`${base}${path}`);
		assert.equal(download.status, 200);
		assert.ok(download.headers.get('content-disposition').includes('attachment'));
		const bytes = new Uint8Array(await download.arrayBuffer());
		assert.equal(Buffer.from(bytes).subarray(0, 16).toString(), 'SQLite format 3\0');
		const extra = createJob({ job_title: 'After backup', company_name: 'Example' });
		const post = async (action, body) => {
			const response = await fetch(`${base}/settings?/${action}`, {
				method: 'POST',
				headers: { origin: base, accept: 'application/json', 'x-sveltekit-action': 'true' },
				body
			});
			const result = await response.json();
			return { ...result, data: result.data ? parse(result.data) : null };
		};
		const form = new FormData();
		form.set('backup_file', new File([bytes], 'portable.sqlite'));
		const prepared = await post('prepare', form);
		assert.equal(prepared.type, 'success');
		assert.equal(prepared.data.preview.current.job_count, 2);
		assert.equal(prepared.data.preview.incoming.job_count, 1);
		const confirmation = new FormData();
		confirmation.set('restore_id', prepared.data.preview.restore_id);
		const missing = await post('restore', confirmation);
		assert.equal(missing.type, 'failure');
		assert.ok(getJob(extra.id));
		confirmation.set('confirm', 'true');
		const restored = await post('restore', confirmation);
		assert.equal(restored.type, 'redirect');
		assert.ok(restored.location.includes('recovery='));
		assert.equal(getJob(extra.id), null);
		assert.ok(getJob(job.id));
		const invalid = new FormData();
		invalid.set('backup_file', new File(['bad file'], 'bad.sqlite'));
		assert.equal((await post('prepare', invalid)).type, 'failure');
		const schedule = new FormData();
		schedule.set('interval_hours', '24');
		schedule.set('keep_count', '10');
		assert.equal((await post('schedule', schedule)).type, 'redirect');
		const postJob = async (path, values) => {
			const response = await fetch(`${base}${path}`, {
				method: 'POST',
				headers: { origin: base, accept: 'application/json', 'x-sveltekit-action': 'true' },
				body: new URLSearchParams(values)
			});
			return response.json();
		};
		const newPage = await (await fetch(`${base}/jobs/new`)).text();
		assert.ok(newPage.includes('name="work_arrangement"'));
		assert.ok(newPage.includes('name="follow_up_comment"'));
		assert.ok(!newPage.includes('name="score"'));
		const newJob = await postJob('/jobs/new', {
			job_title: 'UI details',
			company_name: 'Example',
			location: 'Seattle',
			work_arrangement: 'remote',
			employment_type: 'contract',
			compensation: '$100/hour',
			source: 'Referral',
			application_deadline: '2026-11-01',
			follow_up_date: '2026-10-01',
			follow_up_comment: 'Send email',
			is_starred: '1',
			score: '999',
			score_comment: 'Forged'
		});
		assert.equal(newJob.type, 'redirect');
		const newId = newJob.location.split('/').at(-1).split('?')[0];
		assert.equal(getJob(newId).location, 'Seattle');
		assert.equal(getJob(newId).score, null);
		setJobScore(newId, { score: 8.5, score_comment: 'Strong relevant skills' });
		const detail = await (await fetch(`${base}/jobs/${newId}`)).text();
		assert.ok(detail.includes('Seattle'));
		assert.ok(detail.includes('Strong relevant skills'));
		assert.ok(detail.includes('Starred'));
		assert.ok(!detail.includes('name="score"'));

		const jobsPage = await (
			await fetch(
				`${base}/jobs?title=UI&company=Example&location=Seattle&starred=starred&score_min=8`
			)
		).text();
		assert.ok(jobsPage.includes('method="GET"'));
		assert.ok(jobsPage.includes('Apply filters'));
		assert.ok(jobsPage.includes('Advanced filters'));
		assert.ok(jobsPage.includes(`href="/jobs/${newId}"`));
		assert.ok(
			jobsPage
				.replace(/<!--[\s\S]*?-->/g, '')
				.replace(/\s+/g, ' ')
				.includes('1 job matching filters')
		);
		assert.ok(jobsPage.includes('Remove Company contains: Example'));
		assert.ok(jobsPage.includes('value="Seattle"'));
		const noMatch = await (await fetch(`${base}/jobs?company=Missing`)).text();
		assert.ok(noMatch.includes('No matching jobs'));
		assert.ok(noMatch.includes('Clear filters'));
		const invalidSearch = await (await fetch(`${base}/jobs?created_from=2026-02-30`)).text();
		assert.ok(invalidSearch.includes('Check the filters'));
		assert.ok(invalidSearch.includes('aria-invalid="true"'));
		assert.ok(invalidSearch.includes('open'));
		const dashboard = await (await fetch(base)).text();
		assert.ok(dashboard.includes('Follow-ups'));
		assert.ok(dashboard.includes('Send email'));
		assert.ok(dashboard.includes('Overdue'));
		const edited = await postJob(`/jobs/${newId}/edit`, {
			job_title: 'UI details edited',
			company_name: 'Example',
			location: 'Portland',
			is_starred: '0',
			score: '0',
			score_comment: 'Forged'
		});
		assert.equal(edited.type, 'redirect');
		assert.equal(getJob(newId).score, 8.5);
		assert.equal(getJob(newId).scoreComment, 'Strong relevant skills');
		assert.equal(getJob(newId).followUpComment, 'Send email');
		const invalidJob = await postJob(`/jobs/${newId}/edit`, {
			job_title: 'Title',
			company_name: 'Example',
			application_deadline: '2026-02-30'
		});
		assert.equal(invalidJob.type, 'failure');
		assert.equal(getJob(newId).location, 'Portland');
		assert.equal(
			(
				await postJob(`/jobs/${newId}?/followUp`, {
					follow_up_date: '2026-12-01',
					follow_up_comment: 'New reminder'
				})
			).type,
			'redirect'
		);
		assert.equal(getJob(newId).followUpComment, 'New reminder');
		assert.equal((await postJob(`/jobs/${newId}?/clearFollowUp`, {})).type, 'redirect');
		assert.equal(getJob(newId).followUpDate, null);
		assert.equal(getJob(newId).followUpComment, null);
		assert.ok((await (await fetch(`${base}/documents`)).text()).includes('Select Master CV'));
		const createdDocument = await postJob('/documents/new?/save', {
			filename: 'web-cv',
			content: '# Web career'
		});
		assert.equal(createdDocument.type, 'redirect');
		const docId = createdDocument.location.split('/').at(-1).split('?')[0];
		const listing = await (await fetch(`${base}/api/documents`)).json();
		assert.equal(listing.total, 1);
		const downloaded = await fetch(`${base}/api/files/${docId}`);
		assert.equal(await downloaded.text(), '# Web career');
		const docPage = await (await fetch(`${base}/documents/${docId}`)).text();
		assert.ok(docPage.includes('web-cv.md'));
		const rawUpload = await fetch(`${base}/api/files/upload?filename=upload.txt`, {
			method: 'POST',
			headers: { origin: base, 'content-type': 'application/octet-stream' },
			body: 'Streamed upload'
		});
		assert.equal(rawUpload.status, 200);
		const crossOrigin = await fetch(`${base}/api/files/upload?filename=evil.txt`, {
			method: 'POST',
			headers: { origin: 'https://evil.example', 'content-type': 'application/octet-stream' },
			body: 'bad'
		});
		assert.equal(crossOrigin.status, 403);
		const fileBackup = await post('fileBackup', new FormData());
		assert.equal(fileBackup.type, 'redirect');
		const { listFileBackups } = await import('../src/lib/server/files/backups.js');
		const fileArtifact = (await listFileBackups()).backups[0];
		const zipDownload = await fetch(`${base}/settings/files/${fileArtifact.backup_id}`);
		assert.equal(zipDownload.status, 200);
		assert.equal(
			Buffer.from(await zipDownload.arrayBuffer())
				.subarray(0, 2)
				.toString(),
			'PK'
		);

		const childExit = new Promise((r) => child.on('close', r));
		child.kill('SIGTERM');
		await childExit;
		assert.ok(!logs.includes('Error:'), logs);
	} finally {
		if (child.exitCode === null && child.signalCode === null) {
			const exited = new Promise((r) => child.on('close', r));
			child.kill('SIGTERM');
			await exited;
		}
		rmSync(scratch, { recursive: true, force: true });
		if (previousFiles === undefined) delete process.env.SATURDAY_FILES_PATH;
		else process.env.SATURDAY_FILES_PATH = previousFiles;
		if (previous === undefined) delete process.env.SATURDAY_DB_PATH;
		else process.env.SATURDAY_DB_PATH = previous;
	}
});
