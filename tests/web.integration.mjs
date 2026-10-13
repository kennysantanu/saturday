import * as networks from '../src/lib/server/networks.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { parse } from 'devalue';
import { migrateDatabase } from '../src/lib/server/database.js';
import { createJob, getJob, setJobScore } from '../src/lib/server/services.js';
import { listBackups } from '../src/lib/server/backups.js';
import { readBuildInfo } from '../scripts/build-info.mjs';

test('production Settings download/upload/preview/confirm and manual backups without a worker', async () => {
	const scratch = mkdtempSync(join(tmpdir(), 'saturday-web-backup-'));
	const previous = process.env.SATURDAY_DB_PATH;
	const previousFiles = process.env.SATURDAY_FILES_PATH;
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	process.env.SATURDAY_DB_PATH = join(scratch, 'career.sqlite');
	migrateDatabase();
	const job = createJob({ job_title: 'Backup QA', company_name: 'Example' });
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
		const settingsResponse = await fetch(`${base}/settings`);
		assert.equal(settingsResponse.headers.get('x-saturday-build'), readBuildInfo().id);
		const settings = await settingsResponse.text();
		assert.ok(settings.includes('Backup and restore'));
		assert.ok(settings.includes('Diagnostics'));
		assert.ok(settings.includes('Database schema'));
		assert.ok(settings.includes('saturday.database.numeric'));
		assert.ok(settings.includes('saturday.files.numeric'));
		assert.ok(settings.includes(join(scratch, 'backups', 'database')));
		assert.ok(settings.includes(process.env.SATURDAY_DB_PATH + '.restore'));
		assert.ok(settings.includes(join(scratch, 'backups', 'files')));
		assert.ok(settings.includes(process.env.SATURDAY_FILES_PATH + '.state'));
		assert.ok(!settings.includes('Automatic backups'));
		assert.equal(listBackups().backups.length, 0);
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
		const postJob = async (path, values) => {
			const response = await fetch(`${base}${path}`, {
				method: 'POST',
				headers: { origin: base, accept: 'application/json', 'x-sveltekit-action': 'true' },
				body: new URLSearchParams(values)
			});
			return response.json();
		};
		const networkPage = await (await fetch(`${base}/networks`)).text();
		assert.ok(networkPage.includes('No people yet'));
		assert.ok(networkPage.includes('method="GET"'));
		const badPerson = await postJob('/networks/new', { name: '', email: 'bad' });
		assert.equal(badPerson.type, 'failure');
		assert.ok(parse(badPerson.data).errors.name);
		const createdPerson = await postJob('/networks/new', {
			name: 'Alex',
			role: 'Recruiter',
			organization: 'Acme',
			notes: 'General'
		});
		assert.equal(createdPerson.type, 'redirect');
		const personId = createdPerson.location.split('/').at(-1).split('?')[0];
		const editPerson = await postJob(`/networks/${personId}/edit`, {
			name: 'Alex Example',
			role: 'Recruiter',
			organization: 'Acme'
		});
		assert.equal(editPerson.type, 'redirect');
		const peopleList = await (await fetch(`${base}/networks`)).text();
		assert.ok(peopleList.includes(`Person number ${personId}`));
		const personDetail = await (await fetch(`${base}/networks/${personId}`)).text();
		assert.ok(personDetail.includes(`Record number ${personId}`));
		const follow = await postJob(`/networks/${personId}?/followUp`, {
			follow_up_date: '2000-01-01',
			follow_up_comment: 'Check in'
		});
		assert.equal(follow.type, 'redirect');
		assert.equal(
			(await postJob(`/networks/${personId}?/link`, { job_id: job.id, notes: 'Referrer' })).type,
			'redirect'
		);
		const personDetails = await (await fetch(`${base}/networks/${personId}`)).text();
		assert.ok(personDetails.includes('Linked jobs'));
		assert.ok(personDetails.includes('Referrer'));
		assert.ok(personDetails.includes('Overdue'));
		assert.ok(personDetails.includes('No interactions recorded'));
		const networkSearch = await (
			await fetch(`${base}/networks?role=recruiter&organization=acme`)
		).text();
		assert.ok(networkSearch.includes('Alex Example'));
		assert.ok(networkSearch.includes('value="recruiter"'));
		assert.ok(
			(await (await fetch(`${base}/networks?role=engineer`)).text()).includes('No matching people')
		);
		const networkValidation = await (await fetch(`${base}/networks?sort=invalid`)).text();
		assert.ok(networkValidation.includes('aria-invalid="true"'));
		const clamped = await fetch(`${base}/networks?page=99`, { redirect: 'manual' });
		assert.equal(clamped.status, 303);
		assert.equal(clamped.headers.get('location'), '/networks');
		assert.equal(
			(
				await postJob(`/networks/${personId}?/addInteraction&jobs_page=2&updates_page=3`, {
					interaction_date: '2000-01-01',
					note: 'Met Alex'
				})
			).type,
			'redirect'
		);
		const interaction = networks.listNetworkUpdates({ network_id: personId }).updates[0];
		const editInteraction = await postJob(
			`/networks/${personId}?/editInteraction&jobs_page=2&updates_page=3`,
			{ update_id: interaction.id, interaction_date: '2000-01-02', note: 'Corrected' }
		);
		assert.equal(editInteraction.type, 'redirect');
		assert.ok(editInteraction.location.includes('jobs_page=2'));
		assert.ok(editInteraction.location.includes('updates_page=3'));
		assert.equal(
			(await postJob(`/networks/${personId}?/deleteInteraction`, { update_id: interaction.id }))
				.type,
			'failure'
		);
		assert.equal(
			(
				await postJob(`/networks/${personId}?/deleteInteraction`, {
					update_id: interaction.id,
					confirm: 'true'
				})
			).type,
			'redirect'
		);
		assert.equal(
			(
				await postJob(`/jobs/${job.id}?/networkNote`, {
					network_id: personId,
					notes: 'Hiring manager'
				})
			).type,
			'redirect'
		);
		assert.ok((await (await fetch(`${base}/jobs/${job.id}`)).text()).includes('Hiring manager'));
		assert.equal(
			(await postJob(`/jobs/${job.id}?/networkUnlink`, { network_id: personId })).type,
			'redirect'
		);
		const contextual = await postJob(`/networks/new?job_id=${job.id}`, { name: 'Context person' });
		assert.equal(contextual.type, 'redirect');
		assert.ok(contextual.location.startsWith(`/jobs/${job.id}?link_person=1&person=`));
		const contextId = new URL(contextual.location, base).searchParams.get('person');
		assert.equal(
			networks.listNetworks({ job_id: job.id }).total,
			0,
			'Saving does not silently link'
		);
		assert.ok(
			(await (await fetch(`${base}${contextual.location}`)).text()).includes('Context person')
		);
		assert.equal(
			(await postJob(`/jobs/${job.id}?/networkLink`, { network_id: contextId, notes: 'Referral' }))
				.type,
			'redirect'
		);
		const missingOrigin = await postJob('/networks/new?job_id=missing', { name: 'Kept person' });
		assert.ok(missingOrigin.location.includes('missing_job=1'));
		assert.equal((await fetch(`${base}/networks/not-a-person`)).status, 404);
		assert.match(personId, /^[1-9]\d*$/);
		for (const id of ['01', '1e0', '1.0', 'not-a-job', '9007199254740992']) {
			assert.equal((await fetch(`${base}/jobs/${id}`)).status, 404);
			assert.equal((await fetch(`${base}/jobs/${id}/edit`)).status, 404);
			assert.equal((await fetch(`${base}/networks/${id}`)).status, 404);
		}
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
		assert.ok(detail.includes(`Record number ${newId}`));
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
		assert.ok(jobsPage.includes(`Job number ${newId}`));
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
		assert.ok((await (await fetch(`${base}/documents`)).text()).includes('/profile'));
		assert.ok((await (await fetch(`${base}/profile`)).text()).includes('Cover letter template'));
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

		const profileCatalog = await (await fetch(`${base}/api/documents`)).json();
		const profileCreated = await postJob('/documents/new?/save', {
			filename: 'web-letter',
			content: '<p>Dear team</p>',
			designation: 'cover_letter_template',
			catalog_token: profileCatalog.catalog_token
		});
		assert.equal(profileCreated.location, '/profile?saved=profile');
		const { getDocument: getProfileDocument } =
			await import('../src/lib/server/files/documents.js');
		const letter = await getProfileDocument({
			designation: 'cover_letter_template',
			include_content: true
		});
		assert.equal(letter.filename, 'web-letter.html');
		assert.equal(letter.content, '<p>Dear team</p>');
		const profileUploadCatalog = await (await fetch(`${base}/api/documents`)).json();
		const profileUpload = await fetch(
			`${base}/api/files/upload?filename=direction.md&designation=career_direction&catalog_token=${profileUploadCatalog.catalog_token}`,
			{
				method: 'POST',
				headers: { origin: base, 'content-type': 'application/octet-stream' },
				body: '# Target roles'
			}
		);
		assert.equal(profileUpload.status, 200);
		assert.equal(
			(await getProfileDocument({ designation: 'career_direction' })).filename,
			'direction.md'
		);
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
		const completeBackup = await post('backup', new FormData());
		assert.equal(completeBackup.type, 'redirect');
		const savedSet = listBackups({ limit: 50 }).backups.find(
			(b) => b.file_backup_id && b.kind === 'manual'
		);
		assert.ok(savedSet);
		const backupPage = await (await fetch(`${base}/settings`)).text();
		assert.ok(backupPage.includes('Back up now'));
		assert.ok(backupPage.includes('Files only'));
		assert.ok(backupPage.includes('Delete'));
		assert.ok(backupPage.includes('Import a combined backup ZIP'));
		assert.ok(!backupPage.includes('Automatic file backups'));
		assert.ok(backupPage.includes('Advanced file recovery'));
		assert.equal(
			backupPage.split(`href="/settings/backups/${savedSet.backup_id}?contents=all"`).length - 1,
			1
		);
		const combined = await fetch(`${base}/settings/backups/${savedSet.backup_id}?contents=all`);
		assert.equal(combined.status, 200);
		const bundle = await combined.arrayBuffer();
		const importedBundle = await fetch(`${base}/settings/files/import?bundle=true`, {
			method: 'POST',
			headers: { origin: base, 'content-type': 'application/zip' },
			body: bundle
		});
		assert.equal(importedBundle.status, 200);
		const importedEntry = await importedBundle.json();
		const deletion = new FormData();
		deletion.set('backup_id', importedEntry.database_backup_id);
		deletion.set('contents', 'all');
		assert.equal((await post('deleteBackup', deletion)).type, 'failure');
		deletion.set('confirm', 'true');
		assert.equal((await post('deleteBackup', deletion)).type, 'redirect');
		const selection = new FormData();
		selection.set('backup_id', `all:${savedSet.backup_id}`);
		const pairPreview = await post('prepare', selection);
		assert.equal(pairPreview.type, 'success');
		assert.ok(pairPreview.data.filePairPreview.files.incoming_count >= 2);
		const pairConfirm = new FormData();
		pairConfirm.set('restore_id', pairPreview.data.filePairPreview.restore_id);
		assert.equal((await post('filePairRestore', pairConfirm)).type, 'failure');
		pairConfirm.set('confirm', 'true');
		assert.equal((await post('filePairRestore', pairConfirm)).type, 'redirect');
		const databaseOnly = new FormData();
		databaseOnly.set('contents', 'database');
		assert.equal((await post('backup', databaseOnly)).type, 'redirect');
		const only = listBackups({ limit: 50 }).backups.find(
			(b) => b.kind === 'manual' && !b.file_backup_id
		);
		selection.set('backup_id', `database:${only.backup_id}`);
		assert.ok((await post('prepare', selection)).data.preview);
		selection.set('backup_id', `files:${fileArtifact.backup_id}`);
		assert.ok((await post('prepare', selection)).data.filePreview);
		databaseOnly.set('contents', 'invalid');
		assert.equal((await post('backup', databaseOnly)).type, 'failure');
		const documents = await import('../src/lib/server/files/documents.js');
		const scoped = await documents.createDocument({
			scope: newId,
			filename: 'private.md',
			content: 'Original dataset only'
		});
		const { DatabaseSync } = await import('node:sqlite');
		const db = new DatabaseSync(process.env.SATURDAY_DB_PATH);
		db.prepare('UPDATE app_metadata SET dataset_id=?').run('f7313b27-59bc-4c3c-bc81-869f19938765');
		db.close();
		const mismatchSettings = await (await fetch(`${base}/settings`)).text();
		assert.ok(mismatchSettings.includes('Job attachments need a matching database'));
		const blockedFile = await fetch(`${base}/api/files/${scoped.id}?scope=${newId}`);
		assert.ok(blockedFile.status >= 400);
		assert.ok(!(await blockedFile.text()).includes('Original dataset only'));
		assert.equal(await (await fetch(`${base}/api/files/${docId}`)).text(), '# Web career');

		const manifestPath = join(process.env.SATURDAY_FILES_PATH, 'manifest.json');
		const validManifest = readFileSync(manifestPath, 'utf8');
		try {
			writeFileSync(
				manifestPath,
				JSON.stringify({ ...JSON.parse(validManifest), format_version: 3 })
			);
			const unavailable = await fetch(`${base}/settings`);
			assert.equal(unavailable.status, 200);
			const unavailablePage = await unavailable.text();
			assert.ok(unavailablePage.includes('Unavailable'));
			assert.ok(unavailablePage.includes('Database schema'));
		} finally {
			writeFileSync(manifestPath, validManifest);
		}
		const childExit = new Promise((r) => child.on('close', r));
		child.kill('SIGTERM');
		await childExit;
		assert.ok(!logs.includes('Error:'), logs);
		const stopped = spawnSync(process.execPath, ['scripts/status.mjs'], {
			env: { ...process.env, PORT: String(port) },
			encoding: 'utf8'
		});
		assert.equal(stopped.status, 1, 'Status reports stopped supervisor');
		const restarted = spawn(process.execPath, ['scripts/start.mjs'], {
			env: { ...process.env, PORT: String(port) },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let restartLogs = '';
		restarted.stderr.on('data', (c) => (restartLogs += c));
		try {
			let ready = false;
			for (let i = 0; i < 80; i++) {
				try {
					if ((await fetch(`${base}/jobs/${job.id}`)).ok) {
						ready = true;
						break;
					}
				} catch {}
				await new Promise((r) => setTimeout(r, 100));
			}
			assert.ok(ready, restartLogs);
			const running = spawnSync(process.execPath, ['scripts/status.mjs'], {
				env: { ...process.env, PORT: String(port) },
				encoding: 'utf8'
			});
			assert.equal(running.status, 0, running.stderr);
			assert.ok(getJob(job.id), 'Restart preserves existing numeric records');
		} finally {
			const exit = new Promise((r) => restarted.once('close', r));
			restarted.kill('SIGINT');
			await exit;
		}
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
