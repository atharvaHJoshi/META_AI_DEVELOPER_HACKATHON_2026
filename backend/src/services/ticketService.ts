import {
  DecisionProposalSchema,
  ProposedChangeSchema,
  TicketDetailSchema,
  type CreateTicketInput,
  type DecisionProposal,
  type ProposedChange,
  type TicketAnalysis,
  type TicketDetail,
} from "@miraiwerk/schemas";
import { simulateScenario, OPTION_LABELS } from "@miraiwerk/ripplemap";
import { ZodError } from "zod";
import {
  applyPolicy,
  demoAnalyzeTicket,
  geminiAnalyzeTicket,
  metaAnalyzeTicket,
  MetaError,
  GeminiError,
  type AnalysisContext,
  type TicketAnalysisResult,
} from "@miraiwerk/aiml";
import { aiMode, config } from "../config.js";
import { assertProjectAccess } from "../auth.js";
import { one, query, withTransaction, type Queryable } from "../db/pool.js";
import type {
  PlanBundle,
} from "../db/snapshot.js";
import { buildGraph, constraintsOf, loadPlanBundle } from "../db/snapshot.js";
import type {
  ProposalRow,
  ScenarioRow,
  TicketRow,
} from "../db/rows.js";
import { ApiError, newId } from "../lib/http.js";
import { recordAiCall } from "./planService.js";

const CONTRIBUTOR_ROLES = ["owner", "pm", "member"] as const;
const ALL_OPTIONS = ["accept", "defer", "clarify", "duplicate"] as const;

interface TicketWithLabel extends TicketRow {
  project_name?: string;
}

function mapTicket(row: TicketRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    source: row.source,
    ticketType: row.ticket_type as never,
    affectedComponent: row.affected_component,
    reportedImpact: row.reported_impact,
    evidence: row.evidence,
    reporter: row.reporter,
    environment: row.environment,
    severityReported: row.severity_reported,
    status: row.status as never,
    createdBy: row.created_by,
    createdAt: row.created_at,
    analyzedAt: row.analyzed_at,
  };
}

function mapProposal(row: ProposalRow, scenarios: ScenarioRow[]): DecisionProposal {
  return DecisionProposalSchema.parse({
    id: row.id,
    ticketId: row.ticket_id,
    projectId: row.project_id,
    basePlanVersion: row.base_plan_version,
    recommendation: row.recommendation,
    summary: row.summary,
    classification: row.classification_json,
    policy: row.policy_json,
    evidence: row.evidence_json,
    unknowns: row.unknowns_json,
    clarifyingQuestions: row.clarifying_questions_json,
    relatedRecords: row.related_records_json,
    duplicateCandidates: row.duplicate_candidates_json,
    proposedChanges: row.proposed_changes_json,
    status: row.status as never,
    modelProvider: row.model_provider as never,
    modelName: row.model_name,
    modelMeta: row.model_meta_json,
    recommendationRationale: row.recommendation_rationale,
    createdAt: row.created_at,
    scenarioRuns: scenarios.map((scenario) => ({
      id: scenario.id,
      option: scenario.option as never,
      label: scenario.label,
      valid: scenario.valid,
      output: scenario.output_json,
      inputHash: scenario.input_hash,
      createdAt: scenario.created_at,
    })),
  });
}

export async function loadTicketRow(
  client: Queryable,
  ticketId: string,
): Promise<TicketRow | null> {
  const result = await client.query<TicketRow>(
    `SELECT * FROM tickets WHERE id = $1`,
    [ticketId],
  );
  return result.rows[0] ?? null;
}

export async function loadProposalRow(
  client: Queryable,
  proposalId: string,
): Promise<ProposalRow | null> {
  const result = await client.query<ProposalRow>(
    `SELECT * FROM decision_proposals WHERE id = $1`,
    [proposalId],
  );
  return result.rows[0] ?? null;
}

async function loadScenarios(
  client: Queryable,
  proposalIds: string[],
): Promise<ScenarioRow[]> {
  if (proposalIds.length === 0) return [];
  const result = await client.query<ScenarioRow>(
    `SELECT * FROM scenario_runs
     WHERE proposal_id = ANY($1::text[])
     ORDER BY created_at ASC`,
    [proposalIds],
  );
  return result.rows;
}

async function getLatestProposal(
  client: Queryable,
  ticketId: string,
): Promise<ProposalRow | null> {
  const result = await client.query<ProposalRow>(
    `SELECT * FROM decision_proposals
     WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [ticketId],
  );
  return result.rows[0] ?? null;
}

export async function getDecisionProposal(
  userId: string,
  proposalId: string,
): Promise<DecisionProposal> {
  const row = await loadProposalRow({ query } as never, proposalId);
  if (!row) throw new ApiError(404, "DECISION_NOT_FOUND", "Decision proposal not found.");
  await assertProjectAccess(userId, row.project_id);
  const scenarios = await loadScenarios({ query } as never, [row.id]);
  return mapProposal(row, scenarios);
}

export async function getTicketDetail(
  userId: string,
  ticketId: string,
): Promise<TicketDetail> {
  const client = { query } as never;
  const row = await loadTicketRow(client, ticketId);
  if (!row) throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");
  await assertProjectAccess(userId, row.project_id);

  const [links, proposal, audits] = await Promise.all([
    query<{
      id: string;
      ticket_id: string;
      entity_type: string;
      entity_id: string;
      entity_label: string | null;
      relationship_type: string;
      evidence_state: string;
      rationale: string;
      confirmed: boolean;
    }>(
      `SELECT tl.id, tl.ticket_id, tl.entity_type, tl.entity_id,
              CASE tl.entity_type
                WHEN 'requirement' THEN (SELECT title FROM requirements WHERE id = tl.entity_id)
                WHEN 'task' THEN (SELECT title FROM tasks WHERE id = tl.entity_id)
                WHEN 'milestone' THEN (SELECT title FROM milestones WHERE id = tl.entity_id)
                WHEN 'ticket' THEN (SELECT title FROM tickets WHERE id = tl.entity_id)
              END AS entity_label,
              tl.relationship_type, tl.evidence_state, tl.rationale, tl.confirmed
       FROM ticket_links tl WHERE tl.ticket_id = $1 ORDER BY tl.created_at ASC`,
      [ticketId],
    ),
    getLatestProposal(client, ticketId),
    query<{
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
       FROM decision_audit da
       LEFT JOIN users u ON u.id = da.actor_id
       WHERE da.decision_id IN (
         SELECT id FROM decision_proposals WHERE ticket_id = $1
       )
       ORDER BY da.timestamp ASC`,
      [ticketId],
    ),
  ]);

  const scenarios = proposal ? await loadScenarios({ query } as never, [proposal.id]) : [];

  return TicketDetailSchema.parse({
    ticket: mapTicket(row),
    links: links.rows.map((link) => ({
      id: link.id,
      ticketId: link.ticket_id,
      entityType: link.entity_type,
      entityId: link.entity_id,
      entityLabel: link.entity_label,
      relationshipType: link.relationship_type,
      evidenceState: link.evidence_state,
      rationale: link.rationale,
      confirmed: link.confirmed,
    })),
    proposal: proposal ? mapProposal(proposal, scenarios) : null,
    audits: audits.rows.map((audit) => ({
      id: audit.id,
      decisionId: audit.decision_id,
      actorId: audit.actor_id,
      actorName: audit.actor_name,
      action: audit.action,
      reason: audit.reason,
      beforeJson: audit.before_json,
      afterJson: audit.after_json,
      timestamp: audit.timestamp,
    })),
  });
}

export async function createTicket(
  userId: string,
  input: CreateTicketInput,
): Promise<TicketDetail> {
  await assertProjectAccess(userId, input.projectId, [...CONTRIBUTOR_ROLES]);

  const id = newId("tkt");
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO tickets
        (id, project_id, title, description, source, ticket_type, affected_component,
         reported_impact, evidence, reporter, environment, severity_reported, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new',$13)`,
      [
        id,
        input.projectId,
        input.title,
        input.description,
        input.source,
        input.ticketType ?? null,
        input.affectedComponent ?? "",
        input.reportedImpact ?? "",
        input.evidence ?? "",
        input.reporter || input.source,
        input.environment ?? "",
        input.severityReported,
        userId,
      ],
    );
    await client.query(
      `INSERT INTO audit_events
        (id, project_id, actor_id, action, entity_type, entity_id, summary)
       VALUES ($1,$2,$3,'ticket.created','ticket',$4,$5)`,
      [
        newId("audit"),
        input.projectId,
        userId,
        id,
        `Ticket created from ${input.source}: ${input.title}`,
      ],
    );
  });

  return getTicketDetail(userId, id);
}

function buildAnalysisContext(
  bundle: PlanBundle,
  ticket: TicketRow,
  relatedTickets: AnalysisContext["relatedTickets"],
): AnalysisContext {
  const upstream = new Map<string, string[]>();
  const downstream = new Map<string, string[]>();
  for (const dependency of bundle.dependencies) {
    const next = downstream.get(dependency.predecessor_task_id) ?? [];
    next.push(dependency.successor_task_id);
    downstream.set(dependency.predecessor_task_id, next);
    const previous = upstream.get(dependency.successor_task_id) ?? [];
    previous.push(dependency.predecessor_task_id);
    upstream.set(dependency.successor_task_id, previous);
  }
  const milestoneTitle = new Map(
    bundle.milestones.map((milestone) => [milestone.id, milestone.title]),
  );

  return {
    project: {
      id: bundle.project.id,
      name: bundle.project.name,
      description: bundle.project.description,
      goal: bundle.project.goal,
      startDate: bundle.project.start_date,
      targetDate: bundle.project.target_date,
      planVersion: bundle.project.current_plan_version,
      constraints: constraintsOf(bundle.project),
      currentPlanAssumptions: bundle.assumptions,
    },
    requirements: bundle.requirements.map((requirement) => ({
      id: requirement.id,
      title: requirement.title,
      description: requirement.description,
      acceptanceCriteria: requirement.acceptance_criteria ?? [],
    })),
    milestones: bundle.milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      targetDate: milestone.target_date,
      releaseGate: milestone.release_gate,
    })),
    tasks: bundle.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      estimateDays: Number(task.estimate_days),
      requirementId: task.requirement_id,
      milestoneId: task.milestone_id,
      milestoneTitle: task.milestone_id
        ? (milestoneTitle.get(task.milestone_id) ?? null)
        : null,
      plannedStart: task.planned_start,
      plannedFinish: task.planned_finish,
      downstreamTaskIds: downstream.get(task.id) ?? [],
      upstreamTaskIds: upstream.get(task.id) ?? [],
    })),
    relatedTickets,
    ticket: {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      source: ticket.source,
      affectedComponent: ticket.affected_component,
      reportedImpact: ticket.reported_impact,
      evidence: ticket.evidence,
      reporter: ticket.reporter,
      environment: ticket.environment,
      severityReported: ticket.severity_reported,
      createdAt: ticket.created_at,
    },
  };
}

async function analyzeWithAi(
  context: AnalysisContext,
  projectId: string,
  workspaceId: string | null,
): Promise<TicketAnalysisResult> {
  const record = async (result: TicketAnalysisResult) => {
    await recordAiCall({
      projectId,
      workspaceId,
      workflow: "ticket_analysis",
      provider: result.provider,
      model: result.model,
      durationMs: result.latencyMs,
      success: true,
      degraded: result.degraded,
      error: null,
      usage: result.usage,
    });
  };

  if (aiMode.provider === "deterministic-demo") {
    const result = demoAnalyzeTicket(context);
    await record(result);
    return result;
  }

  const providerLabel = aiMode.provider === "gemini" ? "Gemini" : "Meta Model API";
  try {
    const result =
      aiMode.provider === "gemini"
        ? await geminiAnalyzeTicket(context)
        : await metaAnalyzeTicket(context);
    await record(result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown model error";
    const providerError =
      error instanceof MetaError || error instanceof GeminiError || error instanceof ZodError;
    if (config.aiFallbackOnError && providerError) {
      const result = demoAnalyzeTicket(context);
      const fallback: TicketAnalysisResult = {
        ...result,
        degraded: true,
        notice: `${providerLabel} analysis failed (${message.slice(0, 220)}). MIRAIWERK used labelled deterministic rules; no ${providerLabel} output is claimed.`,
      };
      await record(fallback);
      return fallback;
    }
    await recordAiCall({
      projectId,
      workspaceId,
      workflow: "ticket_analysis",
      provider: aiMode.provider,
      model: aiMode.model,
      durationMs: 0,
      success: false,
      degraded: false,
      error: message,
      usage: null,
    });
    throw new ApiError(
      502,
      "MODEL_UNAVAILABLE",
      "The configured AI provider is unavailable. The ticket was saved but no proposal was created.",
    );
  }
}

interface Sanitized {
  analysis: TicketAnalysis;
  warnings: string[];
}

function sanitizeAnalysis(
  analysis: TicketAnalysis,
  context: AnalysisContext,
): Sanitized {
  const warnings: string[] = [];
  const requirementIds = new Set(context.requirements.map((item) => item.id));
  const milestoneIds = new Set(context.milestones.map((item) => item.id));
  const taskIds = new Set(context.tasks.map((item) => item.id));
  const ticketIds = new Set(context.relatedTickets.map((item) => item.id));

  const relatedRecords = analysis.relatedRecords.filter((record) => {
    const valid =
      (record.entityType === "requirement" && requirementIds.has(record.entityId)) ||
      (record.entityType === "task" && taskIds.has(record.entityId)) ||
      (record.entityType === "milestone" && milestoneIds.has(record.entityId)) ||
      (record.entityType === "ticket" && ticketIds.has(record.entityId));
    if (!valid) {
      warnings.push(
        `Discarded a proposed ${record.entityType} link to unknown record "${record.entityId}".`,
      );
    }
    return valid;
  });

  const evidence = analysis.evidence.map((item) => {
    if (item.sourceType !== "project" || !item.sourceId) return item;
    const valid =
      requirementIds.has(item.sourceId) ||
      milestoneIds.has(item.sourceId) ||
      taskIds.has(item.sourceId);
    if (valid) return item;
    warnings.push(`Detached evidence from unknown project record "${item.sourceId}".`);
    return { ...item, sourceId: null };
  });

  const duplicateCandidates = analysis.duplicateCandidates.filter((candidate) => {
    if (ticketIds.has(candidate.ticketId)) return true;
    warnings.push(`Discarded duplicate candidate "${candidate.ticketId}" outside this project.`);
    return false;
  });

  const sanitizeChange = (change: ProposedChange | null): ProposedChange | null => {
    if (!change) return null;
    const addedTempIds = new Set<string>();
    const tasksToAdd = [];
    for (const task of change.tasksToAdd) {
      if (addedTempIds.has(task.tempId) || taskIds.has(task.tempId)) {
        warnings.push(`Discarded duplicate proposed tempId "${task.tempId}".`);
        continue;
      }
      addedTempIds.add(task.tempId);
      tasksToAdd.push({
        ...task,
        requirementId:
          task.requirementId && requirementIds.has(task.requirementId)
            ? task.requirementId
            : null,
        milestoneId:
          task.milestoneId && milestoneIds.has(task.milestoneId)
            ? task.milestoneId
            : null,
        dependencies: task.dependencies.filter(
          (id) => taskIds.has(id) || addedTempIds.has(id),
        ),
      });
    }
    return ProposedChangeSchema.parse({
      ...change,
      tasksToAdd,
      tasksToUpdate: change.tasksToUpdate.filter((update) => taskIds.has(update.taskId)),
      tasksToRemove: change.tasksToRemove.filter((id) => taskIds.has(id)),
      dependenciesToAdd: change.dependenciesToAdd.filter(
        (dep) =>
          (taskIds.has(dep.predecessorId) || addedTempIds.has(dep.predecessorId)) &&
          (taskIds.has(dep.successorId) || addedTempIds.has(dep.successorId)),
      ),
    });
  };

  let recommendation = analysis.recommendedOption;
  let rationale = analysis.recommendationRationale;
  const split = sanitizeChange(analysis.proposedChanges.split);
  if (recommendation === "split" && !split) {
    recommendation = "accept";
    rationale = `${rationale} The model did not supply a split proposal, so MIRAIWERK shows the accept scenario instead.`;
    warnings.push("Recommended split without a split change; fell back to the accept proposal.");
  }

  return {
    analysis: {
      ...analysis,
      recommendedOption: recommendation,
      recommendationRationale: rationale,
      relatedRecords,
      evidence,
      duplicateCandidates,
      proposedChanges: {
        accept: sanitizeChange(analysis.proposedChanges.accept)!,
        split,
      },
    },
    warnings,
  };
}

function emptyChange(option: "defer" | "clarify" | "duplicate"): ProposedChange {
  return ProposedChangeSchema.parse({
    option,
    tasksToAdd: [],
    tasksToUpdate: [],
    tasksToRemove: [],
    dependenciesToAdd: [],
    assumptions: [],
    rationale: `${OPTION_LABELS[option]} without changing the current plan.`,
  });
}

function changeForOption(
  option: ProposedChange["option"],
  analysis: TicketAnalysis,
): ProposedChange | null {
  if (option === "accept") return analysis.proposedChanges.accept;
  if (option === "split") return analysis.proposedChanges.split;
  if (option === "defer" || option === "clarify" || option === "duplicate") {
    return emptyChange(option);
  }
  return null;
}

export async function analyzeTicket(
  userId: string,
  ticketId: string,
): Promise<TicketDetail> {
  const row = await loadTicketRow({ query } as never, ticketId);
  if (!row) throw new ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.");
  await assertProjectAccess(userId, row.project_id, [...CONTRIBUTOR_ROLES]);

  const bundle = await loadPlanBundle({ query } as never, row.project_id);
  if (!bundle) throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");

  const related = await query<{
    id: string;
    title: string;
    description: string;
    ticket_type: string | null;
    status: string;
    created_at: string;
  }>(
    `SELECT id, title, description, ticket_type, status, created_at
     FROM tickets WHERE project_id = $1 AND id <> $2
     ORDER BY created_at DESC LIMIT 50`,
    [row.project_id, ticketId],
  );

  const context = buildAnalysisContext(
    bundle,
    row,
    related.rows.map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      ticketType: ticket.ticket_type,
      status: ticket.status,
      createdAt: ticket.created_at,
    })),
  );

  await query(
    `UPDATE tickets SET status = 'analyzing' WHERE id = $1`,
    [ticketId],
  );

  const projectWorkspace = await one<{ workspace_id: string | null }>(
    `SELECT workspace_id FROM projects WHERE id = $1`,
    [row.project_id],
  );
  let result: TicketAnalysisResult;
  try {
    result = await analyzeWithAi(context, row.project_id, projectWorkspace?.workspace_id ?? null);
  } catch (error) {
    await query(
      `UPDATE tickets SET status = 'analysis_failed', analyzed_at = now() WHERE id = $1`,
      [ticketId],
    );
    await query(
      `INSERT INTO audit_events
        (id, project_id, actor_id, action, entity_type, entity_id, summary)
       VALUES ($1,$2,$3,'ticket.analysis_failed','ticket',$4,$5)`,
      [
        newId("audit"),
        row.project_id,
        userId,
        ticketId,
        error instanceof Error ? error.message : "Ticket analysis failed.",
      ],
    );
    throw error;
  }

  const sanitized = sanitizeAnalysis(result.analysis, context);
  const policy = applyPolicy(sanitized.analysis, context);
  const classification = policy.classification;
  const analysis: TicketAnalysis = {
    ...sanitized.analysis,
    classification,
  };
  const warnings = sanitized.warnings;

  const proposalId = newId("dec");
  const graph = buildGraph(bundle);
  const relatedTaskIds = analysis.relatedRecords
    .filter((record) => record.entityType === "task")
    .map((record) => record.entityId)
    .sort();
  const targetMilestoneId =
    analysis.relatedRecords.find((record) => record.entityType === "milestone")?.entityId ??
    bundle.tasks.find(
      (task) =>
        task.milestone_id &&
        relatedTaskIds.includes(task.id),
    )?.milestone_id ??
    null;

  const options: Array<ProposedChange["option"]> = [...ALL_OPTIONS];
  if (analysis.proposedChanges.split) {
    options.splice(1, 0, "split");
  }

  const scenarios = options
    .map((option) => {
      const change = changeForOption(option, analysis);
      if (!change) return null;
      const scenario = simulateScenario(graph, {
        change,
        targetMilestoneId,
        relatedTaskIds,
        ticketId,
      });
      return { option, scenario };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const displaySummary =
    warnings.length > 0
      ? `${classification.summary} (${warnings.length} invalid model reference(s) were discarded.)`
      : classification.summary;

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE decision_proposals SET status = 'superseded'
       WHERE ticket_id = $1 AND status = 'pending'`,
      [ticketId],
    );

    await client.query(
      `INSERT INTO decision_proposals
        (id, ticket_id, project_id, base_plan_version, recommendation, summary,
         classification_json, policy_json, evidence_json, unknowns_json,
         clarifying_questions_json, related_records_json, duplicate_candidates_json,
         proposed_changes_json, recommendation_rationale, status, model_provider,
         model_name, model_meta_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',$16,$17,$18)`,
      [
        proposalId,
        ticketId,
        row.project_id,
        bundle.project.current_plan_version,
        analysis.recommendedOption,
        displaySummary,
        JSON.stringify(classification),
        JSON.stringify(policy.policy),
        JSON.stringify(analysis.evidence),
        JSON.stringify(analysis.unknowns),
        JSON.stringify(analysis.clarifyingQuestions),
        JSON.stringify(analysis.relatedRecords),
        JSON.stringify(analysis.duplicateCandidates),
        JSON.stringify(analysis.proposedChanges),
        analysis.recommendationRationale,
        result.provider,
        result.model,
        JSON.stringify({
          degraded: result.degraded,
          latencyMs: result.latencyMs,
          notice: result.notice,
          toolCalls: result.toolCalls.map((call) => call.name),
        }),
      ],
    );

    for (const record of analysis.relatedRecords) {
      await client.query(
        `INSERT INTO ticket_links
          (id, ticket_id, entity_type, entity_id, relationship_type, evidence_state, rationale)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          newId("link"),
          ticketId,
          record.entityType,
          record.entityId,
          record.relationshipType,
          record.evidenceState,
          record.rationale,
        ],
      );
    }

    for (const { option, scenario } of scenarios) {
      await client.query(
        `INSERT INTO scenario_runs
          (id, proposal_id, option, label, input_hash, output_json, valid, validation_errors_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          newId("scn"),
          proposalId,
          option,
          scenario.label,
          scenario.inputHash,
          JSON.stringify(scenario),
          scenario.valid,
          JSON.stringify(scenario.validationErrors),
        ],
      );
    }

    await client.query(
      `UPDATE tickets
       SET status = $2, ticket_type = $3, analyzed_at = now()
       WHERE id = $1`,
      [
        ticketId,
        analysis.recommendedOption === "clarify" ? "needs_clarification" : "analyzed",
        classification.ticketType,
      ],
    );

    await client.query(
      `INSERT INTO audit_events
        (id, project_id, actor_id, action, entity_type, entity_id, summary)
       VALUES ($1,$2,$3,'ticket.analyzed','ticket',$4,$5)`,
      [
        newId("audit"),
        row.project_id,
        userId,
        ticketId,
        `Ticket analysed with ${result.provider === "gemini"
          ? `Gemini ${result.model}`
          : result.provider === "meta"
            ? `Meta ${result.model}`
            : "deterministic rules"}${result.degraded ? " (degraded fallback)" : ""}. Recommendation: ${analysis.recommendedOption}. Final priority: ${classification.priority}.`,
      ],
    );
    await client.query(
      `INSERT INTO audit_events
        (id, project_id, actor_id, action, entity_type, entity_id, summary)
       VALUES ($1,$2,$3,'decision.proposed','decision',$4,$5)`,
      [
        newId("audit"),
        row.project_id,
        userId,
        proposalId,
        `Draft decision proposal ${proposalId} created against plan version ${bundle.project.current_plan_version}.`,
      ],
    );
  });

  return getTicketDetail(userId, ticketId);
}

export function currentAiMode() {
  return aiMode;
}
