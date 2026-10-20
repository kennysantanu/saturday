import { stageId } from './workflow-fixture.mjs';
import { jobSearchSchema } from '../src/lib/server/validation.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateDatabase, withDatabase } from '../src/lib/server/database.js';
import {
	createJob,
	searchJobs,
	listJobs,
	addJobUpdate,
	moveJobStage,
	correctJobUpdate,
	setJobScore,
	ValidationError
} from '../src/lib/server/services.js';
import { defaultJobFilters, searchUrl, searchFromUrl, filterChips } from '../src/lib/job-search.js';

const previous = process.env.SATURDAY_DB_PATH;
const previousFiles = process.env.SATURDAY_FILES_PATH;
let scratch;
beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), 'saturday-search-'));
	process.env.SATURDAY_DB_PATH = join(scratch, 'career.sqlite');
	process.env.SATURDAY_FILES_PATH = join(scratch, 'files');
	migrateDatabase();
});
afterEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	if (previous === undefined) delete process.env.SATURDAY_DB_PATH;
	else process.env.SATURDAY_DB_PATH = previous;
	if (previousFiles === undefined) delete process.env.SATURDAY_FILES_PATH;
	else process.env.SATURDAY_FILES_PATH = previousFiles;
});
const job = (fields = {}, origin = 'manual') =>
	createJob({ job_title: 'Engineer', company_name: 'Acme', ...fields }, origin);
const ids = (filters) => searchJobs(filters).jobs.map((job) => job.id);
const update = (jobId, type, date = '2026-10-01') =>
	addJobUpdate({ job_id: jobId, stage_id: stageId(type), event_date: date });

test('literal contains searches use AND, categories use OR, and missing values remain searchable', () => {
	const target = job({
		location: 'Seattle',
		source: 'Referral',
		work_arrangement: 'remote',
		employment_type: 'contract',
		is_starred: true
	});
	job({ company_name: 'Other', location: 'Seattle', work_arrangement: 'hybrid' });
	const missing = job({ company_name: 'Missing' }, 'mcp');
	assert.deepEqual(
		ids({
			title: 'engineer',
			company: 'ACME',
			location: 'seattle',
			source: 'refer',
			work_arrangement: ['hybrid', 'remote'],
			employment_type: ['contract'],
			starred: 'starred'
		}),
		[target.id]
	);
	assert.deepEqual(
		ids({ work_arrangement: ['unset'], employment_type: ['unset'], created_via: ['mcp'] }),
		[missing.id]
	);
	assert.equal(searchJobs({ work_arrangement: ['unset', 'remote'] }).total, 2);
	assert.equal(searchJobs({ starred: 'not_starred' }).total, 2);
	const special = job({ job_title: '100%_\\ Engineer' });
	job({ job_title: '100xx Engineer' });
	assert.deepEqual(ids({ title: '%_\\' }), [special.id]);
	assert.deepEqual(ids({ title: "' OR 1=1 --" }), []);
	assert.equal(listJobs({ query: 'Acme' }).length, 3);
	assert.equal(searchJobs({ query: 'Acme', title: '100' }).total, 2);
});

test('current placement is independent of historical milestones, including closed jobs and scheduled history', () => {
	const first = job();
	update(first.id, 'Interview', '2099-01-01');
	update(first.id, 'Applied');
	const second = job();
	moveJobStage(second.id, { stage_id: stageId('Accepted'), event_date: '2020-01-01' });
	assert.deepEqual(new Set(ids({ current_stage: [stageId('New')] })), new Set([first.id]));
	assert.deepEqual(ids({ current_stage: [stageId('Accepted')] }), [second.id]);
	assert.deepEqual(ids({ milestone_stage: [stageId('Interview')] }), [first.id]);
	assert.deepEqual(ids({ view: 'closed' }), [second.id]);
});

test('date presets and open inclusive ranges distinguish missing, overdue, today, and upcoming', () => {
	const now = new Date();
	const iso = (date) =>
		`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	const today = iso(now);
	const earlier = new Date(now);
	earlier.setDate(now.getDate() - 1);
	const later = new Date(now);
	later.setDate(now.getDate() + 1);
	const overdue = job({ follow_up_date: iso(earlier), application_deadline: iso(earlier) });
	const due = job({ follow_up_date: today, application_deadline: today });
	const upcoming = job({ follow_up_date: iso(later), application_deadline: iso(later) });
	const missing = job();
	for (const key of ['follow_up', 'deadline']) {
		assert.deepEqual(ids({ [key]: 'overdue' }), [overdue.id]);
		assert.deepEqual(ids({ [key]: 'today' }), [due.id]);
		assert.deepEqual(ids({ [key]: 'upcoming' }), [upcoming.id]);
		assert.deepEqual(ids({ [key]: 'unset' }), [missing.id]);
		assert.equal(searchJobs({ [key]: 'set' }).total, 3);
		assert.deepEqual(ids({ [key]: 'range', [`${key}_from`]: today, [`${key}_to`]: today }), [
			due.id
		]);
		assert.equal(searchJobs({ [key]: 'range', [`${key}_from`]: today }).total, 2);
		assert.equal(searchJobs({ [key]: 'range' }).total, 3);
	}
});

test('created and updated bounds use local calendar midnights including daylight saving transitions', () => {
	const oldTz = process.env.TZ;
	process.env.TZ = 'America/Los_Angeles';
	try {
		const start = new Date('2026-11-01T00:00:00').toISOString();
		const end = new Date('2026-11-02T00:00:00').toISOString();
		assert.equal((new Date(end) - new Date(start)) / 3600000, 25);
		const before = job(),
			first = job(),
			last = job(),
			after = job();
		withDatabase((db) => {
			const write = db.prepare('UPDATE jobs SET created_at = ?, updated_at = ? WHERE id = ?');
			for (const [id, value] of [
				[before.id, new Date(new Date(start).getTime() - 1).toISOString()],
				[first.id, start],
				[last.id, new Date(new Date(end).getTime() - 1).toISOString()],
				[after.id, end]
			])
				write.run(value, value, id);
		});
		for (const key of ['created', 'updated'])
			assert.deepEqual(
				new Set(ids({ [`${key}_from`]: '2026-11-01', [`${key}_to`]: '2026-11-01' })),
				new Set([first.id, last.id])
			);
	} finally {
		if (oldTz === undefined) delete process.env.TZ;
		else process.env.TZ = oldTz;
	}
});

test('scores include zero and decimals, have no fixed scale, and sort missing values last', () => {
	const zero = job(),
		high = job(),
		missing = job();
	setJobScore(zero.id, { score: 0, score_comment: null });
	setJobScore(high.id, { score: 250.5, score_comment: null });
	assert.deepEqual(ids({ score_min: 0, score_max: 0 }), [zero.id]);
	assert.deepEqual(ids({ score: 'unscored', score_min: 100 }), [missing.id]);
	assert.equal(searchJobs({ score: 'scored' }).total, 2);
	assert.deepEqual(ids({ sort: 'score' }), [high.id, zero.id, missing.id]);
});

test('pagination counts and status filtering work beyond 100 records and use stable ties', () => {
	const offerId = stageId('Offer');
	withDatabase((db) => {
		const insert = db.prepare(
			'INSERT INTO jobs (id,job_title,company_name,current_stage_id,created_via,created_at,updated_at) VALUES (?,?,?,1,?,?,?)'
		);
		const history = db.prepare(
			'INSERT INTO job_updates (id,job_id,stage_id,event_date,created_via,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
		);
		for (let i = 0; i < 125; i++) {
			const id = i + 1;
			insert.run(
				id,
				'Engineer',
				'Acme',
				'manual',
				'2026-10-01T00:00:00.000Z',
				'2026-10-01T00:00:00.000Z'
			);
			if (i >= 110) {
				db.prepare('UPDATE jobs SET current_stage_id=? WHERE id=?').run(offerId, id);
				history.run(
					i + 1,
					id,
					offerId,
					'2026-10-01',
					'manual',
					'2026-10-01T00:00:00.000Z',
					'2026-10-01T00:00:00.000Z'
				);
			}
		}
	});
	const pages = [1, 2, 3].map((page) => searchJobs({ page }));
	assert.deepEqual(
		pages.map((result) => result.jobs.length),
		[50, 50, 25]
	);
	assert.equal(pages[0].total, 125);
	assert.equal(new Set(pages.flatMap((result) => result.jobs.map((job) => job.id))).size, 125);
	assert.equal(searchJobs({ page: 999 }).page, 3);
	assert.equal(searchJobs({ current_stage: [offerId] }).total, 15);
	assert.equal(searchJobs({ current_stage: [offerId], limit: 5, page: 3 }).jobs[0].id, 121);
	assert.equal(listJobs().length, 100);
});

test('sorts put missing dates last and validation rejects malformed filter values', () => {
	const early = job({ follow_up_date: '2026-10-01', application_deadline: '2026-10-02' });
	const late = job({ follow_up_date: '2026-10-03', application_deadline: '2026-10-04' });
	const missing = job();
	for (const sort of ['follow_up', 'deadline'])
		assert.deepEqual(ids({ sort }), [early.id, late.id, missing.id]);
	for (const filters of [
		{ current_stage: ['unknown'] },
		{ milestone_stage: ['invalid'] },
		{ view: 'bad' },
		{ work_arrangement: ['invalid'] },
		{ created_via: ['remote'] },
		{ deadline: 'range', deadline_from: '2026-02-30' },
		{ follow_up: 'range', follow_up_from: '2026-11-01', follow_up_to: '2026-10-01' },
		{ created_from: '2026-11-01', created_to: '2026-10-01' },
		{ score_min: Infinity },
		{ score_min: 'abc' },
		{ score_min: 10, score_max: 0 },
		{ page: -1 },
		{ page: 1.5 },
		{ limit: 101 },
		{ sort: 'score;DROP TABLE jobs' }
	])
		assert.throws(() => searchJobs(filters), ValidationError);
});

test('URL state round trips, deduplicates categories, and chip removal preserves other filters and resets pages', () => {
	const filters = jobSearchSchema.parse({
		title: '  Engineer  ',
		company: 'Acme',
		view: 'closed',
		milestone_stage: [stageId('Applied'), stageId('Applied')],
		work_arrangement: ['remote', 'hybrid'],
		score_min: 0,
		page: 3
	});
	assert.equal(filters.view, 'all');
	assert.deepEqual(filters.milestone_stage, [stageId('Applied')]);
	const url = new URL(searchUrl(filters, 3), 'http://localhost');
	assert.deepEqual(jobSearchSchema.parse(searchFromUrl(url.searchParams)), filters);
	const stepChip = filterChips(filters).find(
		(chip) => chip.key === 'milestone_stage:' + stageId('Applied')
	);
	const removed = jobSearchSchema.parse(
		searchFromUrl(new URL(stepChip.href, 'http://localhost').searchParams)
	);
	assert.equal(removed.view, 'active');
	assert.equal(removed.page, 1);
	assert.equal(removed.company, 'Acme');
	assert.deepEqual(removed.work_arrangement, ['remote', 'hybrid']);
	assert.ok(filterChips(filters).some((chip) => chip.label === 'Minimum score: 0'));
	assert.deepEqual(jobSearchSchema.parse({}), defaultJobFilters);
	assert.equal(searchUrl(jobSearchSchema.parse({})), '/jobs');
});
