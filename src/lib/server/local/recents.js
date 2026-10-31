import { withDatabase, inTransaction } from '../database.js';
import { parseSchema, ServiceError } from '../../domain/validation.js';
import { recentViewSchema, navigationSettingsSchema } from '../../domain/recents.js';

function settings(db) {
	const row = db
		.prepare('SELECT recents_enabled,recent_limit FROM navigation_settings WHERE id=1')
		.get();
	return { enabled: Boolean(row.recents_enabled), limit: row.recent_limit };
}

export function getNavigationSettings() {
	return withDatabase(settings);
}

export function setNavigationSettings(input) {
	const values = parseSchema(navigationSettingsSchema, input);
	return withDatabase((db) =>
		inTransaction(db, () => {
			db.prepare('UPDATE navigation_settings SET recents_enabled=?,recent_limit=? WHERE id=1').run(
				Number(values.enabled),
				values.limit
			);
			return settings(db);
		})
	);
}

export function clearRecentViews() {
	return withDatabase((db) =>
		inTransaction(db, () => {
			db.exec('DELETE FROM recent_job_views; DELETE FROM recent_network_views;');
			return { cleared: true };
		})
	);
}

export function recordRecentView(input) {
	const values = parseSchema(recentViewSchema, input);
	return withDatabase((db) =>
		inTransaction(db, () => {
			if (
				db.prepare('SELECT dataset_id FROM app_metadata WHERE id=1').get().dataset_id !==
				values.dataset_id
			)
				throw new ServiceError('The workspace changed. Reload this record.', 'DATASET_MISMATCH');
			if (!settings(db).enabled) return { recorded: false };
			const job = values.kind === 'job';
			const owner = job ? 'jobs' : 'networks';
			const table = job ? 'recent_job_views' : 'recent_network_views';
			const key = job ? 'job_id' : 'network_id';
			if (!db.prepare(`SELECT id FROM ${owner} WHERE id=?`).get(values.id))
				throw new ServiceError('This record no longer exists.', 'not_found');
			// Monotonic ordering also handles rapid navigation and a host clock moving backwards.
			const last = db.prepare(`SELECT MAX(viewed_at) AS last FROM ${table}`).get().last ?? 0;
			const viewedAt = Math.max(Date.now(), last + 1);
			db.prepare(
				`INSERT INTO ${table}(${key},viewed_at) VALUES(?,?)
 ON CONFLICT(${key}) DO UPDATE SET viewed_at=excluded.viewed_at`
			).run(values.id, viewedAt);
			db.prepare(
				`DELETE FROM ${table} WHERE ${key} NOT IN
 (SELECT ${key} FROM ${table} ORDER BY viewed_at DESC,${key} DESC LIMIT 50)`
			).run();
			return { recorded: true };
		})
	);
}

export function listRecentViews() {
	return withDatabase((db) => {
		db.exec('BEGIN');
		const preferences = settings(db);
		return {
			settings: preferences,
			jobs: preferences.enabled
				? db
						.prepare(
							`SELECT j.id,j.job_title AS title,j.company_name AS subtitle
 FROM recent_job_views v JOIN jobs j ON j.id=v.job_id
 ORDER BY v.viewed_at DESC,j.id DESC LIMIT ?`
						)
						.all(preferences.limit)
				: [],
			people: preferences.enabled
				? db
						.prepare(
							`SELECT n.id,n.name AS title,n.organization AS subtitle
 FROM recent_network_views v JOIN networks n ON n.id=v.network_id
 ORDER BY v.viewed_at DESC,n.id DESC LIMIT ?`
						)
						.all(preferences.limit)
				: []
		};
	});
}
