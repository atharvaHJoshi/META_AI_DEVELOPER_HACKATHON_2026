import type {
  DecisionOption,
  ProposedChange,
  ScenarioResult,
} from "@miraiwerk/schemas";
import { ProposedChangeSchema } from "@miraiwerk/schemas";
import { simulateScenario, OPTION_LABELS } from "@miraiwerk/ripplemap";
import { assertProjectAccess } from "../auth.js";
import { query, withTransaction, type Queryable } from "../db/pool.js";
import type { PlanBundle } from "../db/snapshot.js";
import { buildGraph, loadPlanBundle } from "../db/snapshot.js";
import type { ProposalRow, ScenarioRow } from "../db/rows.js";
import { ApiError, newId } from "../lib/http.js";
import { loadProposalRow } from "./ticketService.js";

export interface ScenarioComputation {
  scenario: ScenarioResult;
  change: ProposedChange;
}

export function emptyOptionChange(option: DecisionOption): ProposedChange {
  return ProposedChangeSchema.parse({
    option,
    tasksToAdd: [],
    tasksToUpdate: [],
    tasksToRemove: [],
    dependenciesToAdd: [],
    assumptions: [OPTION_LABELS[option]],
    rationale: `${OPTION_LABELS[option]} does not mutate the stored plan.`,
  });
}

export function changeForProposalOption(
  proposal: ProposalRow,
  option: DecisionOption,
): ProposedChange {
  const changes = proposal.proposed_changes_json as {
    accept?: unknown;
    split?: unknown;
  };
  if (option === "accept") {
    return ProposedChangeSchema.parse(changes.accept);
  }
  if (option === "split") {
    if (!changes.split) {
      throw new ApiError(
        422,
        "SPLIT_NOT_AVAILABLE",
        "This proposal does not contain a split option.",
      );
    }
    return ProposedChangeSchema.parse(changes.split);
  }
  return emptyOptionChange(option);
}

function relatedContext(proposal: ProposalRow, bundle: PlanBundle) {
  const records = (proposal.related_records_json ?? []) as Array<{
    entityType?: string;
    entityId?: string;
  }>;
  const relatedTaskIds = records
    .filter((record) => record.entityType === "task" && record.entityId)
    .map((record) => record.entityId as string)
    .sort();
  const targetMilestoneId =
    records.find(
      (record) => record.entityType === "milestone" && record.entityId,
    )?.entityId ??
    bundle.tasks.find(
      (task) => task.milestone_id && relatedTaskIds.includes(task.id),
    )?.milestone_id ??
    null;
  return { relatedTaskIds, targetMilestoneId };
}

export function computeScenario(
  bundle: PlanBundle,
  proposal: ProposalRow,
  option: DecisionOption,
): ScenarioComputation {
  const change = changeForProposalOption(proposal, option);
  const graph = buildGraph(bundle);
  const { relatedTaskIds, targetMilestoneId } = relatedContext(proposal, bundle);
  const scenario = simulateScenario(graph, {
    change,
    targetMilestoneId,
    relatedTaskIds,
    ticketId: proposal.ticket_id,
  });
  return { scenario, change };
}

export async function persistScenario(
  client: Queryable,
  proposalId: string,
  scenario: ScenarioResult,
): Promise<void> {
  await client.query(
    `INSERT INTO scenario_runs
      (id, proposal_id, option, label, input_hash, output_json, valid, validation_errors_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      newId("scn"),
      proposalId,
      scenario.option,
      scenario.label,
      scenario.inputHash,
      JSON.stringify(scenario),
      scenario.valid,
      JSON.stringify(scenario.validationErrors),
    ],
  );
}

export async function getLatestScenario(
  client: Queryable,
  proposalId: string,
  option: DecisionOption,
): Promise<ScenarioRow | null> {
  const result = await client.query<ScenarioRow>(
    `SELECT * FROM scenario_runs
     WHERE proposal_id = $1 AND option = $2
     ORDER BY created_at DESC LIMIT 1`,
    [proposalId, option],
  );
  return result.rows[0] ?? null;
}

export async function markProposalStale(
  client: Queryable,
  proposal: ProposalRow,
  actorId: string | null,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE decision_proposals SET status = 'stale' WHERE id = $1`,
    [proposal.id],
  );
  await client.query(
    `INSERT INTO decision_audit
      (id, decision_id, actor_id, action, reason, before_json, after_json)
     VALUES ($1,$2,$3,'stale',$4,$5,$6)`,
    [
      newId("da"),
      proposal.id,
      actorId,
      reason,
      JSON.stringify({
        status: proposal.status,
        basePlanVersion: proposal.base_plan_version,
      }),
      JSON.stringify({ status: "stale" }),
    ],
  );
}

async function currentPlanVersion(client: Queryable, projectId: string): Promise<number> {
  const result = await client.query<{ current_plan_version: number }>(
    `SELECT current_plan_version FROM projects WHERE id = $1`,
    [projectId],
  );
  if (!result.rows[0]) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
  }
  return result.rows[0].current_plan_version;
}

export async function simulateDecision(
  userId: string,
  proposalId: string,
  option: DecisionOption,
  baselineVersion?: number,
): Promise<ScenarioResult> {
  const proposal = await loadProposalRow({ query } as never, proposalId);
  if (!proposal) throw new ApiError(404, "DECISION_NOT_FOUND", "Decision proposal not found.");
  await assertProjectAccess(userId, proposal.project_id, ["owner", "pm", "member"]);
  if (proposal.status !== "pending") {
    throw new ApiError(
      409,
      "DECISION_NOT_PENDING",
      `This proposal is ${proposal.status} and can no longer be simulated.`,
    );
  }

  return withTransaction(async (client) => {
    const locked = await client.query<ProposalRow>(
      `SELECT * FROM decision_proposals WHERE id = $1 FOR UPDATE`,
      [proposalId],
    );
    const row = locked.rows[0]!;
    if (row.status !== "pending") {
      throw new ApiError(409, "DECISION_NOT_PENDING", "This proposal is no longer pending.");
    }
    const version = await currentPlanVersion(client, row.project_id);
    if (baselineVersion !== undefined && baselineVersion !== row.base_plan_version) {
      throw new ApiError(
        409,
        "BASELINE_VERSION_MISMATCH",
        `The proposal was computed against plan version ${row.base_plan_version}; the request expected version ${baselineVersion}.`,
      );
    }
    if (version !== row.base_plan_version) {
      await markProposalStale(
        client,
        row,
        userId,
        `Plan version ${version} is newer than proposal baseline ${row.base_plan_version}.`,
      );
      throw new ApiError(
        409,
        "STALE_PROPOSAL",
        `The plan moved to version ${version} after this proposal was generated. Re-analyse the ticket to regenerate the decision.`,
      );
    }
    const bundle = await loadPlanBundle(client, row.project_id);
    if (!bundle) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
    const { scenario } = computeScenario(bundle, row, option);
    await persistScenario(client, row.id, scenario);
    return scenario;
  });
}
