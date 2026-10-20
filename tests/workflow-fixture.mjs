import { listWorkflowStages } from '../src/lib/server/workflow.js';
import { moveJobStage } from '../src/lib/server/services.js';
export const stageId = (name) => listWorkflowStages().find((stage) => stage.name === name).id;
export const closeJob = (id, event_date = '2020-01-01') =>
	moveJobStage(id, { stage_id: stageId('Dismissed'), event_date });
export const reopenJob = (id, event_date = '2020-01-01') =>
	moveJobStage(id, { stage_id: stageId('New'), event_date });
