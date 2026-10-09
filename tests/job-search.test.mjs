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
	dismissJob,
	reopenJob,
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
	addJobUpdate({ job_id: jobId, event_type: type, event_date: date });

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

test('current status uses milestone rank and recorded state; historical steps force all activity', () => {
	const reopened = job();
	update(reopened.id, 'interview_2', '2026-11-01');
	update(reopened.id, 'applied', '2026-09-01');
	dismissJob(reopened.id, '2026-12-01');
	reopenJob(reopened.id, '2026-08-01');
	const inactive = job();
	update(inactive.id, 'offer');
	const accepted = update(inactive.id, 'accepted', '2026-08-01');
	assert.deepEqual(ids({ status: ['interview_2'] }), [reopened.id]);
	assert.deepEqual(ids({ status: ['accepted'], view: 'all' }), [inactive.id]);
	assert.equal(searchJobs({ status: ['accepted'] }).total, 0);
	assert.deepEqual(ids({ view: 'active', step: ['offer', 'dismissed'], status: ['accepted'] }), [
		inactive.id
	]);
	assert.equal(searchJobs({ step: ['offer', 'dismissed'] }).total, 2);
	correctJobUpdate(accepted.id, { event_type: 'rejected' });
	assert.deepEqual(ids({ step: ['offer'], status: ['rejected'] }), [inactive.id]);
	const fresh = job();
	assert.deepEqual(ids({ status: ['new'] }), [fresh.id]);
	assert.deepEqual(ids({ view: 'inactive' }), [inactive.id]);
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
	withDatabase((db) => {
		const insert = db.prepare(
			'INSERT INTO jobs (id,job_title,company_name,is_active,created_via,created_at,updated_at) VALUES (?,?,?,1,?,?,?)'
		);
		const history = db.prepare(
			'INSERT INTO job_updates (id,job_id,event_type,event_date,created_via,created_at,updated_at) VALUES (?,?,?,?,?,?,?)'
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
			if (i >= 110)
				history.run(
					i + 1,
					id,
					'offer',
					'2026-10-01',
					'manual',
					'2026-10-01T00:00:00.000Z',
					'2026-10-01T00:00:00.000Z'
				);
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
	assert.equal(searchJobs({ status: ['offer'] }).total, 15);
	assert.equal(searchJobs({ status: ['offer'], limit: 5, page: 3 }).jobs[0].id, 121);
	assert.equal(listJobs().length, 100);
});

test('sorts put missing dates last and validation rejects malformed filter values', () => {
	const early = job({ follow_up_date: '2026-10-01', application_deadline: '2026-10-02' });
	const late = job({ follow_up_date: '2026-10-03', application_deadline: '2026-10-04' });
	const missing = job();
	for (const sort of ['follow_up', 'deadline'])
		assert.deepEqual(ids({ sort }), [early.id, late.id, missing.id]);
	for (const filters of [
		{ status: ['unknown'] },
		{ step: ['reopened'] },
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
		view: 'inactive',
		step: ['applied', 'applied'],
		work_arrangement: ['remote', 'hybrid'],
		score_min: 0,
		page: 3
	});
	assert.equal(filters.view, 'all');
	assert.deepEqual(filters.step, ['applied']);
	const url = new URL(searchUrl(filters, 3), 'http://localhost');
	assert.deepEqual(jobSearchSchema.parse(searchFromUrl(url.searchParams)), filters);
	const stepChip = filterChips(filters).find((chip) => chip.key === 'step:applied');
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
