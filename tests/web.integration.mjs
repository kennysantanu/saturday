import { listReminders } from '../src/lib/server/local/reminders.js';
import * as networks from '../src/lib/server/local/people.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parse } from 'devalue';
import yauzl from 'yauzl';
import puppeteer from 'puppeteer';
import { migrateDatabase } from '../src/lib/server/database.js';
import { getInstallation } from '../src/lib/server/installation.js';
import { codeFingerprint } from '../src/lib/server/installation-operations.js';
import { copySource } from '../scripts/install.mjs';
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

async function settleWithin(promise, ms, onTimeout) {
	let timer;
	try {
		await Promise.race([
			Promise.resolve(promise).catch(() => {}),
			new Promise((resolveTimeout) => {
				timer = setTimeout(() => {
					try {
						onTimeout?.();
					} catch {}
					resolveTimeout();
				}, ms);
				timer.unref();
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function closeBrowserBounded(browser, ms = 10000) {
	if (!browser) return;
	await settleWithin(browser.close(), ms, () => {
		try {
			browser.process()?.kill('SIGKILL');
		} catch {}
	});
}

async function allocatePort() {
	const socket = createServer();
	await new Promise((r) => socket.listen(0, '127.0.0.1', r));
	const port = socket.address().port;
	await new Promise((r) => socket.close(r));
	return port;
}

async function setupManagedWebFixture(prefix) {
	const root = await fsp.realpath(await fsp.mkdtemp(join(tmpdir(), prefix)));
	const app = join(root, 'app');
	await copySource(resolve('.'), app);
	await fsp.symlink(resolve('node_modules'), join(app, 'node_modules'), 'dir');
	await fsp.cp(resolve('build'), join(app, 'build'), { recursive: true });
	const setup = spawnSync(
		process.execPath,
		[
			join(app, 'scripts/setup.mjs'),
			'--managed',
			'--root',
			root,
			'--skip-dependencies',
			'--skip-build',
			'--skip-pdf',
			'--json'
		],
		{
			cwd: app,
			env: {
				...process.env,
				SATURDAY_PROJECT_ROOT: app,
				SATURDAY_INSTALLATION_PATH: '',
				SATURDAY_DB_PATH: '',
				SATURDAY_FILES_PATH: '',
				SATURDAY_EXTENSION_STATE_PATH: '',
				SATURDAY_EXTENSIONS_PATH: ''
			},
			encoding: 'utf8'
		}
	);
	assert.equal(setup.status, 0, setup.stderr || setup.stdout);
	const descriptor = JSON.parse(setup.stdout).descriptor_path;
	const config = JSON.parse(await fsp.readFile(descriptor, 'utf8'));
	config.code_owned = true;
	config.code_fingerprint = await codeFingerprint(app);
	config.tracking_ref = 'main';
	config.build = { id: 'dev.111111111111', commit: '1'.repeat(40), dirty: false };
	await fsp.writeFile(descriptor, JSON.stringify(config, null, 2));
	return { root, app, descriptor, config };
}

async function launchWebProcess({ cwd, descriptor, port, token, fixturePath, extraEnv = {} }) {
	const base = `http://127.0.0.1:${port}`;
	const preload = pathToFileURL(resolve('tests/helpers/branch-fetch-fixture.mjs')).href;
	const env = {
		...process.env,
		PORT: String(port),
		SATURDAY_LOCAL_ORIGIN: base,
		SATURDAY_SERVER_TOKEN: token,
		SATURDAY_SERVER_GENERATION: randomUUID(),
		SATURDAY_RUNNING_ALLOW_LAN: 'false',
		BODY_SIZE_LIMIT: 'Infinity',
		SATURDAY_INSTALLATION_PATH: descriptor || '',
		SATURDAY_PROJECT_ROOT: cwd,
		...(fixturePath
			? {
					SATURDAY_TEST_BRANCH_FIXTURE: fixturePath,
					NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${preload}`.trim()
				}
			: {}),
		...extraEnv
	};
	if (descriptor) {
		for (const key of [
			'SATURDAY_DB_PATH',
			'SATURDAY_FILES_PATH',
			'SATURDAY_EXTENSION_STATE_PATH',
			'SATURDAY_EXTENSIONS_PATH'
		])
			delete env[key];
	}
	const child = spawn(process.execPath, [join(cwd, 'scripts/web.mjs')], {
		cwd,
		env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let logs = '';
	child.stdout.on('data', (c) => (logs += c));
	child.stderr.on('data', (c) => (logs += c));
	let ready = false;
	for (let i = 0; i < 100; i++) {
		try {
			const res = await fetch(`${base}/health`);
			if (res.ok) {
				ready = true;
				break;
			}
		} catch {}
		await new Promise((r) => setTimeout(r, 100));
	}
	const stop = async () => {
		if (child.exitCode === null && child.signalCode === null) {
			const exited = new Promise((r) => child.once('close', r));
			child.kill('SIGTERM');
			await settleWithin(exited, 5000, () => {
				if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
			});
			if (child.exitCode === null && child.signalCode === null) {
				await settleWithin(exited, 5000);
			}
		}
	};
	if (!ready) {
		await stop();
		assert.fail(`Web server failed to start:\n${logs}`);
	}
	return { base, child, stop, logs: () => logs };
}

function extractCookies(response) {
	const setCookies = response.headers.getSetCookie?.() ?? [];
	return setCookies.map((c) => c.split(';')[0]).join('; ');
}

test('branch switching HTTP authorization, export marker across restart, guards, and real exported ZIP round-trip restore', async () => {
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	const shaMain = '1'.repeat(40);
	const shaDev = '2'.repeat(40);
	const shaDevMoved = '3'.repeat(40);
	const shaIncompat = '4'.repeat(40);
	const managed = await setupManagedWebFixture('saturday-web-branch-http-');
	const restoreTarget = await setupManagedWebFixture('saturday-web-branch-restore-');
	const sourceScratch = await fsp.realpath(
		await fsp.mkdtemp(join(tmpdir(), 'saturday-web-branch-source-'))
	);
	const fixturePath = join(managed.root, 'branches.json');
	const makePkg = (dbVer = 1) => ({
		...pkg,
		saturday: {
			...pkg.saturday,
			storage: {
				database: { ...pkg.saturday.storage.database, currentVersion: dbVer },
				manifest: { ...pkg.saturday.storage.manifest }
			}
		}
	});
	const fixtureState = {
		branches: [
			{ name: 'main', commit: { sha: shaMain } },
			{ name: 'dev', commit: { sha: shaDev } },
			{ name: 'feat/ignored', commit: { sha: shaDevMoved } }
		],
		refs: { main: shaMain, dev: shaDev },
		commits: {
			[shaMain]: { package: makePkg(1) },
			[shaDev]: { package: makePkg(1) },
			[shaDevMoved]: { package: makePkg(1) },
			[shaIncompat]: { package: makePkg(2) }
		}
	};
	await fsp.writeFile(fixturePath, JSON.stringify(fixtureState));

	const token = randomBytes(32).toString('hex');
	const port = await allocatePort();
	let server = await launchWebProcess({
		cwd: managed.app,
		descriptor: managed.descriptor,
		port,
		token,
		fixturePath
	});
	let sourceServer, restoreServer;
	try {
		const initial = await fetch(`${server.base}/settings`);
		assert.equal(initial.status, 200);
		const cookie = extractCookies(initial);
		assert.ok(cookie.includes('saturday-control-'), 'control cookie issued on loopback GET');
		const html = await initial.text();
		assert.ok(html.includes('Advanced'));
		assert.ok(html.includes('Move installation to branch'));

		const postAction = async (
			action,
			fields = {},
			{ origin = server.base, sendCookie = cookie } = {}
		) => {
			const body = new FormData();
			for (const [k, v] of Object.entries(fields)) body.set(k, v);
			const headers = {
				accept: 'application/json',
				'x-sveltekit-action': 'true',
				...(origin ? { origin } : {}),
				...(sendCookie ? { cookie: sendCookie } : {})
			};
			const res = await fetch(`${server.base}/settings?/${action}`, {
				method: 'POST',
				headers,
				body
			});
			const json = await res.json();
			return { httpStatus: res.status, ...json, data: json.data ? parse(json.data) : null };
		};

		// 1. Seed populated job, document, and Profile designation via HTTP so the exported ZIP has real data.
		const createdJob = await fetch(`${server.base}/jobs/new`, {
			method: 'POST',
			headers: {
				origin: server.base,
				cookie,
				accept: 'application/json',
				'x-sveltekit-action': 'true'
			},
			body: new URLSearchParams({ job_title: 'Roundtrip Engineer', company_name: 'ZipCorp' })
		});
		assert.equal((await createdJob.json()).type, 'redirect');
		const docCatalog = await (await fetch(`${server.base}/api/documents`)).json();
		const roundtripCvContent = `# Roundtrip CV\nReal exported bytes.\n\n${randomBytes(180 * 1024).toString('base64')}`;
		const createdDoc = await fetch(`${server.base}/documents/new?/save`, {
			method: 'POST',
			headers: {
				origin: server.base,
				cookie,
				accept: 'application/json',
				'x-sveltekit-action': 'true'
			},
			body: new URLSearchParams({
				filename: 'roundtrip-cv',
				content: roundtripCvContent,
				designation: 'master_cv',
				catalog_token: docCatalog.catalog_token
			})
		});
		assert.equal((await createdDoc.json()).type, 'redirect');

		// 2. Every new action rejects foreign Origin and missing/invalid control cookie with 403.
		for (const action of [
			'branches',
			'branchCompatibility',
			'backupForSwitch',
			'switchExportStatus',
			'switchBranch'
		]) {
			const badOrigin = await postAction(
				action,
				{ ref: 'dev' },
				{ origin: 'https://evil.example' }
			);
			assert.equal(badOrigin.httpStatus, 403, `${action} rejects foreign origin`);
			const noCookie = await postAction(action, { ref: 'dev' }, { sendCookie: '' });
			assert.equal(noCookie.status, 403, `${action} rejects missing control cookie`);
		}

		// 3. Source-mode server refuses forged branch mutations and shows explanatory line with no dropdown.
		const sourcePort = await allocatePort();
		const sourceToken = randomBytes(32).toString('hex');
		const sourceEnv = {
			SATURDAY_DB_PATH: join(sourceScratch, 'source.sqlite'),
			SATURDAY_FILES_PATH: join(sourceScratch, 'files'),
			SATURDAY_EXTENSION_STATE_PATH: join(sourceScratch, 'ext-state'),
			SATURDAY_EXTENSIONS_PATH: join(sourceScratch, 'ext-code')
		};
		const sourceSetup = spawnSync(
			process.execPath,
			['scripts/setup.mjs', '--skip-dependencies', '--skip-build', '--skip-pdf', '--json'],
			{
				cwd: resolve('.'),
				env: { ...process.env, SATURDAY_INSTALLATION_PATH: '', ...sourceEnv },
				encoding: 'utf8'
			}
		);
		assert.equal(sourceSetup.status, 0, sourceSetup.stderr || sourceSetup.stdout);
		sourceServer = await launchWebProcess({
			cwd: resolve('.'),
			descriptor: JSON.parse(sourceSetup.stdout).descriptor_path,
			port: sourcePort,
			token: sourceToken
		});
		const sourcePage = await fetch(`${sourceServer.base}/settings`);
		const sourceCookie = extractCookies(sourcePage);
		const sourceHtml = await sourcePage.text();
		assert.ok(
			sourceHtml.includes(
				'Branch switching is for installed copies; in a source checkout, use git.'
			)
		);
		assert.equal(sourceHtml.includes('id="branch_switch_ref"'), false);
		const forgedSource = await fetch(`${sourceServer.base}/settings?/branches`, {
			method: 'POST',
			headers: {
				origin: sourceServer.base,
				cookie: sourceCookie,
				accept: 'application/json',
				'x-sveltekit-action': 'true'
			},
			body: new FormData()
		});
		const forgedSourceJson = await forgedSource.json();
		assert.equal(forgedSourceJson.status, 409);
		assert.equal(parse(forgedSourceJson.data).installationCode, 'BRANCH_MODE');
		await sourceServer.stop();
		sourceServer = null;

		// 4. Managed branches listing filters to main & dev.
		const listed = await postAction('branches');
		assert.equal(listed.type, 'success');
		assert.deepEqual(
			listed.data.branches.branches.map((b) => b.ref),
			['main', 'dev']
		);

		// 5. Missing ref returns 409 BRANCH_MISSING.
		await fsp.writeFile(fixturePath, JSON.stringify({ ...fixtureState, refs: { main: shaMain } }));
		const missingRef = await postAction('branchCompatibility', { ref: 'dev' });
		assert.equal(missingRef.status, 409);
		assert.equal(missingRef.data.installationCode, 'BRANCH_MISSING');
		await fsp.writeFile(fixturePath, JSON.stringify(fixtureState));

		// 6. Review dev -> compatible; direct ordinary update bypass fails with CHECK_PURPOSE.
		const reviewed = await postAction('branchCompatibility', { ref: 'dev' });
		assert.equal(reviewed.type, 'success');
		const check = reviewed.data.branchReview;
		assert.equal(check.compatibility.verdict, 'compatible');
		const bypass = await postAction('installationOperation', {
			operation: 'update',
			check_id: check.id,
			confirm: 'true'
		});
		assert.equal(bypass.type, 'failure');
		assert.equal(bypass.status, 409);

		// 7. Create switch export; verify unauthorized/wrong-contents GETs fail; ordinary GET does not complete receipt.
		const backupRes = await postAction('backupForSwitch', { check_id: check.id });
		assert.equal(backupRes.type, 'success');
		const pendingExport = backupRes.data.switchExport;
		const downloadUrl = backupRes.data.downloadUrl;
		assert.equal(pendingExport.status, 'pending');
		assert.ok(downloadUrl.includes(`contents=all&switch_export=${pendingExport.id}`));

		// Ordinary download (without switch_export) must NOT complete the switch export marker.
		const ordinaryZip = await fetch(
			`${server.base}/settings/backups/${pendingExport.backup_id}?contents=all`,
			{ headers: { cookie } }
		);
		assert.equal(ordinaryZip.status, 200);
		await ordinaryZip.arrayBuffer();
		const stillPending = await postAction('switchExportStatus', { export_id: pendingExport.id });
		assert.equal(stillPending.data.switchExport.status, 'pending');

		// Cross-site / same-site / unauthorized / database-only switch export GETs must be refused.
		for (const badSite of ['cross-site', 'same-site', 'evil']) {
			assert.equal(
				(
					await fetch(`${server.base}${downloadUrl}`, {
						headers: { cookie, 'sec-fetch-site': badSite }
					})
				).status,
				403,
				`sec-fetch-site: ${badSite} must be refused`
			);
		}
		assert.equal((await fetch(`${server.base}${downloadUrl}`)).status, 403);
		assert.equal(
			(
				await fetch(
					`${server.base}/settings/backups/${pendingExport.backup_id}?contents=database&switch_export=${pendingExport.id}`,
					{ headers: { cookie } }
				)
			).status,
			409
		);

		// 7b. Aborting the switch ZIP mid-stream must NOT complete the receipt and must block switchBranch with EXPORT_REQUIRED.
		const abortAc = new AbortController();
		const abortRes = await fetch(`${server.base}${downloadUrl}`, {
			headers: { cookie, 'sec-fetch-site': 'same-origin' },
			signal: abortAc.signal
		});
		assert.equal(abortRes.status, 200);
		const abortReader = abortRes.body.getReader();
		const firstChunk = await abortReader.read();
		assert.equal(firstChunk.done, false, 'ZIP stream should yield partial bytes before EOF');
		assert.ok(firstChunk.value.byteLength > 0);
		abortAc.abort();
		await abortReader.cancel().catch(() => {});
		let statusAfterAbort = null;
		for (let i = 0; i < 20; i++) {
			const polled = await postAction('switchExportStatus', { export_id: pendingExport.id });
			statusAfterAbort = polled.data?.switchExport?.status ?? null;
			if (statusAfterAbort !== 'pending') break;
			await new Promise((r) => setTimeout(r, 50));
		}
		assert.notEqual(
			statusAfterAbort,
			'complete',
			'aborted download must never mark export receipt complete'
		);
		const switchAfterAbort = await postAction('switchBranch', {
			ref: 'dev',
			commit: shaDev,
			check_id: check.id,
			export_id: pendingExport.id,
			backup_id: pendingExport.backup_id,
			confirm: 'true'
		});
		assert.equal(switchAfterAbort.status, 409);
		assert.equal(switchAfterAbort.data.installationCode, 'EXPORT_REQUIRED');

		// Re-issue a fresh pending switch export for the full verified download step below.
		const freshBackupRes = await postAction('backupForSwitch', { check_id: check.id });
		assert.equal(freshBackupRes.type, 'success');
		const freshExport = freshBackupRes.data.switchExport;
		const freshDownloadUrl = freshBackupRes.data.downloadUrl;
		assert.equal(freshExport.status, 'pending');

		// 8. Real GET on downloadUrl streams verified ZIP and completes receipt with exact bytes & sha256.
		const zipRes = await fetch(`${server.base}${freshDownloadUrl}`, {
			headers: { cookie, 'sec-fetch-site': 'same-origin' }
		});
		assert.equal(zipRes.status, 200);
		assert.equal(zipRes.headers.get('content-type'), 'application/zip');
		assert.equal(zipRes.headers.get('cache-control'), 'no-store');
		assert.equal(zipRes.headers.get('x-content-type-options'), 'nosniff');
		const zipBytes = Buffer.from(await zipRes.arrayBuffer());
		assert.equal(zipBytes.subarray(0, 2).toString(), 'PK');
		const expectedSha256 = createHash('sha256').update(zipBytes).digest('hex');

		const statusRes = await postAction('switchExportStatus', { export_id: freshExport.id });
		assert.equal(statusRes.type, 'success');
		assert.equal(statusRes.data.switchExport.status, 'complete');
		assert.equal(statusRes.data.switchExport.bytes, zipBytes.length);
		assert.equal(statusRes.data.switchExport.sha256, expectedSha256);

		// 8b. M3 + F1 + F7: hash mismatch, invalid/mismatched download_bytes, missing proof, or wrong
		// export_proof marker all refuse with 409 EXPORT_REQUIRED and leave receipt intact.
		const badHashSwitch = await postAction('switchBranch', {
			ref: 'dev',
			commit: shaDev,
			check_id: check.id,
			export_id: freshExport.id,
			backup_id: freshExport.backup_id,
			download_sha256: '0'.repeat(64),
			download_bytes: String(zipBytes.length),
			confirm: 'true'
		});
		assert.equal(badHashSwitch.status, 409);
		assert.equal(badHashSwitch.data.installationCode, 'EXPORT_REQUIRED');
		assert.equal(
			badHashSwitch.data.installationError,
			'The downloaded backup does not match the one Saturday prepared. Download it again.'
		);
		for (const badBytes of [String(zipBytes.length + 1), '0', '-5', 'abc', '1.5', '']) {
			const badBytesSwitch = await postAction('switchBranch', {
				ref: 'dev',
				commit: shaDev,
				check_id: check.id,
				export_id: freshExport.id,
				backup_id: freshExport.backup_id,
				download_sha256: expectedSha256,
				download_bytes: badBytes,
				confirm: 'true'
			});
			assert.equal(
				badBytesSwitch.status,
				409,
				`download_bytes=${JSON.stringify(badBytes)} refused`
			);
			assert.equal(badBytesSwitch.data.installationCode, 'EXPORT_REQUIRED');
		}
		for (const missingProof of [
			{},
			{ export_proof: 'received-bytes' },
			{ download_bytes: String(zipBytes.length) },
			{ download_bytes: String(zipBytes.length), export_proof: 'server-eof' }
		]) {
			const refused = await postAction('switchBranch', {
				ref: 'dev',
				commit: shaDev,
				check_id: check.id,
				export_id: freshExport.id,
				backup_id: freshExport.backup_id,
				...missingProof,
				confirm: 'true'
			});
			assert.equal(refused.status, 409);
			assert.equal(refused.data.installationCode, 'EXPORT_REQUIRED');
		}
		const stillCompleteAfterMismatch = await postAction('switchExportStatus', {
			export_id: freshExport.id
		});
		assert.equal(
			stillCompleteAfterMismatch.data.switchExport.status,
			'complete',
			'mismatched switchBranch leaves export receipt untouched'
		);

		// 9. Restart server within TTL: receipt survives restart and is still loaded.
		await server.stop();
		const tokenAfterRestart = randomBytes(32).toString('hex');
		server = await launchWebProcess({
			cwd: managed.app,
			descriptor: managed.descriptor,
			port,
			token: tokenAfterRestart,
			fixturePath
		});
		const reloadedSettings = await fetch(`${server.base}/settings`);
		const cookie2 = extractCookies(reloadedSettings);
		const reloadedHtml = await reloadedSettings.text();
		assert.ok(reloadedHtml.includes(statusRes.data.switchExport.filename));
		const afterRestartStatus = await postAction(
			'switchExportStatus',
			{ export_id: freshExport.id },
			{ sendCookie: cookie2 }
		);
		assert.equal(afterRestartStatus.data.switchExport.status, 'complete');

		// 10. Upstream branch head moved after review -> 409 BRANCH_CHANGED.
		await fsp.writeFile(
			fixturePath,
			JSON.stringify({ ...fixtureState, refs: { main: shaMain, dev: shaDevMoved } })
		);
		const movedHead = await postAction(
			'switchBranch',
			{
				ref: 'dev',
				commit: shaDev,
				check_id: check.id,
				export_id: freshExport.id,
				backup_id: freshExport.backup_id,
				confirm: 'true'
			},
			{ sendCookie: cookie2 }
		);
		assert.equal(movedHead.status, 409);
		assert.equal(movedHead.data.installationCode, 'BRANCH_CHANGED');

		// 11. Incompatible branch refuses missing/wrong MOVE with 409 SWITCH_TYPED_CONFIRM.
		await fsp.writeFile(
			fixturePath,
			JSON.stringify({ ...fixtureState, refs: { main: shaMain, dev: shaIncompat } })
		);
		const incompatRev = await postAction(
			'branchCompatibility',
			{ ref: 'dev' },
			{ sendCookie: cookie2 }
		);
		assert.equal(incompatRev.data.branchReview.compatibility.verdict, 'candidate_newer');
		const incompatBackup = await postAction(
			'backupForSwitch',
			{ check_id: incompatRev.data.branchReview.id },
			{ sendCookie: cookie2 }
		);
		const incompatDownload = await fetch(`${server.base}${incompatBackup.data.downloadUrl}`, {
			headers: { cookie: cookie2 }
		});
		assert.equal(incompatDownload.status, 200);
		await incompatDownload.arrayBuffer();
		const badMove = await postAction(
			'switchBranch',
			{
				ref: 'dev',
				commit: shaIncompat,
				check_id: incompatRev.data.branchReview.id,
				export_id: incompatBackup.data.switchExport.id,
				backup_id: incompatBackup.data.switchExport.backup_id,
				confirm: 'true',
				confirmation: 'move'
			},
			{ sendCookie: cookie2 }
		);
		assert.equal(badMove.status, 409);
		assert.equal(badMove.data.installationCode, 'SWITCH_TYPED_CONFIRM');

		// 12. Real exported ZIP round-trip restore into a fresh compatible disposable workspace!
		const restorePort = await allocatePort();
		const restoreToken = randomBytes(32).toString('hex');
		restoreServer = await launchWebProcess({
			cwd: restoreTarget.app,
			descriptor: restoreTarget.descriptor,
			port: restorePort,
			token: restoreToken
		});
		const restoreInit = await fetch(`${restoreServer.base}/settings`);
		const restoreCookie = extractCookies(restoreInit);
		const importRes = await fetch(`${restoreServer.base}/settings/files/import?bundle=true`, {
			method: 'POST',
			headers: {
				origin: restoreServer.base,
				cookie: restoreCookie,
				'content-type': 'application/zip'
			},
			body: zipBytes
		});
		assert.equal(importRes.status, 200);
		const imported = await importRes.json();
		const prepBody = new FormData();
		prepBody.set('file_backup_id', imported.file_backup_id);
		const prepRes = await fetch(`${restoreServer.base}/settings?/filePairPrepare`, {
			method: 'POST',
			headers: {
				origin: restoreServer.base,
				cookie: restoreCookie,
				accept: 'application/json',
				'x-sveltekit-action': 'true'
			},
			body: prepBody
		});
		const prepJson = await prepRes.json();
		assert.equal(prepJson.type, 'success');
		const pairPreview = parse(prepJson.data).filePairPreview;
		assert.equal(pairPreview.database.incoming.job_count, 1);
		assert.equal(pairPreview.files.incoming_count, 1);

		const confirmBody = new FormData();
		confirmBody.set('restore_id', pairPreview.restore_id);
		confirmBody.set('confirm', 'true');
		const restoreRes = await fetch(`${restoreServer.base}/settings?/filePairRestore`, {
			method: 'POST',
			headers: {
				origin: restoreServer.base,
				cookie: restoreCookie,
				accept: 'application/json',
				'x-sveltekit-action': 'true'
			},
			body: confirmBody
		});
		assert.equal((await restoreRes.json()).type, 'success');

		// Verify restored job, document bytes, and Profile designation in the fresh workspace.
		const jobsHtml = await (await fetch(`${restoreServer.base}/jobs`)).text();
		assert.ok(jobsHtml.includes('Roundtrip Engineer'));
		assert.ok(jobsHtml.includes('ZipCorp'));
		const docs = await (await fetch(`${restoreServer.base}/api/documents`)).json();
		const cvDoc = docs.documents.find((d) => d.filename === 'roundtrip-cv.md');
		assert.ok(cvDoc, 'restored document exists');
		assert.equal(cvDoc.designation, 'master_cv', 'Profile designation restored');
		assert.equal(
			await (await fetch(`${restoreServer.base}/api/files/${cvDoc.id}`)).text(),
			roundtripCvContent
		);
	} finally {
		await server?.stop();
		await sourceServer?.stop();
		await restoreServer?.stop();
		await fsp.rm(managed.root, { recursive: true, force: true });
		await fsp.rm(restoreTarget.root, { recursive: true, force: true });
		await fsp.rm(sourceScratch, { recursive: true, force: true });
	}
});

test('Chrome journey: Settings Updates Advanced disclosure, warnings, download gating, MOVE confirmation, unknown commit, no-JS, and responsive layout', async () => {
	assert.ok(
		existsSync(await puppeteer.executablePath()),
		'Managed Chrome is required; a skipped browser journey is not a pass.'
	);
	const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
	const shaMain = 'a'.repeat(40);
	const shaDev = 'b'.repeat(40);
	const shaIncompat = 'c'.repeat(40);
	const managed = await setupManagedWebFixture('saturday-web-branch-chrome-');
	const evidenceDir = join(managed.root, 'evidence');
	await fsp.mkdir(evidenceDir, { recursive: true });
	const fixturePath = join(managed.root, 'branches.json');
	const makePkg = (dbVer = 1) => ({
		...pkg,
		saturday: {
			...pkg.saturday,
			storage: {
				database: { ...pkg.saturday.storage.database, currentVersion: dbVer },
				manifest: { ...pkg.saturday.storage.manifest }
			}
		}
	});
	const writeFixture = (obj) => fsp.writeFile(fixturePath, JSON.stringify(obj));
	await writeFixture({
		branches: [
			{ name: 'main', commit: { sha: shaMain } },
			{ name: 'dev', commit: { sha: shaDev } }
		],
		refs: { main: shaMain, dev: shaDev },
		commits: {
			[shaMain]: { package: makePkg(1) },
			[shaDev]: { package: makePkg(1) },
			[shaIncompat]: { package: makePkg(2) }
		}
	});

	// Start with unknown installed commit to verify unknown-commit ordinary card copy first.
	const desc = JSON.parse(await fsp.readFile(managed.descriptor, 'utf8'));
	desc.build = { id: 'local.0123456789ab', commit: null, dirty: null };
	desc.tracking_ref = 'main';
	await fsp.writeFile(managed.descriptor, JSON.stringify(desc, null, 2));

	const port = await allocatePort();
	const token = randomBytes(32).toString('hex');
	let server = await launchWebProcess({
		cwd: managed.app,
		descriptor: managed.descriptor,
		port,
		token,
		fixturePath
	});
	let browser;
	let step = 'startup';
	const pageErrors = [];
	try {
		browser = await puppeteer.launch({ headless: true, protocolTimeout: 15000 });
		const browserSession = await browser.target().createCDPSession();
		await browserSession.send('Browser.setDownloadBehavior', {
			behavior: 'allow',
			downloadPath: evidenceDir,
			eventsEnabled: false
		});
		const page = await browser.newPage();
		page.setDefaultTimeout(12000);
		page.setDefaultNavigationTimeout(12000);
		page.on('pageerror', (e) => pageErrors.push(e.message));
		await page.setViewport({ width: 1280, height: 900 });
		let branchesFetches = 0;
		page.on('request', (req) => {
			if (req.url().includes('?/branches')) branchesFetches++;
		});

		step = 'initial load';
		await page.goto(`${server.base}/settings#updates`, { waitUntil: 'networkidle0' });

		// 1. Unknown commit check: neither "You're up to date" nor "Update Saturday".
		step = '1. unknown commit check';
		await Promise.all([
			page.waitForResponse((r) => r.url().includes('?/checkUpdates')),
			page.locator('#updates button::-p-text(Check for updates)').click()
		]);
		await page.waitForFunction(() =>
			document
				.querySelector('#updates')
				?.textContent?.includes('Cannot compare this build with main')
		);
		const unknownText = await page.$eval('#updates', (e) => e.textContent);
		assert.ok(unknownText.includes('The installed commit is unknown.'));
		assert.equal(unknownText.includes('You’re up to date'), false);
		assert.equal(await page.$('#updates button::-p-text(Update Saturday)'), null);

		// 2. Switch descriptor to tracking_ref 'dev' with known matching commit -> "You’re up to date on dev".
		step = '2. dev up-to-date check';
		desc.tracking_ref = 'dev';
		desc.build = { id: `dev.${shaDev.slice(0, 12)}`, commit: shaDev, dirty: false };
		await fsp.writeFile(managed.descriptor, JSON.stringify(desc, null, 2));
		await Promise.all([
			page.waitForResponse((r) => r.url().includes('?/checkUpdates')),
			page.locator('#updates button::-p-text(Check for updates)').click()
		]);
		await page.waitForFunction(() =>
			document.querySelector('#updates')?.textContent?.includes('You’re up to date on dev')
		);

		// Restore tracking_ref to main (commit shaMain) and reload for Advanced disclosure journey.
		step = '3. reload for Advanced disclosure';
		desc.tracking_ref = 'main';
		desc.build = { id: `dev.${shaMain.slice(0, 12)}`, commit: shaMain, dirty: false };
		await fsp.writeFile(managed.descriptor, JSON.stringify(desc, null, 2));
		await page.reload({ waitUntil: 'networkidle0' });

		// 3. Advanced disclosure is closed on initial load; zero ?/branches requests before opening.
		assert.equal(await page.$eval('#updates details.disclosure-quiet', (el) => el.open), false);
		assert.equal(branchesFetches, 0);

		// 4. Open Advanced -> loads branches once; marks main (current).
		step = '4. open Advanced';
		await Promise.all([
			page.waitForResponse((r) => r.url().includes('?/branches')),
			page.click('#updates details.disclosure-quiet summary')
		]);
		await page.waitForFunction(() =>
			[...document.querySelectorAll('#branch_switch_ref option')].some((o) =>
				o.textContent?.includes('main (current)')
			)
		);
		assert.equal(branchesFetches, 1);

		// Close and reopen -> cached in component state, no second ?/branches request.
		await page.click('#updates details.disclosure-quiet summary');
		await page.click('#updates details.disclosure-quiet summary');
		await new Promise((r) => setTimeout(r, 150));
		assert.equal(branchesFetches, 1);

		// 5. Select dev -> shows compatibility line + main warning; Move stays disabled until download completes.
		step = '5. select dev';
		await Promise.all([
			page.waitForResponse((r) => r.url().includes('?/branchCompatibility')),
			page.select('#branch_switch_ref', 'dev')
		]);
		await page.waitForFunction(() =>
			document.querySelector('#updates')?.textContent?.includes('Moving clears this installation')
		);
		const reviewText = await page.$eval('#updates', (e) => e.textContent.replace(/\s+/g, ' '));
		assert.ok(
			reviewText.includes(
				'This branch supports your current database and file formats. Moving still clears all installation data.'
			)
		);
		assert.ok(reviewText.includes(`main@${shaMain.slice(0, 12)}`));
		assert.ok(reviewText.includes(`dev@${shaDev.slice(0, 12)}`));
		assert.equal(
			await page.$eval(
				'#updates button[type="button"].text-destructive, #updates button[data-variant="destructive"]',
				(b) => b.disabled
			),
			true,
			'Move button is disabled before backup download completes'
		);

		// 6. Click Download backup -> streams ZIP, enables Move.
		step = '6. download backup';
		await Promise.all([
			page.waitForResponse((r) => r.url().includes('switch_export=')),
			page.locator('#updates button::-p-text(Download backup)').click()
		]);
		await page.waitForFunction(() =>
			document.querySelector('#updates')?.textContent?.includes('Backup streamed:')
		);
		assert.equal(
			await page.$eval('#updates button[data-variant="destructive"]', (b) => b.disabled),
			false,
			'Move button enables after verified ZIP stream completes'
		);
		const clientProof = await page.evaluate(() => ({
			sha: document.querySelector('#branch-switch input[name="download_sha256"]')?.value ?? null,
			bytes: document.querySelector('#branch-switch input[name="download_bytes"]')?.value ?? null
		}));
		assert.match(
			clientProof.sha ?? '',
			/^[a-f0-9]{64}$/,
			'client computes lowercase SHA-256 of blob'
		);
		assert.match(
			clientProof.bytes ?? '',
			/^[1-9]\d*$/,
			'client records positive byte length of blob'
		);

		// 7. Reload page -> restored receipt has no client digest, so Move stays disabled and prompts
		// "Download again to verify"; clicking it re-downloads and re-enables Move with a fresh digest.
		step = '7. reload requires re-verification';
		await page.reload({ waitUntil: 'networkidle0' });
		await page.click('#updates details.disclosure-quiet summary');
		await page.waitForFunction(() =>
			document.querySelector('#updates')?.textContent?.includes('Download again to verify')
		);
		assert.equal(
			await page.$eval('#updates button[data-variant="destructive"]', (b) => b.disabled),
			true,
			'Move button stays disabled after reload until browser verifies downloaded bytes again'
		);
		await Promise.all([
			page.waitForResponse((r) => r.url().includes('switch_export=')),
			page.locator('#updates button::-p-text(Download again to verify)').click()
		]);
		await page.waitForFunction(() =>
			document.querySelector('#updates')?.textContent?.includes('Backup streamed:')
		);
		assert.equal(
			await page.$eval('#updates button[data-variant="destructive"]', (b) => b.disabled),
			false,
			'Move button re-enables after re-downloading and hashing the ZIP'
		);
		const reVerifiedProof = await page.evaluate(() => ({
			sha: document.querySelector('#branch-switch input[name="download_sha256"]')?.value ?? null,
			bytes: document.querySelector('#branch-switch input[name="download_bytes"]')?.value ?? null
		}));
		assert.match(reVerifiedProof.sha ?? '', /^[a-f0-9]{64}$/);
		assert.match(reVerifiedProof.bytes ?? '', /^[1-9]\d*$/);

		// 8. Click Move to this branch -> ConfirmDialog opens, Cancel closes and returns focus to Move.
		step = '8. confirm dialog cancel';
		const beforeDescriptor = await fsp.readFile(managed.descriptor, 'utf8');
		await page.locator('#updates button::-p-text(Move to this branch)').click();
		await page.waitForSelector('[role="dialog"]');
		const dialogText = await page.$eval('[role="dialog"]', (e) =>
			e.textContent.replace(/\s+/g, ' ')
		);
		assert.ok(dialogText.includes(`Move to dev@${shaDev.slice(0, 12)}?`));
		assert.ok(dialogText.includes(`main@${shaMain.slice(0, 12)}`));
		assert.ok(dialogText.includes('Password and LAN settings must be set again.'));
		await page.locator('[role="dialog"] button::-p-text(Cancel)').click();
		await page.waitForSelector('[role="dialog"]', { hidden: true });
		assert.equal(await fsp.readFile(managed.descriptor, 'utf8'), beforeDescriptor);
		assert.ok(
			await page.evaluate(() =>
				document.activeElement?.textContent?.includes('Move to this branch')
			),
			'Cancel restores focus to Move to this branch'
		);

		// 9. Incompatible branch -> requires literal MOVE in ConfirmDialog.
		step = '9. incompatible branch MOVE';
		await writeFixture({
			branches: [
				{ name: 'main', commit: { sha: shaMain } },
				{ name: 'dev', commit: { sha: shaIncompat } }
			],
			refs: { main: shaMain, dev: shaIncompat },
			commits: {
				[shaMain]: { package: makePkg(1) },
				[shaIncompat]: { package: makePkg(2) }
			}
		});
		// Change selection away then back to dev -> invalidates old receipt in UI and fetches new incompatible verdict.
		await page.select('#branch_switch_ref', 'main');
		await page.waitForFunction(() =>
			document
				.querySelector('#updates')
				?.textContent?.includes('This branch points to your installed commit.')
		);
		assert.equal(
			await page.$eval('#updates button[data-variant="destructive"]', (b) => b.disabled),
			true,
			'selection change invalidates previous receipt'
		);
		await Promise.all([
			page.waitForResponse((r) => r.url().includes('?/branchCompatibility')),
			page.select('#branch_switch_ref', 'dev')
		]);
		await page.waitForFunction(() =>
			document
				.querySelector('#updates')
				?.textContent?.includes('This branch uses newer data formats')
		);
		await Promise.all([
			page.waitForResponse((r) => r.url().includes('switch_export=')),
			page.locator('#updates button::-p-text(Download backup)').click()
		]);
		await page.waitForFunction(() =>
			document.querySelector('#updates')?.textContent?.includes('Backup streamed:')
		);
		await page.locator('#updates button::-p-text(Move to this branch)').click();
		await page.waitForSelector('[role="dialog"] #branch_switch_confirmation');
		const moveSubmitDisabled = () =>
			page.$eval('[role="dialog"] button[type="submit"][form="branch-switch"]', (b) => b.disabled);
		assert.equal(await moveSubmitDisabled(), true, 'empty confirmation disables Move');
		for (const bad of ['move', 'MOVE ']) {
			await page.$eval(
				'#branch_switch_confirmation',
				(el, val) => {
					el.value = val;
					el.dispatchEvent(new Event('input', { bubbles: true }));
				},
				bad
			);
			assert.equal(await moveSubmitDisabled(), true, `${JSON.stringify(bad)} disables Move`);
		}
		await page.$eval('#branch_switch_confirmation', (el) => {
			el.value = 'MOVE';
			el.dispatchEvent(new Event('input', { bubbles: true }));
		});
		assert.equal(await moveSubmitDisabled(), false, 'exact MOVE enables Move');

		// 10. Responsive widths (320, 640, 767, 768) + light/dark + 200% zoom with dialog open.
		step = '10. responsive widths and zoom';
		for (const scheme of ['light', 'dark']) {
			await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
			for (const width of [320, 640, 767, 768]) {
				await page.setViewport({ width, height: 844 });
				await new Promise((r) => setTimeout(r, 80));
				assert.ok(
					await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
					`${scheme} ${width}px must not overflow`
				);
				await page.screenshot({ path: join(evidenceDir, `branch-${scheme}-${width}.png`) });
			}
		}
		await page.setViewport({ width: 640, height: 450, deviceScaleFactor: 2 });
		await page.screenshot({ path: join(evidenceDir, 'branch-zoom-200.png') });
		await page.locator('[role="dialog"] button::-p-text(Cancel)').click();
		await page.waitForSelector('[role="dialog"]', { hidden: true });

		// 11. Missing branch + failed branch list fallback tests on a fresh page.
		step = '11. missing branch and fallback';
		await writeFixture({
			branches: [{ name: 'main', commit: { sha: shaMain } }],
			refs: { main: shaMain },
			commits: { [shaMain]: { package: makePkg(1) } }
		});
		const missingPage = await browser.newPage();
		missingPage.setDefaultTimeout(12000);
		missingPage.on('pageerror', (e) => pageErrors.push(e.message));
		await missingPage.goto(`${server.base}/settings#updates`, { waitUntil: 'networkidle0' });
		await Promise.all([
			missingPage.waitForResponse((r) => r.url().includes('?/branches')),
			missingPage.click('#updates details.disclosure-quiet summary')
		]);
		await missingPage.waitForFunction(() =>
			document.querySelector('#updates')?.textContent?.includes('Branch dev is missing on GitHub.')
		);
		assert.equal(
			await missingPage.$eval('#branch_switch_ref option[value="dev"]', (o) => o.disabled),
			true
		);
		await missingPage.close();

		await writeFixture({ fail_branches: true, refs: { main: shaMain }, commits: {} });
		const failListPage = await browser.newPage();
		failListPage.setDefaultTimeout(12000);
		failListPage.on('pageerror', (e) => pageErrors.push(e.message));
		await failListPage.goto(`${server.base}/settings#updates`, { waitUntil: 'networkidle0' });
		await Promise.all([
			failListPage.waitForResponse((r) => r.url().includes('?/branches')),
			failListPage.click('#updates details.disclosure-quiet summary')
		]);
		await failListPage.waitForFunction(() =>
			document.querySelector('#updates')?.textContent?.includes('Branches unavailable')
		);
		assert.equal(
			await failListPage.$eval('#branch_switch_ref option[value="dev"]', (o) => o.disabled),
			false,
			'failed list keeps allowlisted fallback options selectable'
		);
		await failListPage.close();

		// 12. No-JS flow renders Review branch button and explicit Move confirmation form when receipt exists.
		step = '12. no-JS flow';
		const noJs = await browser.newPage();
		noJs.setDefaultTimeout(12000);
		await noJs.setJavaScriptEnabled(false);
		await noJs.goto(`${server.base}/settings#updates`, { waitUntil: 'networkidle0' });
		const noJsHtml = await noJs.content();
		assert.ok(noJsHtml.includes('Review branch'));
		assert.ok(noJsHtml.includes('branch_switch_confirmation_noscript'));
		assert.ok(
			noJsHtml.includes('name="export_proof" value="server-eof"'),
			'no-JS confirmation form includes explicit export_proof=server-eof marker'
		);
		assert.equal(
			noJsHtml.includes('name="download_sha256"'),
			false,
			'no-JS confirmation form omits client download_sha256'
		);
		await noJs.close();

		assert.deepEqual(pageErrors, []);
	} catch (error) {
		throw new Error(`Chrome journey failed at step "${step}": ${error.message}`, { cause: error });
	} finally {
		await closeBrowserBounded(browser, 10000);
		await server?.stop();
		await fsp.rm(managed.root, { recursive: true, force: true });
	}
});
