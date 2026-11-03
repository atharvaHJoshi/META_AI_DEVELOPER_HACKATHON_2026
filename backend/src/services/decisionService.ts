import type {
  ClarifyDecisionInput,
  DecisionAudit,
  DecisionOption,
  DecisionOutcome,
  ProposedChange,
  ScenarioResult,
} from "@miraiwerk/schemas";
import { APPROVER_ROLES } from "@miraiwerk/schemas";
import { scheduleGraph } from "@miraiwerk/ripplemap";
import { assertProjectAccess, assertWorkspaceAccess } from "../auth.js";
import { query, withTransaction, type Queryable } from "../db/pool.js";
import type { PlanBundle } from "../db/snapshot.js";
import { buildGraph, loadPlanBundle, persistSnapshot } from "../db/snapshot.js";
import type { ProposalRow } from "../db/rows.js";
import { ApiError, newId } from "../lib/http.js";
import {
  computeScenario,
  getLatestScenario,
  markProposalStale,
} from "./simulationService.js";
import { getDecisionProposal, loadProposalRow } from "./ticketService.js";

const TICKET_STATUS_BY_OPTION: Record<DecisionOption, string> = {
  accept: "accepted",
  defer: "deferred",
  split: "accepted",
  clarify: "needs_clarification",
  duplicate: "duplicate",
};

interface ApplyResult {
  planVersionNumber: number | null;
  summary: string;
}

async function latestAudit(client: Queryable, proposalId: string): Promise<DecisionAudit> {
  const result = await client.query<{
    id: string;
    decision_id: string;
    actor_id: string | null;
    actor_name: string | null;
    action: string;
    reason: string;
    before_json: unknown;
    after_json: unknown;
    timestamp: string;
  }>(
    `SELECT da.id, da.decision_id, da.actor_id, u.name AS actor_name, da.action,
            da.reason, da.before_json, da.after_json, da.timestamp
     FROM decision_audit da LEFT JOIN users u ON u.id = da.actor_id
     WHERE da.decision_id = $1 ORDER BY da.timestamp DESC LIMIT 1`,
    [proposalId],
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(500, "AUDIT_MISSING", "The decision audit record was not written.");
  return {
    id: row.id,
    decisionId: row.decision_id,
    actorId: row.actor_id,
    actorName: row.actor_name,
    action: row.action,
    reason: row.reason,
    beforeJson: row.before_json,
    afterJson: row.after_json,
    timestamp: row.timestamp,
  };
}

async function writeDecisionAudit(
  client: Queryable,
  input: {
    proposalId: string;
    actorId: string;
    action: string;
    reason: string;
    before: unknown;
    after: unknown;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO decision_audit
      (id, decision_id, actor_id, action, reason, before_json, after_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId("da"),
      input.proposalId,
      input.actorId,
      input.action,
      input.reason,
      input.before === null ? null : JSON.stringify(input.before),
      input.after === null ? null : JSON.stringify(input.after),
    ],
  );
}

async function writeProjectAudit(
  client: Queryable,
  input: {
    projectId: string;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
      (id, project_id, actor_id, action, entity_type, entity_id, summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId("audit"),
      input.projectId,
      input.actorId,
      input.action,
      input.entityType,
      input.entityId,
      input.summary,
    ],
  );
}

async function applyPlanChanges(
  client: Queryable,
  proposal: ProposalRow,
  bundle: PlanBundle,
  option: "accept" | "split",
  change: ProposedChange,
  scenario: ScenarioResult,
  userId: string,
): Promise<ApplyResult> {
  const requirementIds = new Set(bundle.requirements.map((item) => item.id));
  const milestoneIds = new Set(bundle.milestones.map((item) => item.id));
  const existingTaskIds = new Set(bundle.tasks.map((item) => item.id));

  const tempToReal = new Map<string, string>();
  for (const task of change.tasksToAdd) {
    if (existingTaskIds.has(task.tempId)) {
      throw new ApiError(
        422,
        "INVALID_PROPOSED_CHANGE",
        `New task "${task.tempId}" conflicts with an existing task.`,
      );
    }
    tempToReal.set(task.tempId, newId("task"));
  }
  const resolveTaskId = (id: string): string | null => tempToReal.get(id) ?? (existingTaskIds.has(id) ? id : null);

  for (const task of change.tasksToAdd) {
    if (task.requirementId && !requirementIds.has(task.requirementId)) {
      throw new ApiError(422, "INVALID_PROPOSED_CHANGE", "A new task references an unknown requirement.");
    }
    if (task.milestoneId && !milestoneIds.has(task.milestoneId)) {
      throw new ApiError(422, "INVALID_PROPOSED_CHANGE", "A new task references an unknown milestone.");
    }
    await client.query(
      `INSERT INTO tasks
        (id, project_id, requirement_id, milestone_id, title, description, status,
         estimate_days, priority, owner_role, source_ticket_id)
       VALUES ($1,$2,$3,$4,$5,$6,'planned',$7,$8,$9,$10)`,
      [
        tempToReal.get(task.tempId),
        proposal.project_id,
        task.requirementId,
        task.milestoneId,
        task.title,
        task.description,
        task.estimateDays,
        task.priority,
        task.ownerRole,
        proposal.ticket_id,
      ],
    );
  }

  for (const update of change.tasksToUpdate) {
    if (!existingTaskIds.has(update.taskId)) {
      throw new ApiError(422, "INVALID_PROPOSED_CHANGE", "An update references a task that no longer exists.");
    }
    if (update.milestoneId && !milestoneIds.has(update.milestoneId)) {
      throw new ApiError(422, "INVALID_PROPOSED_CHANGE", "An update references an unknown milestone.");
    }
    await client.query(
      `UPDATE tasks
       SET estimate_days = COALESCE($2, estimate_days),
           priority = COALESCE($3, priority),
           milestone_id = CASE WHEN $5 THEN $4 ELSE milestone_id END
       WHERE id = $1 AND project_id = $6`,
      [
        update.taskId,
        update.estimateDays ?? null,
        update.priority ?? null,
        update.milestoneId ?? null,
        update.milestoneId !== undefined,
        proposal.project_id,
      ],
    );
  }

  for (const taskId of change.tasksToRemove) {
    if (!existingTaskIds.has(taskId)) continue;
    await client.query(`DELETE FROM tasks WHERE id = $1 AND project_id = $2`, [
      taskId,
      proposal.project_id,
    ]);
  }

  const dependencyKeys = new Set<string>();
  for (const task of change.tasksToAdd) {
    for (const dependencyId of task.dependencies) {
      const predecessorId = resolveTaskId(dependencyId);
      const successorId = tempToReal.get(task.tempId);
      if (!predecessorId || !successorId) {
        throw new ApiError(422, "INVALID_PROPOSED_CHANGE", "A new task depends on an unknown task.");
      }
      const key = `${predecessorId}->${successorId}`;
      if (dependencyKeys.has(key)) continue;
      dependencyKeys.add(key);
      await client.query(
        `INSERT INTO task_dependencies (predecessor_task_id, successor_task_id, dependency_type)
         VALUES ($1,$2,'finishes_to_start') ON CONFLICT DO NOTHING`,
        [predecessorId, successorId],
      );
    }
  }

  for (const dependency of change.dependenciesToAdd) {
    const predecessorId = resolveTaskId(dependency.predecessorId);
    const successorId = resolveTaskId(dependency.successorId);
    if (!predecessorId || !successorId) {
      throw new ApiError(422, "INVALID_PROPOSED_CHANGE", "A proposed dependency references an unknown task.");
    }
    const key = `${predecessorId}->${successorId}`;
    if (dependencyKeys.has(key)) continue;
    dependencyKeys.add(key);
    await client.query(
      `INSERT INTO task_dependencies (predecessor_task_id, successor_task_id, dependency_type)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [predecessorId, successorId, dependency.dependencyType],
    );
  }

  const updated = await loadPlanBundle(client, proposal.project_id);
  if (!updated) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
  const schedule = scheduleGraph(buildGraph(updated));
  if (!schedule.valid) {
    throw new ApiError(
      422,
      "INVALID_PLAN_AFTER_APPROVAL",
      "The change would leave the plan in an invalid state.",
      schedule.errors,
    );
  }
  for (const task of schedule.tasks) {
    await client.query(
      `UPDATE tasks SET planned_start = $2, planned_finish = $3
       WHERE id = $1 AND project_id = $4`,
      [task.id, task.plannedStart, task.plannedFinish, proposal.project_id],
    );
  }

  updated.tasks.forEach((task) => {
    const scheduled = schedule.tasks.find((item) => item.id === task.id);
    if (scheduled) {
      task.planned_start = scheduled.plannedStart;
      task.planned_finish = scheduled.plannedFinish;
    }
  });

  const previousVersion = await client.query<{ id: string }>(
    `SELECT id FROM plan_versions WHERE project_id = $1 AND version_number = $2`,
    [proposal.project_id, updated.project.current_plan_version],
  );
  const nextVersion = updated.project.current_plan_version + 1;
  const addedTitles = change.tasksToAdd.map((task) => task.title);
  const summary = `${option === "split" ? "Split mitigation approved" : "Change approved"} for ticket ${proposal.ticket_id}: ${addedTitles.join("; ")}. Scenario ${scenario.inputHash}: release impact ${scenario.metrics.scheduleDeltaDays} day(s), ${scenario.metrics.affectedTaskCount} affected task(s).`;

  await persistSnapshot(client, updated, nextVersion, {
    id: newId("pv"),
    parentVersionId: previousVersion.rows[0]?.id ?? null,
    changeSummary: summary,
    createdBy: userId,
  });

  await client.query(
    `UPDATE projects SET current_plan_version = $2, updated_at = now() WHERE id = $1`,
    [proposal.project_id, nextVersion],
  );

  const staleSiblings = await client.query<{
    id: string;
    base_plan_version: number;
  }>(
    `UPDATE decision_proposals SET status = 'stale'
     WHERE project_id = $1 AND status = 'pending' AND id <> $2
     RETURNING id, base_plan_version`,
    [proposal.project_id, proposal.id],
  );
  for (const sibling of staleSiblings.rows) {
    await client.query(
      `INSERT INTO decision_audit
        (id, decision_id, actor_id, action, reason, before_json, after_json)
       VALUES ($1,$2,$3,'stale',$4,$5,$6)`,
      [
        newId("da"),
        sibling.id,
        userId,
        `Plan version ${nextVersion} was created from decision ${proposal.id}; this proposal was computed against version ${sibling.base_plan_version} and must be re-analysed.`,
        JSON.stringify({
          status: "pending",
          basePlanVersion: sibling.base_plan_version,
        }),
        JSON.stringify({ status: "stale", currentPlanVersion: nextVersion }),
      ],
    );
  }
  if (staleSiblings.rows.length > 0) {
    await writeProjectAudit(client, {
      projectId: proposal.project_id,
      actorId: userId,
      action: "decision.stale",
      entityType: "project",
      entityId: proposal.project_id,
      summary: `${staleSiblings.rows.length} sibling proposal(s) marked stale after plan version ${nextVersion}.`,
    });
  }

  return { planVersionNumber: nextVersion, summary };
}

export async function approveDecision(
  userId: string,
  proposalId: string,
  option: DecisionOption,
  reason: string,
): Promise<DecisionOutcome> {
  const initial = await loadProposalRow({ query } as never, proposalId);
  if (!initial) throw new ApiError(404, "DECISION_NOT_FOUND", "Decision proposal not found.");
  await assertProjectAccess(userId, initial.project_id, [...APPROVER_ROLES]);
  if (option === "clarify") {
    throw new ApiError(
      422,
      "USE_CLARIFY_ACTION",
      "Use the clarify action to request more information instead of approving.",
    );
  }
  if (option === "duplicate" && initial.duplicate_candidates_json.length === 0) {
    throw new ApiError(
      422,
      "NO_DUPLICATE_CANDIDATE",
      "This proposal did not identify a duplicate candidate.",
    );
  }

  const result = await withTransaction(async (client) => {
    const locked = await client.query<ProposalRow>(
      `SELECT * FROM decision_proposals WHERE id = $1 FOR UPDATE`,
      [proposalId],
    );
    const proposal = locked.rows[0]!;
    if (proposal.status !== "pending") {
      throw new ApiError(
        409,
        "DECISION_NOT_PENDING",
        `This proposal is ${proposal.status} and cannot be approved.`,
      );
    }
    const project = await client.query<{ current_plan_version: number }>(
      `SELECT current_plan_version FROM projects WHERE id = $1 FOR UPDATE`,
      [proposal.project_id],
    );
    const currentVersion = project.rows[0]?.current_plan_version;
    if (currentVersion === undefined) {
      throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
    }
    if (currentVersion !== proposal.base_plan_version) {
      await markProposalStale(
        client,
        proposal,
        userId,
        `Plan moved to version ${currentVersion} after the proposal was computed on version ${proposal.base_plan_version}.`,
      );
      throw new ApiError(
        409,
        "STALE_PROPOSAL",
        `The plan moved to version ${currentVersion} after this proposal was generated. Re-analyse the ticket before approving.`,
      );
    }

    const bundle = await loadPlanBundle(client, proposal.project_id);
    if (!bundle) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
    const { scenario, change } = computeScenario(bundle, proposal, option);
    if (!scenario.valid) {
      throw new ApiError(
        422,
        "SCENARIO_INVALID",
        "The selected scenario is invalid and cannot be approved.",
        scenario.validationErrors,
      );
    }

    const stored = await getLatestScenario(client, proposal.id, option);
    if (!stored) {
      throw new ApiError(
        409,
        "SCENARIO_REQUIRED",
        "Simulate this option before approving it.",
      );
    }
    if (!stored.valid) {
      throw new ApiError(
        422,
        "SCENARIO_INVALID",
        "The stored scenario for this option is invalid. Simulate again after correcting the proposal.",
      );
    }
    if (stored.input_hash !== scenario.inputHash) {
      throw new ApiError(
        409,
        "SCENARIO_STALE",
        "The stored scenario does not match the current plan. Simulate the option again before approving.",
      );
    }

    let applied: ApplyResult = {
      planVersionNumber: null,
      summary:
        option === "defer"
          ? "Deferred without changing the plan."
          : "Linked as a duplicate without changing the plan.",
    };
    if (option === "accept" || option === "split") {
      applied = await applyPlanChanges(client, proposal, bundle, option, change, scenario, userId);
    }

    await client.query(
      `UPDATE decision_proposals SET status = 'approved' WHERE id = $1`,
      [proposal.id],
    );
    await client.query(`UPDATE tickets SET status = $2 WHERE id = $1`, [
      proposal.ticket_id,
      TICKET_STATUS_BY_OPTION[option],
    ]);

    const after = {
      status: "approved",
      option,
      planVersionNumber: applied.planVersionNumber,
      scenario,
    };
    await writeDecisionAudit(client, {
      proposalId: proposal.id,
      actorId: userId,
      action: "approved",
      reason,
      before: {
        status: proposal.status,
        basePlanVersion: proposal.base_plan_version,
        recommendation: proposal.recommendation,
      },
      after,
    });
    await writeProjectAudit(client, {
      projectId: proposal.project_id,
      actorId: userId,
      action: "decision.approved",
      entityType: "decision",
      entityId: proposal.id,
      summary: `Decision ${proposal.id} approved as "${option}". ${applied.summary}`,
    });
    if (applied.planVersionNumber !== null) {
      await writeProjectAudit(client, {
        projectId: proposal.project_id,
        actorId: userId,
        action: "plan.versioned",
        entityType: "project",
        entityId: proposal.project_id,
        summary: `Plan version ${applied.planVersionNumber} created from decision ${proposal.id}.`,
      });
    }

    return {
      status: TICKET_STATUS_BY_OPTION[option],
      planVersionNumber: applied.planVersionNumber,
      message:
        applied.planVersionNumber === null
          ? `Decision approved as "${option}". The plan is unchanged and the outcome is recorded in the audit trail.`
          : `Decision approved as "${option}". Plan version ${applied.planVersionNumber} now contains the approved change.`,
    };
  });

  const proposal = await getDecisionProposal(userId, proposalId);
  const audit = await latestAudit({ query } as never, proposalId);
  return {
    proposal,
    scenario: proposal.scenarioRuns.find((run) => run.option === option)?.output ?? null,
    planVersionNumber: result.planVersionNumber,
    audit,
    message: result.message,
  };
}

export async function rejectDecision(
  userId: string,
  proposalId: string,
  reason: string,
): Promise<DecisionOutcome> {
  const initial = await loadProposalRow({ query } as never, proposalId);
  if (!initial) throw new ApiError(404, "DECISION_NOT_FOUND", "Decision proposal not found.");
  await assertProjectAccess(userId, initial.project_id, [...APPROVER_ROLES]);

  await withTransaction(async (client) => {
    const locked = await client.query<ProposalRow>(
      `SELECT * FROM decision_proposals WHERE id = $1 FOR UPDATE`,
      [proposalId],
    );
    const proposal = locked.rows[0]!;
    if (proposal.status !== "pending") {
      throw new ApiError(409, "DECISION_NOT_PENDING", `This proposal is ${proposal.status}.`);
    }
    await client.query(`UPDATE decision_proposals SET status = 'rejected' WHERE id = $1`, [
      proposal.id,
    ]);
    await client.query(`UPDATE tickets SET status = 'rejected' WHERE id = $1`, [
      proposal.ticket_id,
    ]);
    await writeDecisionAudit(client, {
      proposalId: proposal.id,
      actorId: userId,
      action: "rejected",
      reason,
      before: { status: proposal.status, recommendation: proposal.recommendation },
      after: { status: "rejected" },
    });
    await writeProjectAudit(client, {
      projectId: proposal.project_id,
      actorId: userId,
      action: "decision.rejected",
      entityType: "decision",
      entityId: proposal.id,
      summary: `Decision ${proposal.id} rejected: ${reason}`,
    });
  });

  const proposal = await getDecisionProposal(userId, proposalId);
  return {
    proposal,
    scenario: null,
    planVersionNumber: null,
    audit: await latestAudit({ query } as never, proposalId),
    message: "Decision rejected. The plan was not changed.",
  };
}

export async function clarifyDecision(
  userId: string,
  proposalId: string,
  input: ClarifyDecisionInput,
): Promise<DecisionOutcome> {
  const initial = await loadProposalRow({ query } as never, proposalId);
  if (!initial) throw new ApiError(404, "DECISION_NOT_FOUND", "Decision proposal not found.");
  await assertProjectAccess(userId, initial.project_id, [...APPROVER_ROLES]);

  await withTransaction(async (client) => {
    const locked = await client.query<ProposalRow>(
      `SELECT * FROM decision_proposals WHERE id = $1 FOR UPDATE`,
      [proposalId],
    );
    const proposal = locked.rows[0]!;
    if (proposal.status !== "pending") {
      throw new ApiError(409, "DECISION_NOT_PENDING", `This proposal is ${proposal.status}.`);
    }
    const questions = [
      ...new Set([...(proposal.clarifying_questions_json ?? []), ...input.questions]),
    ];
    await client.query(
      `UPDATE decision_proposals
       SET status = 'clarified', clarifying_questions_json = $2
       WHERE id = $1`,
      [proposal.id, JSON.stringify(questions)],
    );
    await client.query(`UPDATE tickets SET status = 'needs_clarification' WHERE id = $1`, [
      proposal.ticket_id,
    ]);
    await writeDecisionAudit(client, {
      proposalId: proposal.id,
      actorId: userId,
      action: "clarified",
      reason: input.reason,
      before: { status: proposal.status, questions: proposal.clarifying_questions_json },
      after: { status: "clarified", questions },
    });
    await writeProjectAudit(client, {
      projectId: proposal.project_id,
      actorId: userId,
      action: "decision.clarified",
      entityType: "decision",
      entityId: proposal.id,
      summary: `Clarification requested on decision ${proposal.id}: ${input.reason}`,
    });
  });

  const proposal = await getDecisionProposal(userId, proposalId);
  return {
    proposal,
    scenario: null,
    planVersionNumber: null,
    audit: await latestAudit({ query } as never, proposalId),
    message: "Clarification requested. The plan was not changed.",
  };
}


export interface DecisionQueueItem {
  id: string;
  projectId: string;
  projectName: string;
  ticketId: string;
  ticketTitle: string;
  status: string;
  recommendation: DecisionOption;
  priority: string;
  createdAt: string;
}

export async function listDecisionQueue(
  userId: string,
  workspaceId: string,
  status: "pending" | "all" = "pending",
): Promise<DecisionQueueItem[]> {
  await assertWorkspaceAccess(userId, workspaceId);
  const result = await query<{
    id: string;
    project_id: string;
    project_name: string;
    ticket_id: string;
    ticket_title: string;
    status: string;
    recommendation: DecisionOption;
    priority: string;
    created_at: string;
  }>(
    `SELECT dp.id, dp.project_id, p.name AS project_name, dp.ticket_id,
            t.title AS ticket_title, dp.status, dp.recommendation,
            COALESCE(t.severity_reported, 'medium') AS priority, dp.created_at
     FROM decision_proposals dp
     JOIN tickets t ON t.id = dp.ticket_id
     JOIN projects p ON p.id = dp.project_id
     LEFT JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
     LEFT JOIN workspace_members wm ON wm.workspace_id = p.workspace_id AND wm.user_id = $1
     LEFT JOIN organization_members om
       ON om.organization_id = COALESCE(p.organization_id, w.organization_id) AND om.user_id = $1
     WHERE p.workspace_id = $2
       AND (pm.user_id = $1 OR wm.user_id = $1 OR om.user_id = $1)
       AND ($3::text = 'all' OR dp.status = 'pending')
     ORDER BY CASE dp.recommendation WHEN 'accept' THEN 0 WHEN 'split' THEN 1 WHEN 'clarify' THEN 2 ELSE 3 END,
              dp.created_at DESC
     LIMIT 100`,
    [userId, workspaceId, status],
  );
  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    ticketId: row.ticket_id,
    ticketTitle: row.ticket_title,
    status: row.status,
    recommendation: row.recommendation,
    priority: row.priority,
    createdAt: row.created_at,
  }));
}
