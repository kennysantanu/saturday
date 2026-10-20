import { withDatabase, inTransaction } from './database.js';
import { parseRecordId, ServiceError, ValidationError } from './validation.js';

const now = () => new Date().toISOString();
export const normalizeStageName = (name) => name.trim().toLowerCase();
export function startingStage(db) {
	const stage = db
		.prepare(
			'SELECT * FROM workflow_stages WHERE is_archived=0 AND is_closed=0 ORDER BY sort_order,id LIMIT 1'
		)
		.get();
	if (!stage) throw new ServiceError('Keep at least one available open stage.', 'invalid_workflow');
	return stage;
}
export function stageById(db, id, { available = false } = {}) {
	const stage = db
		.prepare('SELECT * FROM workflow_stages WHERE id=?')
		.get(parseRecordId(id, 'stage_id'));
	if (!stage) throw new ValidationError({ stage_id: 'Choose a saved workflow stage.' });
	if (available && stage.is_archived)
		throw new ValidationError({ stage_id: 'This stage has been archived. Choose another stage.' });
	return stage;
}
function named(db, name, except = null, archived = false) {
	if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
		throw new ValidationError({ name: 'Enter a stage name of 1–80 characters.' });
	const clean = name.trim();
	if (
		!archived &&
		db
			.prepare('SELECT id,name FROM workflow_stages WHERE is_archived=0')
			.all()
			.some(
				(row) => row.id !== except && normalizeStageName(row.name) === normalizeStageName(clean)
			)
	)
		throw new ValidationError({ name: 'An available stage already uses this name.' });
	return clean;
}
function flag(value) {
	if (typeof value !== 'boolean')
		throw new ValidationError({ is_closed: 'Choose whether this stage closes the job.' });
	return Number(value);
}
function normalizeOrder(db) {
	const rows = db
		.prepare('SELECT id FROM workflow_stages ORDER BY is_archived,is_closed,sort_order,id')
		.all();
	const save = db.prepare('UPDATE workflow_stages SET sort_order=? WHERE id=?');
	rows.forEach((row, index) => save.run(index, row.id));
}
function append(db, id) {
	db.prepare(
		'UPDATE workflow_stages SET sort_order=(SELECT COALESCE(MAX(sort_order),0)+1 FROM workflow_stages) WHERE id=?'
	).run(id);
}
function used(db, id) {
	return !!db
		.prepare(
			'SELECT 1 FROM jobs WHERE current_stage_id=? UNION ALL SELECT 1 FROM job_updates WHERE stage_id=? LIMIT 1'
		)
		.get(id, id);
}
export function readWorkflow(db) {
	const start = startingStage(db).id;
	const stages = db
		.prepare(
			`SELECT s.*, (SELECT COUNT(*) FROM jobs j WHERE j.current_stage_id=s.id) AS job_count,
 EXISTS(SELECT 1 FROM job_updates u WHERE u.stage_id=s.id) AS has_history
 FROM workflow_stages s ORDER BY s.is_archived,s.is_closed,s.sort_order,s.id`
		)
		.all();
	return stages.map((row) => {
		const peers = stages.filter((peer) => !peer.is_archived && peer.is_closed === row.is_closed);
		const index = peers.findIndex((peer) => peer.id === row.id);
		return {
			...row,
			is_closed: Boolean(row.is_closed),
			is_archived: Boolean(row.is_archived),
			is_starting: row.id === start,
			is_referenced: !!(row.job_count || row.has_history),
			can_up: !row.is_archived && index > 0,
			can_down: !row.is_archived && index < peers.length - 1
		};
	});
}
export function listWorkflowStages() {
	return withDatabase((db) => {
		db.exec('BEGIN');
		try {
			const result = readWorkflow(db);
			db.exec('COMMIT');
			return result;
		} catch (e) {
			db.exec('ROLLBACK');
			throw e;
		}
	});
}
function mutate(operation, options = {}) {
	return withDatabase((db) =>
		inTransaction(db, () => {
			const previous = startingStage(db).id;
			operation(db);
			normalizeOrder(db);
			const next = startingStage(db).id;
			if (previous !== next && options.confirm_starting_stage !== true)
				throw new ServiceError(
					'This changes the starting stage for future jobs only. Confirm to continue.',
					'starting_stage_confirmation'
				);
			return readWorkflow(db);
		})
	);
}
export function addWorkflowStage({ name, is_closed = false }) {
	return mutate((db) =>
		db
			.prepare(
				'INSERT INTO workflow_stages(name,sort_order,is_closed,created_at,updated_at) VALUES (?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM workflow_stages),?,?,?)'
			)
			.run(named(db, name), flag(is_closed), now(), now())
	);
}
export function renameWorkflowStage(id, name) {
	return mutate((db) => {
		const row = stageById(db, id);
		db.prepare('UPDATE workflow_stages SET name=?,updated_at=? WHERE id=?').run(
			named(db, name, row.id, !!row.is_archived),
			now(),
			row.id
		);
	});
}
export function setWorkflowStageClosed(id, isClosed, options) {
	return mutate((db) => {
		const row = stageById(db, id);
		const value = flag(isClosed);
		if (value === row.is_closed) return;
		if (used(db, row.id))
			throw new ServiceError(
				'This stage is referenced by jobs or history. Create a replacement stage instead.'
			);
		db.prepare('UPDATE workflow_stages SET is_closed=?,updated_at=? WHERE id=?').run(
			value,
			now(),
			row.id
		);
		append(db, row.id);
	}, options);
}
export function reorderWorkflowStage(id, direction, options) {
	return mutate((db) => {
		const row = stageById(db, id, { available: true });
		if (!['up', 'down'].includes(direction))
			throw new ValidationError({ direction: 'Choose Up or Down.' });
		const peers = db
			.prepare(
				'SELECT * FROM workflow_stages WHERE is_archived=0 AND is_closed=? ORDER BY sort_order,id'
			)
			.all(row.is_closed);
		const index = peers.findIndex((peer) => peer.id === row.id);
		const other = peers[index + (direction === 'up' ? -1 : 1)];
		if (!other) return;
		const save = db.prepare('UPDATE workflow_stages SET sort_order=?,updated_at=? WHERE id=?');
		save.run(other.sort_order, now(), row.id);
		save.run(row.sort_order, now(), other.id);
	}, options);
}
export function archiveWorkflowStage(id, options) {
	return mutate((db) => {
		const row = stageById(db, id);
		if (row.is_archived) return;
		const count = db
			.prepare('SELECT COUNT(*) AS n FROM jobs WHERE current_stage_id=?')
			.get(row.id).n;
		if (count)
			throw new ServiceError(
				`Move the ${count} current job${count === 1 ? '' : 's'} to another stage before archiving.`,
				'stage_occupied'
			);
		db.prepare('UPDATE workflow_stages SET is_archived=1,updated_at=? WHERE id=?').run(
			now(),
			row.id
		);
	}, options);
}
export function restoreWorkflowStage(id) {
	return mutate((db) => {
		const row = stageById(db, id);
		if (!row.is_archived) return;
		named(db, row.name, row.id);
		db.prepare('UPDATE workflow_stages SET is_archived=0,updated_at=? WHERE id=?').run(
			now(),
			row.id
		);
		append(db, row.id);
	});
}
