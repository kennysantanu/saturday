import { listReminders } from '../src/lib/server/local/reminders.js';
import * as networks from '../src/lib/server/local/people.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { parse } from 'devalue';
import yauzl from 'yauzl';
import { migrateDatabase } from '../src/lib/server/database.js';
import { getInstallation } from '../src/lib/server/installation.js';
import { createJob, getJob, setJobScore } from '../src/lib/server/local/jobs.js';
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
		const health = await (await fetch(`${base}/health`)).json();
		assert.equal(health.app, 'saturday');
		assert.equal(health.status, 'ready');
		assert.ok(health.installation_id);
		assert.ok(!JSON.stringify(health).includes(scratch));
		const settingsResponse = await fetch(`${base}/settings`);
		assert.equal(settingsResponse.headers.get('x-saturday-build'), readBuildInfo().id);
		const settings = await settingsResponse.text();
		assert.ok(settings.includes('Download database and files'));
		assert.ok(settings.includes('Diagnostics'));
		assert.ok(settings.includes('Database schema'));
		assert.ok(settings.includes('saturday.database'));
		assert.ok(settings.includes('saturday.files'));
		assert.ok(settings.includes(join(scratch, 'backups', 'database')));
		assert.ok(settings.includes(process.env.SATURDAY_DB_PATH + '.restore'));
		const filesStateDir = getInstallation().files_state;
		assert.ok(settings.includes(join(scratch, 'backups', 'files')));
		assert.ok(settings.includes(filesStateDir));
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
		assert.equal(restored.type, 'success');
		assert.ok(restored.data?.recoveryBackupId);
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
		const personContext =
			`/networks/${personId}?` +
			new URLSearchParams({
				return_to: '/networks?organization=Acme&page=3',
				jobs_page: '2',
				updates_page: '3'
			});
		const contextualEdit = await postJob(
			`/networks/${personId}/edit?` + new URLSearchParams({ return_to: personContext }),
			{ name: 'Alex Example', role: 'Recruiter', organization: 'Acme' }
		);
		const editLocation = new URL(contextualEdit.location, base);
		assert.equal(editLocation.pathname, `/networks/${personId}`);
		assert.equal(editLocation.searchParams.get('return_to'), '/networks?organization=Acme&page=3');
		assert.equal(editLocation.searchParams.get('jobs_page'), '2');
		assert.equal(editLocation.searchParams.get('updates_page'), '3');
		const unsafeEdit = await postJob(`/networks/${personId}/edit?return_to=https://evil.example`, {
			name: 'Alex Example',
			role: 'Recruiter',
			organization: 'Acme'
		});
		assert.equal(new URL(unsafeEdit.location, base).searchParams.get('return_to'), '/networks');
		const peopleList = await (await fetch(`${base}/networks`)).text();
		assert.ok(peopleList.includes(`Person number ${personId}`));
		const personDetail = await (await fetch(`${base}/networks/${personId}`)).text();
		assert.ok(personDetail.includes(`Record number ${personId}`));
		const follow = await postJob(`/networks/${personId}?/reminderCreate`, {
			reminder_date: '2000-01-01',
			reminder_note: 'Check in'
		});
		assert.equal(follow.type, 'redirect');
		const postNativePath = (path, values) =>
			fetch(`${base}${path}`, {
				method: 'POST',
				headers: { origin: base, accept: 'text/html' },
				body: new URLSearchParams(values),
				redirect: 'manual'
			});
		const assertNativeAnchor = async (response, expectedFragment) => {
			assert.equal(response.status, 303);
			const location = response.headers.get('location') ?? '';
			const resolved = new URL(location, base);
			assert.equal(resolved.hash, expectedFragment ? `#${expectedFragment}` : '');
			const page = await fetch(resolved);
			assert.equal(page.status, 200);
			const html = await page.text();
			if (expectedFragment) {
				assert.ok(
					html.includes(`id="${expectedFragment}"`),
					`Expected ${resolved.pathname}${resolved.search} to contain id="${expectedFragment}"`
				);
			}
			return resolved;
		};
		const linkedEnhanced = await postJob(`/networks/${personId}?/link`, {
			job_id: job.id,
			notes: 'Referrer'
		});
		assert.equal(linkedEnhanced.type, 'success');
		assert.equal(parse(linkedEnhanced.data).saved, 'network-linked');
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
		// Person-page interaction: enhanced submit returns success data without redirecting;
		// native submit redirects 303 with pagination/return_to params and #person-interactions fragment.
		const addedInteraction = await postJob(
			`/networks/${personId}?/addInteraction&jobs_page=2&updates_page=3`,
			{
				interaction_date: '2000-01-01',
				note: 'Met Alex'
			}
		);
		assert.equal(addedInteraction.type, 'success');
		assert.equal(parse(addedInteraction.data).saved, 'interaction');
		const interaction = networks.listNetworkUpdates({ network_id: personId }).updates[0];
		assert.equal(interaction.note, 'Met Alex');
		const personReturnTo = '/networks?organization=Acme&page=3';
		const nativeEditInteraction = await postNativePath(
			`/networks/${personId}?/editInteraction&` +
				new URLSearchParams({
					return_to: personReturnTo,
					jobs_page: '2',
					updates_page: '3'
				}),
			{ update_id: interaction.id, interaction_date: '2000-01-02', note: 'Corrected natively' }
		);
		const nativeEditUrl = await assertNativeAnchor(nativeEditInteraction, 'person-interactions');
		assert.equal(nativeEditUrl.searchParams.get('return_to'), personReturnTo);
		assert.equal(nativeEditUrl.searchParams.get('jobs_page'), '2');
		assert.equal(nativeEditUrl.searchParams.get('updates_page'), '3');
		assert.equal(nativeEditUrl.searchParams.get('saved'), 'interaction-corrected');
		assert.equal(
			networks.listNetworkUpdates({ network_id: personId }).updates[0].note,
			'Corrected natively'
		);
		const nativePersonNote = await postNativePath(
			`/networks/${personId}?/note&` +
				new URLSearchParams({
					return_to: personReturnTo,
					jobs_page: '2',
					updates_page: '3'
				}),
			{ job_id: job.id, notes: 'Referrer updated natively' }
		);
		const nativePersonNoteUrl = await assertNativeAnchor(nativePersonNote, 'person-linked-jobs');
		assert.equal(nativePersonNoteUrl.searchParams.get('return_to'), personReturnTo);
		assert.equal(nativePersonNoteUrl.searchParams.get('jobs_page'), '2');
		assert.equal(nativePersonNoteUrl.searchParams.get('updates_page'), '3');
		assert.equal(nativePersonNoteUrl.searchParams.get('saved'), 'network-note');
		const editInteraction = await postJob(
			`/networks/${personId}?/editInteraction&jobs_page=2&updates_page=3`,
			{ update_id: interaction.id, interaction_date: '2000-01-02', note: 'Corrected' }
		);
		assert.equal(editInteraction.type, 'success');
		assert.equal(parse(editInteraction.data).saved, 'interaction-corrected');
		assert.equal(
			networks.listNetworkUpdates({ network_id: personId }).updates[0].note,
			'Corrected'
		);
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
			'success'
		);
		assert.equal(
			(
				await postJob(`/jobs/${job.id}?/networkNote`, {
					network_id: personId,
					notes: 'Hiring manager'
				})
			).type,
			'success'
		);
		assert.ok((await (await fetch(`${base}/jobs/${job.id}`)).text()).includes('Hiring manager'));
		const unconfirmedUnlink = await postJob(`/jobs/${job.id}?/networkUnlink`, {
			network_id: personId
		});
		assert.equal(unconfirmedUnlink.type, 'failure');
		assert.equal(unconfirmedUnlink.status, 409);
		assert.equal(
			networks.jobLinkNote({ job_id: job.id, network_id: personId }).note,
			'Hiring manager'
		);
		assert.equal(
			(
				await postJob(`/jobs/${job.id}?/networkUnlink`, {
					network_id: personId,
					confirm_note_loss: '1'
				})
			).type,
			'success'
		);
		// Job-page star: native submit redirects 303 to the top of the page (no fragment) while
		// preserving return_to; enhanced submit returns success data without redirecting.
		const jobReturnTo = '/jobs?company=Example';
		const nativeStar = await postNativePath(
			`/jobs/${job.id}?/star&` + new URLSearchParams({ return_to: jobReturnTo }),
			{ is_starred: '1' }
		);
		const nativeStarUrl = await assertNativeAnchor(nativeStar, '');
		assert.equal(nativeStarUrl.searchParams.get('return_to'), jobReturnTo);
		assert.equal(nativeStarUrl.searchParams.get('saved'), 'starred');
		assert.equal(getJob(job.id).isStarred, true);
		const enhancedUnstar = await postJob(`/jobs/${job.id}?/star`, { is_starred: '0' });
		assert.equal(enhancedUnstar.type, 'success');
		assert.equal(parse(enhancedUnstar.data).saved, 'starred');
		assert.equal(getJob(job.id).isStarred, false);
		// Job-page history (changeStage): native submit redirects 303 with return_to and #job-history.
		const { listWorkflowStages } = await import('../src/lib/server/application.js');
		const nextStage = (await listWorkflowStages()).find(
			(s) => s.id !== getJob(job.id).currentStageId && !s.isClosed
		);
		const nativeStage = await postNativePath(
			`/jobs/${job.id}?/changeStage&` + new URLSearchParams({ return_to: jobReturnTo }),
			{ stage_id: String(nextStage.id), event_date: '2000-01-01', note: 'Moved natively' }
		);
		const nativeStageUrl = await assertNativeAnchor(nativeStage, 'job-history');
		assert.equal(nativeStageUrl.searchParams.get('return_to'), jobReturnTo);
		assert.equal(nativeStageUrl.searchParams.get('saved'), 'stage-changed');
		assert.equal(getJob(job.id).currentStageId, nextStage.id);
		const contextual = await postJob(`/networks/new?job_id=${job.id}`, { name: 'Context person' });
		assert.equal(contextual.type, 'redirect');
		assert.equal(new URL(contextual.location, base).pathname, `/jobs/${job.id}`);
		assert.equal(new URL(contextual.location, base).searchParams.get('link_person'), '1');
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
			'success'
		);
		// Job-page networkLink: native submit redirects 303 with return_to and #job-network.
		const nativeNetworkLink = await postNativePath(
			`/jobs/${job.id}?/networkLink&` + new URLSearchParams({ return_to: jobReturnTo }),
			{ network_id: personId, notes: 'Linked natively' }
		);
		const nativeNetworkLinkUrl = await assertNativeAnchor(nativeNetworkLink, 'job-network');
		assert.equal(nativeNetworkLinkUrl.searchParams.get('return_to'), jobReturnTo);
		assert.equal(nativeNetworkLinkUrl.searchParams.get('saved'), 'network-linked');
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
		assert.ok(!newPage.includes('name="follow_up_comment"'));
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
			is_starred: '1',
			score: '999',
			score_comment: 'Forged'
		});
		assert.equal(newJob.type, 'redirect');
		const newId = newJob.location.split('/').at(-1).split('?')[0];
		await postJob(`/jobs/${newId}?/reminderCreate`, {
			reminder_date: '2026-10-01',
			reminder_note: 'Send email'
		});
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
		assert.ok(jobsPage.includes(`href="/jobs/${newId}?return_to=`));
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
		// The Advanced panel opens by itself when a filter inside it has an error.
		assert.ok(/class="filter-panel/.test(invalidSearch));
		assert.ok(!/class="filter-panel is-collapsed"/.test(invalidSearch));
		const dashboard = await (await fetch(base)).text();
		assert.ok(dashboard.includes('Needs attention'));
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
		assert.equal(listReminders({ job_id: Number(newId) }).reminders[0].note, 'Send email');
		const invalidJob = await postJob(`/jobs/${newId}/edit`, {
			job_title: 'Title',
			company_name: 'Example',
			application_deadline: '2026-02-30'
		});
		assert.equal(invalidJob.type, 'failure');
		assert.equal(getJob(newId).location, 'Portland');
		assert.equal(
			(
				await postJob(`/jobs/${newId}?/reminderCreate`, {
					reminder_date: '2026-12-01',
					reminder_note: 'New reminder'
				})
			).type,
			'redirect'
		);
		assert(
			listReminders({ job_id: Number(newId) }).reminders.some((r) => r.note === 'New reminder')
		);
		const lastReminder = listReminders({ job_id: Number(newId) }).reminders.find(
			(r) => r.note === 'New reminder'
		);
		assert.equal(
			(await postJob(`/jobs/${newId}?/reminderDismiss`, { reminder_id: String(lastReminder.id) }))
				.type,
			'redirect'
		);
		assert.equal(listReminders({ job_id: Number(newId), view: 'inactive' }).total, 1);
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
		// Profile select: native submit redirects 303 to the slot's group anchor (#profile-about-you).
		const profileSelectCatalog = await (await fetch(`${base}/api/documents`)).json();
		const cvDoc = profileSelectCatalog.documents.find((d) => d.id === docId);
		const nativeProfileSelect = await postNativePath('/profile?/select', {
			designation: 'master_cv',
			id: docId,
			token: cvDoc.token,
			catalog_token: profileSelectCatalog.catalog_token
		});
		const nativeProfileUrl = await assertNativeAnchor(nativeProfileSelect, 'profile-about-you');
		assert.equal(nativeProfileUrl.searchParams.get('saved'), 'profile');
		assert.equal((await getProfileDocument({ designation: 'master_cv' })).id, docId);
		const crossOrigin = await fetch(`${base}/api/files/upload?filename=evil.txt`, {
			method: 'POST',
			headers: { origin: 'https://evil.example', 'content-type': 'application/octet-stream' },
			body: 'bad'
		});
		assert.equal(crossOrigin.status, 403);
		const fileBackup = await post('fileBackup', new FormData());
		assert.equal(fileBackup.type, 'success');
		assert.equal(fileBackup.data?.fileBackupSaved, true);
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
		assert.equal(completeBackup.type, 'success');
		assert.equal(completeBackup.data?.backupSaved, true);
		const savedSet = listBackups({ limit: 50 }).backups.find(
			(b) => b.file_backup_id && b.kind === 'manual'
		);
		assert.ok(savedSet);
		const backupPage = await (await fetch(`${base}/settings`)).text();
		assert.ok(backupPage.includes('Download database and files'));
		assert.ok(backupPage.includes('Advanced backup options'));
		assert.ok(backupPage.includes('action="?/backup"'));
		assert.ok(backupPage.includes('name="contents"'));
		assert.match(backupPage, /<option[^>]*value="all"[^>]*>Database and files<\/option>/);
		assert.match(backupPage, /<option[^>]*value="files"[^>]*>Files only<\/option>/);
		assert.match(backupPage, /<option[^>]*value="database"[^>]*>Database only<\/option>/);
		assert.ok(backupPage.includes('Back up now'));
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
		assert.equal((await post('deleteBackup', deletion)).type, 'success');
		// One action exports both halves as one ZIP with exactly the three expected entries.
		const exported = await post('exportSnapshot', new FormData());
		assert.equal(exported.type, 'redirect');
		const exportLocation = exported.location ?? exported.data?.location;
		assert.ok(String(exportLocation).includes('contents=all'), 'export targets the combined ZIP');
		const exportPath = String(exportLocation).replace(/^https?:\/\/[^/]+/, '');
		const exportZip = await fetch(`${base}${exportPath}`);
		assert.equal(exportZip.status, 200);
		const exportBuffer = Buffer.from(await exportZip.arrayBuffer());
		assert.equal(
			exportBuffer.subarray(0, 2).toString(),
			'PK',
			'export is a ZIP, not a bare database'
		);
		const zipEntries = await new Promise((resolveEntries, rejectEntries) => {
			yauzl.fromBuffer(exportBuffer, { lazyEntries: true }, (err, zipfile) => {
				if (err) return rejectEntries(err);
				const names = [];
				zipfile.on('entry', (entry) => {
					names.push(entry.fileName);
					zipfile.readEntry();
				});
				zipfile.on('end', () => resolveEntries(names.sort()));
				zipfile.on('error', rejectEntries);
				zipfile.readEntry();
			});
		});
		assert.deepEqual(
			zipEntries,
			['database.sqlite', 'files.zip', 'pair.json'],
			'exported ZIP has exactly the three coordinated backup entries'
		);

		// Invalid / unknown file_backup_id sent to ?/filePairPrepare fails cleanly (400, no 500).
		const badPairPrepare = new FormData();
		badPairPrepare.set('file_backup_id', '00000000-0000-0000-0000-000000000000');
		const badPairResult = await post('filePairPrepare', badPairPrepare);
		assert.equal(badPairResult.type, 'failure');
		assert.equal(badPairResult.status, 400);
		assert.ok(badPairResult.data?.fileError, 'invalid file_backup_id reports a fileError');

		// Regression for Fix 1: GET /settings (with or without ?restore_imported) never prepares a
		// restore preview or writes pair-restore state, so an imported bundle can be deleted immediately.
		const importedForDelete = await fetch(`${base}/settings/files/import?bundle=true`, {
			method: 'POST',
			headers: { origin: base, 'content-type': 'application/zip' },
			body: bundle
		});
		assert.equal(importedForDelete.status, 200);
		const deleteEntry = await importedForDelete.json();
		const readRestoreStateFiles = () =>
			existsSync(filesStateDir)
				? readdirSync(filesStateDir)
						.filter((name) => name.endsWith('.pair-restore.json') || name.endsWith('.restore.json'))
						.sort()
				: [];
		assert.deepEqual(readRestoreStateFiles(), [], 'no restore preview state exists before GET');
		const plainSettings = await fetch(`${base}/settings`);
		assert.equal(plainSettings.status, 200);
		assert.deepEqual(readRestoreStateFiles(), [], 'GET /settings writes no restore preview state');
		const legacyParamSettings = await fetch(
			`${base}/settings?restore_imported=${encodeURIComponent(deleteEntry.file_backup_id)}`
		);
		assert.equal(legacyParamSettings.status, 200);
		assert.ok(
			!(await legacyParamSettings.text()).includes('Restore the file you just imported'),
			'GET /settings ignores ?restore_imported'
		);
		assert.deepEqual(
			readRestoreStateFiles(),
			[],
			'GET /settings?restore_imported writes no restore preview state'
		);
		const immediateDelete = new FormData();
		immediateDelete.set('backup_id', deleteEntry.database_backup_id);
		immediateDelete.set('contents', 'all');
		immediateDelete.set('confirm', 'true');
		assert.equal(
			(await post('deleteBackup', immediateDelete)).type,
			'success',
			'a freshly imported bundle can be deleted immediately'
		);

		// Post-import preview preparation goes through POST ?/filePairPrepare and does write state.
		const importedForPreview = await fetch(`${base}/settings/files/import?bundle=true`, {
			method: 'POST',
			headers: { origin: base, 'content-type': 'application/zip' },
			body: bundle
		});
		assert.equal(importedForPreview.status, 200);
		const previewEntry = await importedForPreview.json();
		const postImportPrep = new FormData();
		postImportPrep.set('file_backup_id', previewEntry.file_backup_id);
		const postImportPreview = await post('filePairPrepare', postImportPrep);
		assert.equal(postImportPreview.type, 'success');
		assert.ok(
			postImportPreview.data?.filePairPreview?.restore_id,
			'POST ?/filePairPrepare returns the coordinated restore preview'
		);
		const afterPostState = readRestoreStateFiles();
		assert.ok(
			afterPostState.length > 0 &&
				afterPostState.includes(
					`${postImportPreview.data.filePairPreview.restore_id}.pair-restore.json`
				),
			'POST ?/filePairPrepare writes restore preview state into files_state'
		);

		const selection = new FormData();
		selection.set('backup_id', `all:${savedSet.backup_id}`);
		const pairPreview = await post('prepare', selection);
		assert.equal(pairPreview.type, 'success');
		assert.ok(pairPreview.data.filePairPreview.files.incoming_count >= 2);
		const pairConfirm = new FormData();
		pairConfirm.set('restore_id', pairPreview.data.filePairPreview.restore_id);
		assert.equal((await post('filePairRestore', pairConfirm)).type, 'failure');
		pairConfirm.set('confirm', 'true');
		assert.equal((await post('filePairRestore', pairConfirm)).type, 'success');
		const databaseOnly = new FormData();
		databaseOnly.set('contents', 'database');
		assert.equal((await post('backup', databaseOnly)).type, 'success');

		// Settings actions distinguish native form submits (303 redirect to section anchor)
		// from enhanced submits (accept: application/json -> success data result, no redirect).
		const postNative = (action, body) =>
			fetch(`${base}/settings?/${action}`, {
				method: 'POST',
				headers: { origin: base, accept: 'text/html' },
				body,
				redirect: 'manual'
			});
		const beforeNativeBackupIds = new Set(
			listBackups({ limit: 50 }).backups.map((b) => b.backup_id)
		);
		const nativeBackupBody = new FormData();
		nativeBackupBody.set('contents', 'database');
		const nativeBackup = await postNative('backup', nativeBackupBody);
		const nativeBackupUrl = await assertNativeAnchor(nativeBackup, 'backups');
		assert.equal(nativeBackupUrl.searchParams.get('saved'), 'backup');
		const nativeCreated = listBackups({ limit: 50 }).backups.find(
			(b) => !beforeNativeBackupIds.has(b.backup_id)
		);
		assert.ok(nativeCreated, 'native backup created a backup entry');

		const beforeEnhancedBackupIds = new Set(
			listBackups({ limit: 50 }).backups.map((b) => b.backup_id)
		);
		const enhancedBackupBody = new FormData();
		enhancedBackupBody.set('contents', 'database');
		const enhancedBackup = await post('backup', enhancedBackupBody);
		assert.equal(enhancedBackup.type, 'success');
		assert.equal(enhancedBackup.data?.backupSaved, true);
		const enhancedCreated = listBackups({ limit: 50 }).backups.find(
			(b) => !beforeEnhancedBackupIds.has(b.backup_id)
		);
		assert.ok(enhancedCreated, 'enhanced backup created a backup entry');

		const nativeDeleteBody = new FormData();
		nativeDeleteBody.set('backup_id', nativeCreated.backup_id);
		nativeDeleteBody.set('contents', 'database');
		nativeDeleteBody.set('confirm', 'true');
		const nativeDelete = await postNative('deleteBackup', nativeDeleteBody);
		await assertNativeAnchor(nativeDelete, 'backups');
		assert.ok(
			!listBackups({ limit: 50 }).backups.some((b) => b.backup_id === nativeCreated.backup_id),
			'native deleteBackup removed the backup'
		);

		const enhancedDeleteBody = new FormData();
		enhancedDeleteBody.set('backup_id', enhancedCreated.backup_id);
		enhancedDeleteBody.set('contents', 'database');
		enhancedDeleteBody.set('confirm', 'true');
		const enhancedDelete = await post('deleteBackup', enhancedDeleteBody);
		assert.equal(enhancedDelete.type, 'success');
		assert.equal(enhancedDelete.data?.backupDeleted, true);
		assert.ok(
			!listBackups({ limit: 50 }).backups.some((b) => b.backup_id === enhancedCreated.backup_id),
			'enhanced deleteBackup removed the backup'
		);
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
		// Recovery copy: native submit redirects 303 to #recovery-<docId> and the anchor exists.
		const { recoveryDocuments } = await import('../src/lib/server/application.js');
		const [recoveryDoc] = await recoveryDocuments(newId);
		assert.equal(recoveryDoc.id, scoped.id);
		const nativeRecoveryCopy = await postNativePath(`/settings/files/recovery/${newId}?/copy`, {
			id: recoveryDoc.id,
			token: recoveryDoc.token,
			destination_scope: 'documents',
			filename: 'recovered.md'
		});
		const nativeRecoveryUrl = await assertNativeAnchor(
			nativeRecoveryCopy,
			`recovery-${recoveryDoc.id}`
		);
		assert.equal(nativeRecoveryUrl.searchParams.get('saved'), 'document-copy');
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
