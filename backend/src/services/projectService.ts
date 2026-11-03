import type {
  AppBootstrap,
  CreateProjectInput,
  CreateTicketInput,
  DecisionHistoryItem,
  GeneratedPlan,
  PlanDraft,
  PlanVersion,
  ProjectHistory,
  ProjectPlan,
  ProjectSummary,
  TicketListItem,
  User,
} from "@miraiwerk/schemas";
import {
  ProjectConstraintsSchema,
  ProjectHistorySchema,
  ProjectPlanSchema,
  AppBootstrapSchema,
} from "@miraiwerk/schemas";
import { scheduleGraph, validateGraph } from "@miraiwerk/ripplemap";
import { aiMode } from "../config.js";
import { assertProjectAccess, assertWorkspaceAccess, getUserById } from "../auth.js";
import { ensurePersonalWorkspace, listOrganizations, listWorkspaces } from "./orgService.js";
import { one, query, withTransaction } from "../db/pool.js";
import type {
  MilestoneRow,
  ProjectRow,
  RequirementRow,
  TaskRow,
} from "../db/rows.js";
import {
  buildGraph,
  constraintsOf,
  loadPlanBundle,
  persistSnapshot,
  toMilestone,
  toRequirement,
  toTask,
} from "../db/snapshot.js";
import { ApiError, newId } from "../lib/http.js";
import {
  buildProjectGraphFromDraft,
  validatePlanDraft,
} from "./planService.js";

interface ProjectSummaryRow {
  id: string;
  name: string;
  description: string;
  goal: string;
  start_date: string;
  target_date: string | null;
  status: string;
  current_plan_version: number;
  created_at: string;
  role: "owner" | "pm" | "member" | "viewer";
  member_count: number;
  open_ticket_count: number;
  pending_decision_count: number;
  milestone_count: number;
  task_count: number;
  next_milestone: {
    id: string;
    title: string;
    targetDate: string | null;
    releaseGate: boolean;
  } | null;
}

function mapSummary(row: ProjectSummaryRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    goal: row.goal,
    startDate: row.start_date,
    targetDate: row.target_date,
    status: row.status,
    currentPlanVersion: row.current_plan_version,
    createdAt: row.created_at,
    role: row.role,
    memberCount: row.member_count,
    openTicketCount: row.open_ticket_count,
    pendingDecisionCount: row.pending_decision_count,
    milestoneCount: row.milestone_count,
    taskCount: row.task_count,
    nextMilestone: row.next_milestone,
  };
}

const SUMMARY_SELECT = `
  SELECT p.id, p.name, p.description, p.goal, p.start_date, p.target_date,
         p.status, p.current_plan_version, p.created_at,
         COALESCE(pm.role,
           CASE
             WHEN wm.role IN ('owner','admin') OR om.role IN ('owner','admin') THEN 'owner'
             WHEN wm.role = 'manager' OR om.role = 'manager' THEN 'pm'
             WHEN wm.role = 'member' OR om.role = 'member' THEN 'member'
             ELSE 'viewer'
           END
         ) AS role,
         (SELECT count(*)::int FROM project_members m WHERE m.project_id = p.id) AS member_count,
         (SELECT count(*)::int FROM tickets t
            WHERE t.project_id = p.id
              AND t.status IN ('new','analyzing','analyzed','needs_clarification','analysis_failed')) AS open_ticket_count,
         (SELECT count(*)::int FROM decision_proposals dp
            WHERE dp.project_id = p.id AND dp.status = 'pending') AS pending_decision_count,
         (SELECT count(*)::int FROM milestones ms WHERE ms.project_id = p.id) AS milestone_count,
         (SELECT count(*)::int FROM tasks tk WHERE tk.project_id = p.id) AS task_count,
         (SELECT json_build_object('id', ms.id, 'title', ms.title,
                                   'targetDate', ms.target_date, 'releaseGate', ms.release_gate)
            FROM milestones ms
           WHERE ms.project_id = p.id AND ms.target_date IS NOT NULL
           ORDER BY ms.target_date ASC LIMIT 1) AS next_milestone
  FROM projects p
  LEFT JOIN workspaces w ON w.id = p.workspace_id
  LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
  LEFT JOIN workspace_members wm ON wm.workspace_id = p.workspace_id AND wm.user_id = $1
  LEFT JOIN organization_members om
    ON om.organization_id = COALESCE(p.organization_id, w.organization_id) AND om.user_id = $1
`;

export async function listProjects(
  userId: string,
  workspaceId?: string | null,
): Promise<ProjectSummary[]> {
  const result = await query<ProjectSummaryRow>(
    `${SUMMARY_SELECT}
     WHERE (pm.user_id = $1 OR wm.user_id = $1 OR om.user_id = $1)
       AND ($2::text IS NULL OR p.workspace_id = $2)
     ORDER BY p.updated_at DESC, p.created_at DESC`,
    [userId, workspaceId ?? null],
  );
  return result.rows.map(mapSummary);
}

async function getProjectSummary(
  userId: string,
  projectId: string,
): Promise<ProjectSummary> {
  const result = await query<ProjectSummaryRow>(
    `${SUMMARY_SELECT} WHERE p.id = $2 AND (pm.user_id = $1 OR wm.user_id = $1 OR om.user_id = $1)`,
    [userId, projectId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
  return mapSummary(row);
}

async function resolveWorkspace(
  userId: string,
  workspaceId?: string | null,
): Promise<{ id: string; organizationId: string }> {
  if (workspaceId) {
    await assertWorkspaceAccess(userId, workspaceId, ["owner", "admin", "manager", "member"]);
    const row = await one<{ id: string; organization_id: string }>(
      "SELECT id, organization_id FROM workspaces WHERE id = $1",
      [workspaceId],
    );
    if (!row) throw new ApiError(404, "WORKSPACE_NOT_FOUND", "Workspace not found.");
    return { id: row.id, organizationId: row.organization_id };
  }
  const existing = await one<{ id: string; organization_id: string }>(
    `SELECT w.id, w.organization_id
     FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE wm.user_id = $1 ORDER BY wm.created_at LIMIT 1`,
    [userId],
  );
  if (existing) return { id: existing.id, organizationId: existing.organization_id };
  const user = await getUserById(userId);
  await ensurePersonalWorkspace(userId, user?.name ?? "Member");
  const created = await one<{ id: string; organization_id: string }>(
    `SELECT w.id, w.organization_id
     FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE wm.user_id = $1 ORDER BY wm.created_at LIMIT 1`,
    [userId],
  );
  if (!created) throw new ApiError(500, "WORKSPACE_REQUIRED", "No workspace is available.");
  return { id: created.id, organizationId: created.organization_id };
}

export async function getProjectPlan(
  userId: string,
  projectId: string,
): Promise<ProjectPlan> {
  await assertProjectAccess(userId, projectId);
  const bundle = await loadPlanBundle({ query } as never, projectId);
  if (!bundle) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
  const summary = await getProjectSummary(userId, projectId);
  const members = await query<{
    user_id: string;
    name: string;
    title: string;
    role: "owner" | "pm" | "member" | "viewer";
    avatar_color: string;
  }>(
    `SELECT pm.user_id, u.name, u.title, pm.role, u.avatar_color
     FROM project_members pm JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1
     ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'pm' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.name`,
    [projectId],
  );

  const graph = buildGraph(bundle);
  const graphValidation = validateGraph(graph);
  const schedule = scheduleGraph(graph);
  const validation = {
    valid: graphValidation.valid,
    errors: graphValidation.errors,
    warnings: [...new Set([...graphValidation.warnings, ...schedule.warnings])],
    cycle: graphValidation.cycles[0]
      ? graphValidation.cycles[0].join(" → ")
      : null,
  };

  return ProjectPlanSchema.parse({
    project: summary,
    version: bundle.project.current_plan_version,
    requirements: bundle.requirements.map(toRequirement),
    milestones: bundle.milestones.map(toMilestone),
    tasks: bundle.tasks.map(toTask),
    dependencies: bundle.dependencies.map((dep) => ({
      predecessorId: dep.predecessor_task_id,
      successorId: dep.successor_task_id,
      dependencyType: dep.dependency_type,
    })),
    members: members.rows.map((member) => ({
      userId: member.user_id,
      name: member.name,
      title: member.title,
      role: member.role,
      avatarColor: member.avatar_color,
    })),
    constraints: constraintsOf(bundle.project),
    assumptions: bundle.assumptions,
    missingInformation: bundle.missingInformation,
    validation,
  });
}

export async function createProject(
  userId: string,
  input: CreateProjectInput,
  generation?: Pick<GeneratedPlan, "provider" | "model" | "degraded"> | null,
  context?: { workspaceId?: string | null },
): Promise<ProjectPlan> {
  const workspace = await resolveWorkspace(userId, context?.workspaceId);
  const validation = validatePlanDraft(input.draft);
  if (!validation.valid) {
    throw new ApiError(
      422,
      "INVALID_PLAN",
      "The project plan failed dependency or schema validation.",
      validation,
    );
  }

  const draft = input.draft;
  const projectId = newId("prj");
  const requirementIds = new Map<string, string>();
  const milestoneIds = new Map<string, string>();
  const taskIds = new Map<string, string>();
  for (const requirement of draft.requirements) {
    requirementIds.set(requirement.tempId, newId("req"));
  }
  for (const milestone of draft.milestones) {
    milestoneIds.set(milestone.tempId, newId("ms"));
  }
  for (const task of draft.tasks) {
    taskIds.set(task.tempId, newId("task"));
  }

  const constraints = ProjectConstraintsSchema.parse({
    ...(input.constraints ?? {}),
    policy: {
      ...(input.constraints as { policy?: Record<string, unknown> } | undefined)?.policy,
    },
  });

  const scheduled = scheduleGraph(buildProjectGraphFromDraft(draft));
  if (!scheduled.valid) {
    throw new ApiError(
      422,
      "INVALID_PLAN",
      "The plan could not be scheduled.",
      scheduled.errors,
    );
  }
  const scheduledById = new Map(scheduled.tasks.map((task) => [task.id, task]));

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO projects
        (id, name, description, goal, start_date, target_date, status, constraints_json,
         current_plan_version, created_by, organization_id, workspace_id)
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,1,$8,$9,$10)`,
      [
        projectId,
        draft.name,
        draft.description,
        draft.goal,
        draft.startDate,
        draft.targetDate,
        JSON.stringify(constraints),
        userId,
        workspace.organizationId,
        workspace.id,
      ],
    );

    await client.query(
      `INSERT INTO project_members (project_id, user_id, role)
       SELECT $1, wm.user_id,
              CASE
                WHEN wm.user_id = $2 THEN 'owner'
                WHEN wm.role IN ('owner','admin','manager') THEN 'pm'
                WHEN wm.role = 'member' THEN 'member'
                ELSE 'viewer'
              END
       FROM workspace_members wm
       WHERE wm.workspace_id = $3
       ON CONFLICT (project_id, user_id) DO NOTHING`,
      [projectId, userId, workspace.id],
    );

    for (const requirement of draft.requirements) {
      await client.query(
        `INSERT INTO requirements
          (id, project_id, title, description, acceptance_criteria, source, status)
         VALUES ($1,$2,$3,$4,$5,$6,'confirmed')`,
        [
          requirementIds.get(requirement.tempId),
          projectId,
          requirement.title,
          requirement.description,
          JSON.stringify(requirement.acceptanceCriteria),
          requirement.source,
        ],
      );
    }

    for (const [index, milestone] of draft.milestones.entries()) {
      await client.query(
        `INSERT INTO milestones
          (id, project_id, title, description, target_date, release_gate, status, position)
         VALUES ($1,$2,$3,$4,$5,$6,'planned',$7)`,
        [
          milestoneIds.get(milestone.tempId),
          projectId,
          milestone.title,
          milestone.description,
          milestone.targetDate,
          milestone.releaseGate,
          index,
        ],
      );
    }

    for (const task of draft.tasks) {
      const schedule = scheduledById.get(task.tempId);
      await client.query(
        `INSERT INTO tasks
          (id, project_id, requirement_id, milestone_id, title, description, status,
           estimate_days, priority, owner_role, planned_start, planned_finish)
         VALUES ($1,$2,$3,$4,$5,$6,'planned',$7,$8,$9,$10,$11)`,
        [
          taskIds.get(task.tempId),
          projectId,
          task.requirementTempId ? requirementIds.get(task.requirementTempId) : null,
          task.milestoneTempId ? milestoneIds.get(task.milestoneTempId) : null,
          task.title,
          task.description,
          task.estimateDays,
          task.priority,
          task.ownerRole,
          schedule?.plannedStart ?? null,
          schedule?.plannedFinish ?? null,
        ],
      );
    }

    for (const task of draft.tasks) {
      const successorId = taskIds.get(task.tempId)!;
      for (const dependency of task.dependencies) {
        await client.query(
          `INSERT INTO task_dependencies
            (predecessor_task_id, successor_task_id, dependency_type)
           VALUES ($1,$2,'finishes_to_start') ON CONFLICT DO NOTHING`,
          [taskIds.get(dependency), successorId],
        );
      }
    }

    const bundle = await loadPlanBundle(client, projectId);
    if (!bundle) throw new ApiError(500, "PROJECT_LOAD_FAILED", "Project could not be reloaded.");
    bundle.assumptions = draft.assumptions;
    bundle.missingInformation = draft.missingInformation;
    await persistSnapshot(client, bundle, 1, {
      id: newId("pv"),
      parentVersionId: null,
      changeSummary: generation
        ? `Baseline plan generated with ${generation.provider === "meta" ? `Meta ${generation.model}` : "deterministic demo rules"}${generation.degraded ? " (degraded fallback)" : ""}.`
        : "Baseline plan approved.",
      createdBy: userId,
    });

    await client.query(
      `INSERT INTO audit_events
        (id, project_id, actor_id, action, entity_type, entity_id, summary)
       VALUES ($1,$2,$3,'plan.created','project',$2,$4)`,
      [
        newId("audit"),
        projectId,
        userId,
        `Baseline plan version 1 created from an approved ${generation?.provider === "meta" ? "Meta" : "deterministic"} plan.`,
      ],
    );
  });

  return getProjectPlan(userId, projectId);
}

export async function listTickets(
  userId: string,
  projectId: string,
): Promise<TicketListItem[]> {
  await assertProjectAccess(userId, projectId);
  const result = await query<{
    id: string;
    project_id: string;
    title: string;
    ticket_type: string | null;
    status: string;
    severity_reported: string;
    created_at: string;
    latest_decision_id: string | null;
    latest_decision_status: string | null;
    latest_recommendation: string | null;
    latest_priority: string | null;
    unknown_count: number | null;
  }>(
    `SELECT t.id, t.project_id, t.title, t.ticket_type, t.status, t.severity_reported,
            t.created_at, dp.id AS latest_decision_id, dp.status AS latest_decision_status,
            dp.recommendation AS latest_recommendation,
            dp.classification_json->>'priority' AS latest_priority,
            CASE WHEN dp.id IS NULL THEN 0 ELSE jsonb_array_length(dp.unknowns_json) END AS unknown_count
     FROM tickets t
     LEFT JOIN LATERAL (
       SELECT * FROM decision_proposals
       WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
     ) dp ON true
     WHERE t.project_id = $1
     ORDER BY
       CASE WHEN dp.status = 'pending' THEN 0 ELSE 1 END,
       CASE t.status WHEN 'new' THEN 0 WHEN 'analysis_failed' THEN 1 ELSE 2 END,
       t.created_at DESC`,
    [projectId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    ticketType: row.ticket_type as TicketListItem["ticketType"],
    status: row.status,
    severityReported: row.severity_reported,
    createdAt: row.created_at,
    latestDecisionId: row.latest_decision_id,
    latestDecisionStatus: row.latest_decision_status as TicketListItem["latestDecisionStatus"],
    latestRecommendation: row.latest_recommendation as TicketListItem["latestRecommendation"],
    latestPriority: row.latest_priority as TicketListItem["latestPriority"],
    missingEvidenceCount: row.unknown_count ?? 0,
  }));
}

export async function getProjectHistory(
  userId: string,
  projectId: string,
): Promise<ProjectHistory> {
  await assertProjectAccess(userId, projectId);
  const versions = await query<{
    id: string;
    project_id: string;
    version_number: number;
    parent_version_id: string | null;
    change_summary: string;
    created_by: string | null;
    created_at: string;
    approved_by_name: string | null;
  }>(
    `SELECT pv.id, pv.project_id, pv.version_number, pv.parent_version_id,
            pv.change_summary, pv.created_by, pv.created_at, u.name AS approved_by_name
     FROM plan_versions pv LEFT JOIN users u ON u.id = pv.created_by
     WHERE pv.project_id = $1 ORDER BY pv.version_number DESC`,
    [projectId],
  );
  const decisions = await query<{
    id: string;
    decision_id: string;
    action: string;
    actor_name: string | null;
    reason: string;
    timestamp: string;
    ticket_id: string | null;
    ticket_title: string | null;
    option: string | null;
  }>(
    `SELECT da.id, da.decision_id, da.action, u.name AS actor_name, da.reason,
            da.timestamp, dp.ticket_id, t.title AS ticket_title, dp.recommendation AS option
     FROM decision_audit da
     JOIN decision_proposals dp ON dp.id = da.decision_id
     JOIN tickets t ON t.id = dp.ticket_id
     LEFT JOIN users u ON u.id = da.actor_id
     WHERE dp.project_id = $1
     ORDER BY da.timestamp DESC`,
    [projectId],
  );
  const audits = await query<{
    id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    actor_name: string | null;
    timestamp: string;
    summary: string;
  }>(
    `SELECT ae.id, ae.action, ae.entity_type, ae.entity_id, u.name AS actor_name,
            ae.timestamp, ae.summary
     FROM audit_events ae LEFT JOIN users u ON u.id = ae.actor_id
     WHERE ae.project_id = $1 ORDER BY ae.timestamp DESC LIMIT 100`,
    [projectId],
  );

  const mappedVersions: PlanVersion[] = versions.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    versionNumber: row.version_number,
    parentVersionId: row.parent_version_id,
    changeSummary: row.change_summary,
    approvedBy: row.created_by,
    approvedByName: row.approved_by_name,
    createdAt: row.created_at,
  }));
  const mappedDecisions: DecisionHistoryItem[] = decisions.rows.map((row) => ({
    id: row.id,
    decisionId: row.decision_id,
    action: row.action,
    actorName: row.actor_name,
    reason: row.reason,
    timestamp: row.timestamp,
    ticketId: row.ticket_id,
    ticketTitle: row.ticket_title,
    option: row.option as DecisionHistoryItem["option"],
  }));

  return ProjectHistorySchema.parse({
    versions: mappedVersions,
    decisions: mappedDecisions,
    auditEvents: audits.rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      actorName: row.actor_name,
      timestamp: row.timestamp,
      summary: row.summary,
    })),
  });
}

export async function getBootstrap(
  userId: string,
  workspaceId?: string | null,
): Promise<AppBootstrap> {
  const [projects, organizations, workspaces, currentUser] = await Promise.all([
    listProjects(userId, workspaceId ?? null),
    listOrganizations(userId),
    listWorkspaces(userId),
    getUserById(userId),
  ]);

  const memberRows = workspaceId
    ? await query<{
        id: string;
        name: string;
        email: string;
        title: string;
        avatar_color: string;
      }>(
        `SELECT u.id, u.name, u.email, u.title, u.avatar_color
         FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = $1 ORDER BY u.name`,
        [workspaceId],
      )
    : await query<{
        id: string;
        name: string;
        email: string;
        title: string;
        avatar_color: string;
      }>(
        `SELECT DISTINCT u.id, u.name, u.email, u.title, u.avatar_color
         FROM users u
         JOIN workspace_members wm ON wm.user_id = u.id
         JOIN workspace_members me ON me.workspace_id = wm.workspace_id AND me.user_id = $1
         ORDER BY u.name`,
        [userId],
      );

  const projectIds = projects.map((project) => project.id);
  const approved = projectIds.length
    ? await one<{ count: number }>(
        `SELECT count(*)::int AS count FROM decision_proposals
         WHERE status = 'approved' AND project_id = ANY($1::text[])`,
        [projectIds],
      )
    : null;

  const userList: User[] = memberRows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    title: row.title,
    avatarColor: row.avatar_color,
  }));

  return AppBootstrapSchema.parse({
    users: userList,
    projects,
    currentUser: currentUser
      ? {
          id: currentUser.id,
          name: currentUser.name,
          email: currentUser.email,
          title: currentUser.title,
          avatarColor: currentUser.avatar_color,
          avatarUrl: currentUser.avatar_url ?? null,
          status: (currentUser.status as "active") ?? "active",
          isPlatformAdmin: Boolean(currentUser.is_platform_admin),
        }
      : null,
    organizations,
    workspaces,
    activeWorkspaceId: workspaceId ?? null,
    aiMode,
    ticketCounts: {
      open: projects.reduce((sum, project) => sum + project.openTicketCount, 0),
      pendingDecisions: projects.reduce((sum, project) => sum + project.pendingDecisionCount, 0),
      approvedDecisions: approved?.count ?? 0,
    },
  });
}
