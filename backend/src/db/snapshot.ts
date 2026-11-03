import type { ProjectConstraints, ProjectGraph } from "@miraiwerk/schemas";
import { ProjectConstraintsSchema } from "@miraiwerk/schemas";
import type { Queryable } from "./pool.js";
import type {
  DependencyRow,
  MilestoneRow,
  PlanSnapshot,
  ProjectRow,
  RequirementRow,
  TaskRow,
} from "./rows.js";

export interface PlanBundle {
  project: ProjectRow;
  requirements: RequirementRow[];
  milestones: MilestoneRow[];
  tasks: TaskRow[];
  dependencies: DependencyRow[];
  assumptions: string[];
  missingInformation: string[];
}

export function constraintsOf(project: ProjectRow): ProjectConstraints {
  const parsed = ProjectConstraintsSchema.safeParse(project.constraints_json);
  if (parsed.success) return parsed.data;
  return ProjectConstraintsSchema.parse({});
}

export function toTask(task: TaskRow) {
  return {
    id: task.id,
    projectId: task.project_id,
    requirementId: task.requirement_id,
    milestoneId: task.milestone_id,
    title: task.title,
    description: task.description,
    status: task.status as "planned" | "in_progress" | "blocked" | "done",
    estimateDays: Number(task.estimate_days),
    priority: task.priority as "P0" | "P1" | "P2" | "P3",
    ownerRole: task.owner_role,
    plannedStart: task.planned_start,
    plannedFinish: task.planned_finish,
    sourceTicketId: task.source_ticket_id,
  };
}

export function toMilestone(milestone: MilestoneRow) {
  return {
    id: milestone.id,
    projectId: milestone.project_id,
    title: milestone.title,
    description: milestone.description,
    targetDate: milestone.target_date,
    releaseGate: milestone.release_gate,
    status: milestone.status,
    position: milestone.position,
  };
}

export function toRequirement(requirement: RequirementRow) {
  return {
    id: requirement.id,
    projectId: requirement.project_id,
    title: requirement.title,
    description: requirement.description,
    acceptanceCriteria: requirement.acceptance_criteria ?? [],
    source: requirement.source,
    status: requirement.status,
  };
}

export async function loadProjectRow(
  client: Queryable,
  projectId: string,
): Promise<ProjectRow | null> {
  const result = await client.query<ProjectRow>(
    `SELECT id, name, description, goal, start_date, target_date, status,
            constraints_json, current_plan_version, created_at, created_by
     FROM projects WHERE id = $1`,
    [projectId],
  );
  return result.rows[0] ?? null;
}

export async function loadPlanBundle(
  client: Queryable,
  projectId: string,
): Promise<PlanBundle | null> {
  const project = await loadProjectRow(client, projectId);
  if (!project) return null;

  const requirements = await client.query<RequirementRow>(
    `SELECT id, project_id, title, description, acceptance_criteria, source, status
     FROM requirements WHERE project_id = $1 ORDER BY created_at, title`,
    [projectId],
  );
  const milestones = await client.query<MilestoneRow>(
    `SELECT id, project_id, title, description, target_date, release_gate, status, position
     FROM milestones WHERE project_id = $1 ORDER BY position, target_date NULLS LAST`,
    [projectId],
  );
  const tasks = await client.query<TaskRow>(
    `SELECT id, project_id, requirement_id, milestone_id, title, description, status,
            estimate_days, priority, owner_role, planned_start, planned_finish, source_ticket_id
     FROM tasks WHERE project_id = $1 ORDER BY planned_start NULLS LAST, title`,
    [projectId],
  );
  const dependencies = await client.query<DependencyRow>(
    `SELECT d.predecessor_task_id, d.successor_task_id, d.dependency_type
     FROM task_dependencies d
     JOIN tasks t ON t.id = d.successor_task_id
     WHERE t.project_id = $1
     ORDER BY d.predecessor_task_id, d.successor_task_id`,
    [projectId],
  );
  const version = await client.query<{ snapshot_json: PlanSnapshot }>(
    `SELECT snapshot_json FROM plan_versions
     WHERE project_id = $1 AND version_number = $2`,
    [projectId, project.current_plan_version],
  );

  const snapshot = version.rows[0]?.snapshot_json;
  return {
    project,
    requirements: requirements.rows,
    milestones: milestones.rows,
    tasks: tasks.rows,
    dependencies: dependencies.rows,
    assumptions: snapshot?.assumptions ?? [],
    missingInformation: snapshot?.missingInformation ?? [],
  };
}

export function buildGraph(bundle: PlanBundle): ProjectGraph {
  return {
    projectId: bundle.project.id,
    startDate: bundle.project.start_date,
    targetDate: bundle.project.target_date,
    tasks: bundle.tasks.map((task) => {
      const mapped = toTask(task);
      return {
        id: mapped.id,
        title: mapped.title,
        description: mapped.description,
        requirementId: mapped.requirementId,
        milestoneId: mapped.milestoneId,
        estimateDays: mapped.estimateDays,
        priority: mapped.priority,
        status: mapped.status,
        ownerRole: mapped.ownerRole,
        plannedStart: mapped.plannedStart,
        plannedFinish: mapped.plannedFinish,
        sourceTicketId: mapped.sourceTicketId,
      };
    }),
    milestones: bundle.milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      targetDate: milestone.target_date,
      releaseGate: milestone.release_gate,
    })),
    dependencies: bundle.dependencies.map((dep) => ({
      predecessorId: dep.predecessor_task_id,
      successorId: dep.successor_task_id,
      dependencyType: dep.dependency_type,
    })),
    constraints: constraintsOf(bundle.project),
  };
}

export function buildSnapshot(
  bundle: PlanBundle,
  version: number,
): PlanSnapshot {
  return {
    version,
    generatedAt: new Date().toISOString(),
    project: {
      name: bundle.project.name,
      goal: bundle.project.goal,
      description: bundle.project.description,
      startDate: bundle.project.start_date,
      targetDate: bundle.project.target_date,
      constraints: bundle.project.constraints_json,
    },
    requirements: bundle.requirements.map((requirement) => ({
      id: requirement.id,
      title: requirement.title,
      description: requirement.description,
      acceptanceCriteria: requirement.acceptance_criteria,
      source: requirement.source,
      status: requirement.status,
    })),
    milestones: bundle.milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      description: milestone.description,
      targetDate: milestone.target_date,
      releaseGate: milestone.release_gate,
      status: milestone.status,
      position: milestone.position,
    })),
    tasks: bundle.tasks.map((task) => {
      const mapped = toTask(task);
      return {
        id: mapped.id,
        requirementId: mapped.requirementId,
        milestoneId: mapped.milestoneId,
        title: mapped.title,
        description: mapped.description,
        status: mapped.status,
        estimateDays: mapped.estimateDays,
        priority: mapped.priority,
        ownerRole: mapped.ownerRole,
        plannedStart: mapped.plannedStart,
        plannedFinish: mapped.plannedFinish,
        sourceTicketId: mapped.sourceTicketId,
      };
    }),
    dependencies: bundle.dependencies.map((dep) => ({
      predecessorId: dep.predecessor_task_id,
      successorId: dep.successor_task_id,
      dependencyType: dep.dependency_type,
    })),
    assumptions: bundle.assumptions,
    missingInformation: bundle.missingInformation,
  };
}

export async function persistSnapshot(
  client: Queryable,
  bundle: PlanBundle,
  version: number,
  options: {
    id: string;
    parentVersionId: string | null;
    changeSummary: string;
    createdBy: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO plan_versions
       (id, project_id, version_number, parent_version_id, snapshot_json, change_summary, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      options.id,
      bundle.project.id,
      version,
      options.parentVersionId,
      JSON.stringify(buildSnapshot(bundle, version)),
      options.changeSummary,
      options.createdBy,
    ],
  );
}
