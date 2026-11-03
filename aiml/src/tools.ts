import { z } from "zod";
import type { AnalysisContext } from "./types.js";
import { lexicalScore } from "./lib/text.js";

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "get_project_snapshot",
      description:
        "Return the current project objective, plan version, milestones, task counts, release gates and stated constraints. Read-only.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project_requirements",
      description:
        "Return the project's stored requirements with acceptance criteria. Use this to ground ticket links in real records.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional keyword filter, e.g. 'payment retry'.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_related_tickets",
      description:
        "Search existing project tickets for possible duplicates or related work. Returns candidate IDs, titles and lexical match reasons. Candidates are never confirmed duplicates automatically.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search text." },
          limit: { type: "integer", minimum: 1, maximum: 8 },
        },
        required: ["query", "limit"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_dependency_neighborhood",
      description:
        "Return upstream and downstream tasks around the given task IDs, up to max_depth edges away. Use this to understand downstream schedule impact.",
      parameters: {
        type: "object",
        properties: {
          task_ids: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 8,
          },
          max_depth: { type: "integer", minimum: 1, maximum: 3 },
        },
        required: ["task_ids", "max_depth"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_project_policy",
      description:
        "Return configured severity, response-window, escalation and release-gate policy. The backend, not the model, applies the final policy outcome.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
] as const;

const RequirementsArgs = z.object({ query: z.string().max(200).default("") });
const SearchArgs = z.object({ query: z.string().min(1).max(400), limit: z.number().int().min(1).max(8) });
const NeighborhoodArgs = z.object({
  task_ids: z.array(z.string()).min(1).max(8),
  max_depth: z.number().int().min(1).max(3),
});

export interface ToolExecution {
  name: string;
  args: Record<string, unknown>;
  output: unknown;
}

function snapshot(context: AnalysisContext) {
  const releaseGates = context.milestones.filter((milestone) => milestone.releaseGate);
  return {
    project: {
      id: context.project.id,
      name: context.project.name,
      goal: context.project.goal,
      planVersion: context.project.planVersion,
      startDate: context.project.startDate,
      targetDate: context.project.targetDate,
    },
    counts: {
      requirements: context.requirements.length,
      milestones: context.milestones.length,
      tasks: context.tasks.length,
    },
    milestones: context.milestones,
    releaseGates,
    constraints: context.project.constraints,
    assumptions: context.project.currentPlanAssumptions,
    tasksInFlight: context.tasks
      .filter((task) => task.status === "in_progress" || task.status === "blocked")
      .map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        milestoneTitle: task.milestoneTitle,
      })),
  };
}

function requirements(context: AnalysisContext, query: string) {
  const scored = context.requirements.map((requirement) => ({
    requirement,
    score: query
      ? lexicalScore(
          query,
          `${requirement.title} ${requirement.description} ${requirement.acceptanceCriteria.join(" ")}`,
        )
      : 1,
  }));
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ requirement, score }) => ({
      id: requirement.id,
      title: requirement.title,
      description: requirement.description,
      acceptanceCriteria: requirement.acceptanceCriteria,
      matchScore: Math.round(score * 1000) / 1000,
    }));
}

function relatedTickets(context: AnalysisContext, query: string, limit: number) {
  return context.relatedTickets
    .map((ticket) => ({
      ...ticket,
      matchScore: Math.round(
        lexicalScore(query, `${ticket.title} ${ticket.description}`) * 1000,
      ) / 1000,
    }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

function neighborhood(context: AnalysisContext, taskIds: string[], maxDepth: number) {
  const upstream = new Map<string, string[]>();
  const downstream = new Map<string, string[]>();
  for (const task of context.tasks) {
    for (const id of task.upstreamTaskIds) {
      const list = downstream.get(id) ?? [];
      list.push(task.id);
      downstream.set(id, list);
      const reverse = upstream.get(task.id) ?? [];
      reverse.push(id);
      upstream.set(task.id, reverse);
    }
  }
  const visited = new Set<string>();
  let frontier = [...taskIds];
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      next.push(...(upstream.get(id) ?? []), ...(downstream.get(id) ?? []));
    }
    frontier = next;
  }
  for (const id of frontier) visited.add(id);
  const tasks = context.tasks.filter((task) => visited.has(task.id));
  const ids = new Set(tasks.map((task) => task.id));
  return {
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      milestoneTitle: task.milestoneTitle,
      estimateDays: task.estimateDays,
      status: task.status,
      plannedFinish: task.plannedFinish,
      upstreamTaskIds: task.upstreamTaskIds.filter((id) => ids.has(id)),
      downstreamTaskIds: task.downstreamTaskIds.filter((id) => ids.has(id)),
    })),
    releaseGateMilestones: context.milestones
      .filter((milestone) => milestone.releaseGate)
      .map((milestone) => milestone.title),
  };
}

export function executeTool(
  name: string,
  rawArgs: unknown,
  context: AnalysisContext,
): ToolExecution {
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  switch (name) {
    case "get_project_snapshot":
      return { name, args, output: snapshot(context) };
    case "get_project_requirements": {
      const parsed = RequirementsArgs.parse(args);
      return { name, args: parsed, output: requirements(context, parsed.query) };
    }
    case "search_related_tickets": {
      const parsed = SearchArgs.parse(args);
      return {
        name,
        args: parsed,
        output: relatedTickets(context, parsed.query, parsed.limit),
      };
    }
    case "get_dependency_neighborhood": {
      const parsed = NeighborhoodArgs.parse(args);
      return {
        name,
        args: parsed,
        output: neighborhood(context, parsed.task_ids, parsed.max_depth),
      };
    }
    case "get_project_policy":
      return {
        name,
        args,
        output: {
          constraints: context.project.constraints,
          note:
            "The backend applies final priority, escalation and release-window rules. Do not invent policy values.",
        },
      };
    default:
      return { name, args, output: { error: "Unknown tool. Only read-only tools are available." } };
  }
}
