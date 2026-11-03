import type { BoardTask } from "@miraiwerk/schemas";
import { validateGraph } from "@miraiwerk/ripplemap";
import { scheduleGraph } from "@miraiwerk/ripplemap";
import { assertProjectAccess } from "../auth.js";
import { one, query, withTransaction, type Queryable } from "../db/pool.js";
import { buildGraph, loadPlanBundle } from "../db/snapshot.js";
import { ApiError, newId } from "../lib/http.js";

const CONTRIBUTORS = ["owner", "pm", "member"] as const;
const MANAGERS = ["owner", "pm"] as const;

interface TaskRowEnriched {
  id: string;
  project_id: string;
  requirement_id: string | null;
  milestone_id: string | null;
  milestone_title: string | null;
  title: string;
  description: string;
  status: string;
  estimate_days: string | number;
  priority: string;
  owner_role: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_color: string | null;
  labels_json: unknown;
  planned_start: string | null;
  planned_finish: string | null;
  source_ticket_id: string | null;
  dependency_ids: string[] | null;
}

function mapTask(row: TaskRowEnriched): BoardTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status as BoardTask["status"],
    priority: row.priority as BoardTask["priority"],
    estimateDays: Number(row.estimate_days),
    ownerRole: row.owner_role,
    requirementId: row.requirement_id,
    milestoneId: row.milestone_id,
    milestoneTitle: row.milestone_title,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    assigneeColor: row.assignee_color,
    labels: Array.isArray(row.labels_json) ? (row.labels_json as string[]) : [],
    plannedStart: row.planned_start,
    plannedFinish: row.planned_finish,
    sourceTicketId: row.source_ticket_id,
    dependencyIds: row.dependency_ids ?? [],
  };
}

const TASK_SELECT = `
  SELECT t.id, t.project_id, t.requirement_id, t.milestone_id, ms.title AS milestone_title,
         t.title, t.description, t.status, t.estimate_days, t.priority, t.owner_role,
         t.assignee_id, u.name AS assignee_name, u.avatar_color AS assignee_color,
         t.labels_json, t.planned_start, t.planned_finish, t.source_ticket_id,
         ARRAY(
           SELECT d.predecessor_task_id FROM task_dependencies d
           WHERE d.successor_task_id = t.id
         ) AS dependency_ids
  FROM tasks t
  LEFT JOIN milestones ms ON ms.id = t.milestone_id
  LEFT JOIN users u ON u.id = t.assignee_id
`;

export async function listProjectTasks(
  userId: string,
  projectId: string,
): Promise<BoardTask[]> {
  await assertProjectAccess(userId, projectId);
  const result = await query<TaskRowEnriched>(
    `${TASK_SELECT} WHERE t.project_id = $1
     ORDER BY t.planned_start NULLS LAST, t.title`,
    [projectId],
  );
  return result.rows.map(mapTask);
}

export async function getTask(userId: string, taskId: string): Promise<BoardTask> {
  const result = await query<TaskRowEnriched & { project_id: string }>(
    `${TASK_SELECT} WHERE t.id = $1`,
    [taskId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "TASK_NOT_FOUND", "Task not found.");
  await assertProjectAccess(userId, row.project_id);
  return mapTask(row);
}

async function assertWorkspaceMember(
  client: Queryable,
  projectId: string,
  userIdValue: string,
): Promise<void> {
  const row = await client.query(
    `SELECT 1 FROM projects p
     JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
     WHERE p.id = $1 AND wm.user_id = $2`,
    [projectId, userIdValue],
  );
  if (row.rowCount === 0) {
    throw new ApiError(422, "INVALID_ASSIGNEE", "The assignee is not a member of this workspace.");
  }
}

async function assertMilestoneInProject(
  client: Queryable,
  projectId: string,
  milestoneId: string | null,
): Promise<void> {
  if (!milestoneId) return;
  const row = await client.query(
    `SELECT 1 FROM milestones WHERE id = $1 AND project_id = $2`,
    [milestoneId, projectId],
  );
  if (row.rowCount === 0) throw new ApiError(422, "INVALID_MILESTONE", "Milestone does not belong to this project.");
}

async function assertRequirementInProject(
  client: Queryable,
  projectId: string,
  requirementId: string | null,
): Promise<void> {
  if (!requirementId) return;
  const row = await client.query(
    `SELECT 1 FROM requirements WHERE id = $1 AND project_id = $2`,
    [requirementId, projectId],
  );
  if (row.rowCount === 0) throw new ApiError(422, "INVALID_REQUIREMENT", "Requirement does not belong to this project.");
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: BoardTask["status"];
  priority?: BoardTask["priority"];
  estimateDays?: number;
  ownerRole?: string;
  requirementId?: string | null;
  milestoneId?: string | null;
  assigneeId?: string | null;
  labels?: string[];
  plannedStart?: string | null;
  plannedFinish?: string | null;
  dependencyIds?: string[];
  sourceTicketId?: string | null;
}

export async function createTask(
  userId: string,
  projectId: string,
  input: CreateTaskInput,
): Promise<BoardTask> {
  await assertProjectAccess(userId, projectId, [...CONTRIBUTORS]);
  const title = input.title.trim();
  if (title.length < 3) throw new ApiError(422, "INVALID_TITLE", "Task title is too short.");
  const estimate = input.estimateDays ?? 1;
  if (!Number.isFinite(estimate) || estimate <= 0 || estimate > 60) {
    throw new ApiError(422, "INVALID_ESTIMATE", "Estimate must be between 0.5 and 60 working days.");
  }
  const id = newId("task");

  await withTransaction(async (client) => {
    await assertMilestoneInProject(client, projectId, input.milestoneId ?? null);
    await assertRequirementInProject(client, projectId, input.requirementId ?? null);
    if (input.assigneeId) await assertWorkspaceMember(client, projectId, input.assigneeId);

    await client.query(
      `INSERT INTO tasks
        (id, project_id, requirement_id, milestone_id, title, description, status,
         estimate_days, priority, owner_role, assignee_id, labels_json,
         planned_start, planned_finish, source_ticket_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        id,
        projectId,
        input.requirementId ?? null,
        input.milestoneId ?? null,
        title,
        input.description ?? "",
        input.status ?? "planned",
        estimate,
        input.priority ?? "P2",
        input.ownerRole ?? "Engineering",
        input.assigneeId ?? null,
        JSON.stringify((input.labels ?? []).slice(0, 20)),
        input.plannedStart ?? null,
        input.plannedFinish ?? null,
        input.sourceTicketId ?? null,
      ],
    );

    for (const dependencyId of input.dependencyIds ?? []) {
      const exists = await client.query(
        `SELECT 1 FROM tasks WHERE id = $1 AND project_id = $2`,
        [dependencyId, projectId],
      );
      if (exists.rowCount === 0) {
        throw new ApiError(422, "INVALID_DEPENDENCY", "A dependency task does not belong to this project.");
      }
      await client.query(
        `INSERT INTO task_dependencies (predecessor_task_id, successor_task_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [dependencyId, id],
      );
    }

    await client.query(
      `INSERT INTO audit_events
        (id, project_id, actor_id, action, entity_type, entity_id, summary)
       VALUES ($1,$2,$3,'task.created','task',$4,$5)`,
      [newId("audit"), projectId, userId, id, `Task created: ${title}`],
    );
  });

  return getTask(userId, id);
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: BoardTask["status"];
  priority?: BoardTask["priority"];
  estimateDays?: number;
  ownerRole?: string;
  requirementId?: string | null;
  milestoneId?: string | null;
  assigneeId?: string | null;
  labels?: string[];
  plannedStart?: string | null;
  plannedFinish?: string | null;
}

export async function updateTask(
  userId: string,
  taskId: string,
  input: UpdateTaskInput,
): Promise<BoardTask> {
  const current = await one<{
    id: string;
    project_id: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    estimate_days: string | number;
    owner_role: string;
    requirement_id: string | null;
    milestone_id: string | null;
    assignee_id: string | null;
    labels_json: unknown;
    planned_start: string | null;
    planned_finish: string | null;
  }>(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
  if (!current) throw new ApiError(404, "TASK_NOT_FOUND", "Task not found.");
  await assertProjectAccess(userId, current.project_id, [...CONTRIBUTORS]);

  const next = {
    title: input.title?.trim() ?? current.title,
    description: input.description ?? current.description,
    status: input.status ?? current.status,
    priority: input.priority ?? current.priority,
    estimateDays: input.estimateDays ?? Number(current.estimate_days),
    ownerRole: input.ownerRole ?? current.owner_role,
    requirementId: input.requirementId === undefined ? current.requirement_id : input.requirementId,
    milestoneId: input.milestoneId === undefined ? current.milestone_id : input.milestoneId,
    assigneeId: input.assigneeId === undefined ? current.assignee_id : input.assigneeId,
    labels: input.labels ?? (Array.isArray(current.labels_json) ? (current.labels_json as string[]) : []),
    plannedStart: input.plannedStart === undefined ? current.planned_start : input.plannedStart,
    plannedFinish: input.plannedFinish === undefined ? current.planned_finish : input.plannedFinish,
  };
  if (next.title.length < 3) throw new ApiError(422, "INVALID_TITLE", "Task title is too short.");
  if (!Number.isFinite(next.estimateDays) || next.estimateDays <= 0 || next.estimateDays > 60) {
    throw new ApiError(422, "INVALID_ESTIMATE", "Estimate must be between 0.5 and 60 working days.");
  }

  await withTransaction(async (client) => {
    await assertMilestoneInProject(client, current.project_id, next.milestoneId);
    await assertRequirementInProject(client, current.project_id, next.requirementId);
    if (next.assigneeId) await assertWorkspaceMember(client, current.project_id, next.assigneeId);

    await client.query(
      `UPDATE tasks SET
        title = $2, description = $3, status = $4, priority = $5, estimate_days = $6,
        owner_role = $7, requirement_id = $8, milestone_id = $9, assignee_id = $10,
        labels_json = $11, planned_start = $12, planned_finish = $13, updated_at = now()
       WHERE id = $1`,
      [
        taskId,
        next.title,
        next.description,
        next.status,
        next.priority,
        next.estimateDays,
        next.ownerRole,
        next.requirementId,
        next.milestoneId,
        next.assigneeId,
        JSON.stringify(next.labels.slice(0, 20)),
        next.plannedStart,
        next.plannedFinish,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (id, project_id, actor_id, action, entity_type, entity_id, before_json, after_json, summary)
       VALUES ($1,$2,$3,'task.updated','task',$4,$5,$6,$7)`,
      [
        newId("audit"),
        current.project_id,
        userId,
        taskId,
        JSON.stringify(current),
        JSON.stringify(next),
        `Task updated: ${next.title}`,
      ],
    );
  });

  return getTask(userId, taskId);
}

export async function addTaskDependency(
  userId: string,
  projectId: string,
  predecessorId: string,
  successorId: string,
): Promise<void> {
  await assertProjectAccess(userId, projectId, [...CONTRIBUTORS]);
  if (predecessorId === successorId) {
    throw new ApiError(422, "INVALID_DEPENDENCY", "A task cannot depend on itself.");
  }

  await withTransaction(async (client) => {
    const tasks = await client.query<{ id: string }>(
      `SELECT id FROM tasks WHERE project_id = $1 AND id = ANY($2::text[])`,
      [projectId, [predecessorId, successorId]],
    );
    if (tasks.rowCount !== 2) {
      throw new ApiError(422, "INVALID_DEPENDENCY", "Both tasks must belong to this project.");
    }
    await client.query(
      `INSERT INTO task_dependencies (predecessor_task_id, successor_task_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [predecessorId, successorId],
    );
    const bundle = await loadPlanBundle(client, projectId);
    if (!bundle) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
    const validation = validateGraph(buildGraph(bundle));
    if (!validation.valid) {
      throw new ApiError(422, "DEPENDENCY_CYCLE", "This dependency would create a cycle.", {
        errors: validation.errors,
        cycles: validation.cycles,
      });
    }
    const schedule = scheduleGraph(buildGraph(bundle));
    if (schedule.valid) {
      for (const task of schedule.tasks) {
        await client.query(
          `UPDATE tasks SET planned_start = $2, planned_finish = $3 WHERE id = $1`,
          [task.id, task.plannedStart, task.plannedFinish],
        );
      }
    }
    await client.query(
      `INSERT INTO audit_events
        (id, project_id, actor_id, action, entity_type, entity_id, summary)
       VALUES ($1,$2,$3,'dependency.added','task',$4,$5)`,
      [
        newId("audit"),
        projectId,
        userId,
        successorId,
        `Dependency added: ${predecessorId} → ${successorId}`,
      ],
    );
  });
}

export async function removeTaskDependency(
  userId: string,
  projectId: string,
  predecessorId: string,
  successorId: string,
): Promise<void> {
  await assertProjectAccess(userId, projectId, [...CONTRIBUTORS]);
  await withTransaction(async (client) => {
    const result = await client.query(
      `DELETE FROM task_dependencies d
       USING tasks t
       WHERE t.id = d.successor_task_id AND t.project_id = $3
         AND d.predecessor_task_id = $1 AND d.successor_task_id = $2`,
      [predecessorId, successorId, projectId],
    );
    if (result.rowCount === 0) throw new ApiError(404, "DEPENDENCY_NOT_FOUND", "Dependency not found.");
    await client.query(
      `INSERT INTO audit_events
        (id, project_id, actor_id, action, entity_type, entity_id, summary)
       VALUES ($1,$2,$3,'dependency.removed','task',$4,$5)`,
      [newId("audit"), projectId, userId, successorId, `Dependency removed: ${predecessorId} → ${successorId}`],
    );
  });
}

export async function listMilestones(userId: string, projectId: string) {
  await assertProjectAccess(userId, projectId);
  const result = await query<{
    id: string;
    title: string;
    description: string;
    target_date: string | null;
    release_gate: boolean;
    status: string;
    position: number;
  }>(
    `SELECT id, title, description, target_date, release_gate, status, position
     FROM milestones WHERE project_id = $1 ORDER BY position, target_date NULLS LAST`,
    [projectId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    projectId,
    title: row.title,
    description: row.description,
    targetDate: row.target_date,
    releaseGate: row.release_gate,
    status: row.status,
    position: row.position,
  }));
}

export async function createMilestone(
  userId: string,
  projectId: string,
  input: { title: string; description?: string; targetDate?: string | null; releaseGate?: boolean },
) {
  await assertProjectAccess(userId, projectId, [...MANAGERS]);
  const title = input.title.trim();
  if (title.length < 2) throw new ApiError(422, "INVALID_TITLE", "Milestone title is too short.");
  const position = await one<{ next: number }>(
    `SELECT COALESCE(max(position), -1) + 1 AS next FROM milestones WHERE project_id = $1`,
    [projectId],
  );
  const id = newId("ms");
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO milestones
        (id, project_id, title, description, target_date, release_gate, status, position)
       VALUES ($1,$2,$3,$4,$5,$6,'planned',$7)`,
      [id, projectId, title, input.description ?? "", input.targetDate ?? null, input.releaseGate ?? false, position?.next ?? 0],
    );
    await client.query(
      `INSERT INTO audit_events
        (id, project_id, actor_id, action, entity_type, entity_id, summary)
       VALUES ($1,$2,$3,'milestone.created','milestone',$4,$5)`,
      [newId("audit"), projectId, userId, id, `Milestone created: ${title}`],
    );
  });
  const milestones = await listMilestones(userId, projectId);
  return milestones.find((milestone) => milestone.id === id)!;
}

export async function updateMilestone(
  userId: string,
  milestoneId: string,
  input: { title?: string; description?: string; targetDate?: string | null; releaseGate?: boolean; status?: string },
) {
  const current = await one<{ project_id: string }>(
    `SELECT project_id FROM milestones WHERE id = $1`,
    [milestoneId],
  );
  if (!current) throw new ApiError(404, "MILESTONE_NOT_FOUND", "Milestone not found.");
  await assertProjectAccess(userId, current.project_id, [...MANAGERS]);
  await query(
    `UPDATE milestones SET
       title = COALESCE($2, title),
       description = COALESCE($3, description),
       target_date = CASE WHEN $4::boolean THEN $5::date ELSE target_date END,
       release_gate = COALESCE($6, release_gate),
       status = COALESCE($7, status)
     WHERE id = $1`,
    [
      milestoneId,
      input.title?.trim() || null,
      input.description ?? null,
      input.targetDate !== undefined,
      input.targetDate ?? null,
      input.releaseGate ?? null,
      input.status ?? null,
    ],
  );
  const milestones = await listMilestones(userId, current.project_id);
  return milestones.find((milestone) => milestone.id === milestoneId)!;
}

export async function projectRoadmap(userId: string, projectId: string) {
  const [tasks, milestones] = await Promise.all([
    listProjectTasks(userId, projectId),
    listMilestones(userId, projectId),
  ]);
  return {
    milestones,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      milestoneId: task.milestoneId,
      plannedStart: task.plannedStart,
      plannedFinish: task.plannedFinish,
      estimateDays: task.estimateDays,
      priority: task.priority,
      assigneeName: task.assigneeName,
      dependencyIds: task.dependencyIds,
    })),
  };
}
