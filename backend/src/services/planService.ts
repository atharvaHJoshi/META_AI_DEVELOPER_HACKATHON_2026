import type {
  GeneratePlanInput,
  GeneratedPlan,
  PlanDraft,
  ProjectGraph,
} from "@miraiwerk/schemas";
import { GraphDependencySchema, GraphMilestoneSchema, GraphTaskSchema, ProjectGraphSchema } from "@miraiwerk/schemas";
import { validateGraph } from "@miraiwerk/ripplemap";
import {
  DETERMINISTIC_MODEL,
  demoPlan,
  geminiGeneratePlan,
  metaGeneratePlan,
  MetaError,
  GeminiError,
  type PlanInput,
  type Usage,
} from "@miraiwerk/aiml";
import { config, aiMode } from "../config.js";
import { ZodError } from "zod";
import { query } from "../db/pool.js";
import { ApiError, newId } from "../lib/http.js";
import type { PlanValidation } from "@miraiwerk/schemas";

export function buildProjectGraphFromDraft(draft: PlanDraft): ProjectGraph {
  return ProjectGraphSchema.parse({
    projectId: "draft",
    startDate: draft.startDate,
    targetDate: draft.targetDate,
    tasks: draft.tasks.map((task) =>
      GraphTaskSchema.parse({
        id: task.tempId,
        title: task.title,
        description: task.description,
        requirementId: task.requirementTempId,
        milestoneId: task.milestoneTempId,
        estimateDays: task.estimateDays,
        priority: task.priority,
        status: "planned",
        ownerRole: task.ownerRole,
        plannedStart: null,
        plannedFinish: null,
        sourceTicketId: null,
      }),
    ),
    milestones: draft.milestones.map((milestone) =>
      GraphMilestoneSchema.parse({
        id: milestone.tempId,
        title: milestone.title,
        targetDate: milestone.targetDate,
        releaseGate: milestone.releaseGate,
      }),
    ),
    dependencies: draft.tasks.flatMap((task) =>
      task.dependencies.map((dependency) =>
        GraphDependencySchema.parse({
          predecessorId: dependency,
          successorId: task.tempId,
          dependencyType: "finishes_to_start",
        }),
      ),
    ),
    constraints: {},
  });
}

export function validatePlanDraft(draft: PlanDraft): PlanValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const requirementIds = new Set(draft.requirements.map((requirement) => requirement.tempId));
  const taskIds = new Set(draft.tasks.map((task) => task.tempId));

  if (taskIds.size !== draft.tasks.length) {
    errors.push("Task tempIds must be unique.");
  }
  for (const task of draft.tasks) {
    if (task.requirementTempId && !requirementIds.has(task.requirementTempId)) {
      errors.push(`Task "${task.title}" references an unknown requirement.`);
    }
    for (const dependency of task.dependencies) {
      if (!taskIds.has(dependency)) {
        errors.push(`Task "${task.title}" depends on unknown task "${dependency}".`);
      }
    }
  }
  if (draft.targetDate && draft.startDate > draft.targetDate) {
    errors.push("The project start date must be before the target date.");
  }
  for (const milestone of draft.milestones) {
    if (milestone.targetDate && milestone.targetDate < draft.startDate) {
      warnings.push(
        `Milestone "${milestone.title}" has a target date before the project start.`,
      );
    }
    if (milestone.targetDate && draft.targetDate && milestone.targetDate > draft.targetDate) {
      warnings.push(
        `Milestone "${milestone.title}" is targeted after the project target date.`,
      );
    }
  }

  const graph = buildProjectGraphFromDraft(draft);
  const graphValidation = validateGraph(graph);
  errors.push(...graphValidation.errors);
  warnings.push(...graphValidation.warnings);

  if (!draft.tasks.some((task) => task.dependencies.length > 0) && draft.tasks.length > 2) {
    warnings.push("No task has a dependency; the generated plan cannot show ripple effects.");
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    cycles: graphValidation.cycles,
  };
}

export async function recordAiCall(input: {
  projectId: string | null;
  workspaceId?: string | null;
  organizationId?: string | null;
  workflow: "plan_generation" | "ticket_analysis" | "assistant";
  provider: "gemini" | "meta" | "deterministic-demo";
  model: string;
  durationMs: number;
  success: boolean;
  degraded: boolean;
  error: string | null;
  usage: Usage | null;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO ai_calls
        (id, project_id, workspace_id, organization_id, workflow, provider, model,
         duration_ms, success, degraded, error, usage_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        newId("ai"),
        input.projectId,
        input.workspaceId ?? null,
        input.organizationId ?? null,
        input.workflow,
        input.provider,
        input.model,
        input.durationMs,
        input.success,
        input.degraded,
        input.error,
        input.usage ? JSON.stringify(input.usage) : null,
      ],
    );
  } catch (error) {
    console.error("Failed to record AI call telemetry", error);
  }
}

function toPlanInput(input: GeneratePlanInput): PlanInput {
  return {
    name: input.name,
    goal: input.goal,
    description: input.description,
    startDate: input.startDate,
    targetDate: input.targetDate ?? null,
    constraints: input.constraints ?? {},
  };
}

function deterministicResult(
  input: PlanInput,
  options: { degraded: boolean; notice: string | null; latencyMs: number },
): GeneratedPlan {
  const draft = demoPlan(input);
  const validation = validatePlanDraft(draft);
  if (!validation.valid) {
    throw new ApiError(
      500,
      "DEMO_PLAN_INVALID",
      "The deterministic fallback generated an invalid plan.",
      validation,
    );
  }
  return {
    draft,
    provider: "deterministic-demo",
    model: DETERMINISTIC_MODEL,
    degraded: options.degraded,
    notice: options.notice,
    latencyMs: options.latencyMs,
    usage: null,
  };
}

function providerLabel(): string {
  return aiMode.provider === "gemini" ? "Gemini" : "Meta Model API";
}

async function callPlanProvider(
  planInput: PlanInput,
  feedback?: string,
): Promise<Awaited<ReturnType<typeof metaGeneratePlan>>> {
  if (aiMode.provider === "gemini") return geminiGeneratePlan(planInput, feedback);
  if (aiMode.provider === "meta") return metaGeneratePlan(planInput, feedback);
  throw new ApiError(500, "AI_PROVIDER_INVALID", "No external AI provider is configured.");
}

export async function generatePlan(
  input: GeneratePlanInput,
  projectId: string | null,
): Promise<GeneratedPlan> {
  const planInput = toPlanInput(input);
  const started = Date.now();

  if (aiMode.provider === "deterministic-demo") {
    const result = deterministicResult(planInput, {
      degraded: false,
      notice:
        "No Gemini or Meta key is configured. MIRAIWERK used its labelled deterministic planning rules — not a model output.",
      latencyMs: Date.now() - started,
    });
    await recordAiCall({
      projectId,
      workflow: "plan_generation",
      provider: "deterministic-demo",
      model: result.model,
      durationMs: result.latencyMs,
      success: true,
      degraded: false,
      error: null,
      usage: null,
    });
    return result;
  }

  try {
    let result = await callPlanProvider(planInput);
    let validation = validatePlanDraft(result.draft);
    if (!validation.valid) {
      const retry = await callPlanProvider(planInput, validation.errors.join("\n"));
      const retryValidation = validatePlanDraft(retry.draft);
      if (!retryValidation.valid) {
        await recordAiCall({
          projectId,
          workflow: "plan_generation",
          provider: aiMode.provider,
          model: result.model,
          durationMs: retry.latencyMs,
          success: false,
          degraded: false,
          error: retryValidation.errors.join(" | "),
          usage: retry.usage,
        });
        throw new ApiError(
          422,
          "INVALID_GENERATED_PLAN",
          `The ${providerLabel()}-generated plan did not pass schema and dependency validation after one correction attempt.`,
          retryValidation,
        );
      }
      result = retry;
      validation = retryValidation;
    }

    await recordAiCall({
      projectId,
      workflow: "plan_generation",
      provider: aiMode.provider,
      model: result.model,
      durationMs: result.latencyMs,
      success: true,
      degraded: false,
      error: null,
      usage: result.usage,
    });
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error ? error.message : "Unknown model error";
    const isProviderError =
      error instanceof MetaError || error instanceof GeminiError || error instanceof ZodError;
    if (config.aiFallbackOnError && isProviderError) {
      const fallback = deterministicResult(planInput, {
        degraded: true,
        notice: `${providerLabel()} generation failed (${message.slice(0, 220)}). MIRAIWERK used labelled deterministic rules; no ${providerLabel()} output is claimed.`,
        latencyMs: Date.now() - started,
      });
      await recordAiCall({
        projectId,
        workflow: "plan_generation",
        provider: "deterministic-demo",
        model: fallback.model,
        durationMs: fallback.latencyMs,
        success: true,
        degraded: true,
        error: message,
        usage: null,
      });
      return fallback;
    }
    await recordAiCall({
      projectId,
      workflow: "plan_generation",
      provider: aiMode.provider,
      model: aiMode.model,
      durationMs: Date.now() - started,
      success: false,
      degraded: false,
      error: message,
      usage: null,
    });
    throw new ApiError(
      502,
      "MODEL_UNAVAILABLE",
      "The configured AI provider is unavailable and fallback is disabled.",
    );
  }
}

export function aiStatus() {
  return aiMode;
}
