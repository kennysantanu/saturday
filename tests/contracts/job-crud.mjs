import assert from 'node:assert/strict';

// Run the same observable contract against local operations and the Worker storage fixture.
export async function verifyJobCrud(application) {
	const job = await application.createJob({
		job_title: ' Engineer ',
		company_name: ' Example ',
		notes: 'Keep this',
		location: 'Paris',
		posting_url: '',
		is_starred: true,
		score: 99,
		score_comment: 'Forged'
	});
	assert(Number.isSafeInteger(job.id) && job.id > 0);
	assert.equal(job.title, 'Engineer');
	assert.equal(job.company, 'Example');
	assert.equal(job.postingUrl, null);
	assert.equal(job.score, null);
	assert.equal(job.createdVia, 'manual');
	assert.equal(job.isStarred, true);
	await assert.rejects(
		application.createJob({
			job_title: ' engineer ',
			company_name: ' EXAMPLE ',
			location: ' paris '
		}),
		{ code: 'possible_duplicate' }
	);
	const separate = await application.createJob({
		job_title: 'Engineer',
		company_name: 'Example',
		location: 'Paris',
		allow_duplicate: true
	});
	assert.notEqual(separate.id, job.id);
	assert.equal(separate.allow_duplicate, undefined);
	const edited = await application.editJob(job.id, { job_title: 'Senior Engineer' });
	assert.equal(edited.title, 'Senior Engineer');
	assert.equal(edited.notes, 'Keep this');
	assert.equal(edited.location, 'Paris');
	assert.equal(edited.currentStageId, job.currentStageId);
	assert.equal(edited.createdAt, job.createdAt);
	assert.equal((await application.editJob(job.id, { notes: null })).notes, null);
	assert.equal((await application.editJob(job.id, { location: ' ' })).location, null);
	const before = await application.getJob(job.id);
	await assert.rejects(
		application.editJob(job.id, { job_title: '', notes: 'Must not save' }),
		(error) => Boolean(error.fieldErrors?.job_title)
	);
	assert.deepEqual(await application.getJob(job.id), before);
	for (const id of ['01', '1e0', '9007199254740992'])
		await assert.rejects(application.getJob(id), (error) => Boolean(error.fieldErrors?.job_id));
	assert.equal(await application.getJob(Number.MAX_SAFE_INTEGER), null);
	return job.id;
}
