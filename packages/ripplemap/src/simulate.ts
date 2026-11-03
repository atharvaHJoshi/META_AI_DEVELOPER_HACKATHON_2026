import { createHash } from "node:crypto";
import type {
  PlanDiff,
  PolicyFinding,
  ProjectGraph,
  ProposedChange,
  ScenarioResult,
  ScheduledMilestone,
  ScheduledTask,
} from "@miraiwerk/schemas";
import { calendarDaysBetween } from "./date.js";
import { descendantsOf, validateGraph } from "./graph.js";
import { scheduleGraph } from "./schedule.js";

export interface SimulateOptions {
  change: ProposedChange;
  targetMilestoneId?: string | null;
  relatedTaskIds?: string[];
  ticketId?: string | null;
}

const OPTION_LABELS = {
  accept: "Accept and prioritize now",
  defer: "Defer to a later sprint",
  split: "Split into mitigation + permanent fix",
  clarify: "Request more information",
  duplicate: "Link to existing work",
} as const;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}

export function hashScenarioInput(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

function emptyDiff(targetMilestoneId: string | null): PlanDiff {
  return {
    addedTasks: [],
    changedTasks: [],
    removedTasks: [],
    addedDependencies: [],
    milestoneDeltas: [],
    criticalPathTaskIds: [],
    targetMilestoneId,
    targetDeltaDays: 0,
  };
}

function applyChange(
  graph: ProjectGraph,
  change: ProposedChange,
  ticketId: string | null | undefined,
): { graph: ProjectGraph; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tasks = graph.tasks.map((task) => ({ ...task }));
  const existingIds = new Set(tasks.map((task) => task.id));
  const milestoneIds = new Set(graph.milestones.map((milestone) => milestone.id));
  const addedIds = new Set<string>();

  for (const task of change.tasksToAdd) {
    if (existingIds.has(task.tempId)) {
      errors.push(`New task ID "${task.tempId}" conflicts with an existing task.`);
      continue;
    }
    if (addedIds.has(task.tempId)) {
      errors.push(`New task ID "${task.tempId}" is used more than once.`);
      continue;
    }
    if (task.milestoneId && !milestoneIds.has(task.milestoneId)) {
      errors.push(`New task "${task.title}" references an unknown milestone.`);
    }
    addedIds.add(task.tempId);
    tasks.push({
      id: task.tempId,
      title: task.title,
      description: task.description,
      requirementId: task.requirementId,
      milestoneId: task.milestoneId,
      estimateDays: task.estimateDays,
      priority: task.priority,
      status: "planned",
      ownerRole: task.ownerRole,
      plannedStart: null,
      plannedFinish: null,
      sourceTicketId: ticketId ?? null,
    });
  }

  for (const update of change.tasksToUpdate) {
    const task = tasks.find((item) => item.id === update.taskId);
    if (!task) {
      errors.push(`Cannot update task "${update.taskId}" because it does not exist.`);
      continue;
    }
    if (update.estimateDays !== undefined) task.estimateDays = update.estimateDays;
    if (update.priority !== undefined) task.priority = update.priority;
    if (update.milestoneId !== undefined) {
      if (update.milestoneId && !milestoneIds.has(update.milestoneId)) {
        errors.push(`Update for "${task.title}" references an unknown milestone.`);
      } else {
        task.milestoneId = update.milestoneId;
      }
    }
  }

  for (const taskId of change.tasksToRemove) {
    if (!existingIds.has(taskId)) {
      warnings.push(`Task "${taskId}" was scheduled for removal but no longer exists.`);
    }
  }
  const removalSet = new Set(change.tasksToRemove);
  const remainingTasks = tasks.filter((task) => !removalSet.has(task.id));

  const dependencies = graph.dependencies
    .filter(
      (dep) =>
        !removalSet.has(dep.predecessorId) && !removalSet.has(dep.successorId),
    )
    .map((dep) => ({ ...dep }));
  const dependencyKeys = new Set(
    dependencies.map((dep) => `${dep.predecessorId}->${dep.successorId}`),
  );

  const addDependency = (predecessorId: string, successorId: string, type = "finishes_to_start") => {
    const key = `${predecessorId}->${successorId}`;
    if (dependencyKeys.has(key)) return;
    dependencyKeys.add(key);
    dependencies.push({ predecessorId, successorId, dependencyType: type });
  };

  for (const task of change.tasksToAdd) {
    for (const dependencyId of task.dependencies) {
      addDependency(dependencyId, task.tempId);
    }
  }
  for (const dep of change.dependenciesToAdd) {
    addDependency(dep.predecessorId, dep.successorId, dep.dependencyType);
  }

  return {
    graph: {
      ...graph,
      tasks: remainingTasks,
      dependencies,
    },
    errors,
    warnings,
  };
}

function findTargetMilestone(
  baseline: ProjectGraph,
  scenario: ProjectGraph,
  change: ProposedChange,
  options: SimulateOptions,
): string | null {
  if (options.targetMilestoneId) return options.targetMilestoneId;

  const addedMilestoneIds = change.tasksToAdd
    .map((task) => task.milestoneId)
    .filter((id): id is string => Boolean(id));
  if (addedMilestoneIds.length > 0) {
    const gates = scenario.milestones.filter(
      (milestone) => addedMilestoneIds.includes(milestone.id) && milestone.releaseGate,
    );
    if (gates.length > 0) return gates[gates.length - 1]!.id;
    return addedMilestoneIds[0]!;
  }

  const relatedMilestones = (options.relatedTaskIds ?? [])
    .map((id) => scenario.tasks.find((task) => task.id === id)?.milestoneId)
    .filter((id): id is string => Boolean(id));
  if (relatedMilestones.length > 0) {
    const gates = scenario.milestones.filter(
      (milestone) => relatedMilestones.includes(milestone.id) && milestone.releaseGate,
    );
    if (gates.length > 0) return gates[gates.length - 1]!.id;
    return relatedMilestones[0]!;
  }

  const releaseGates = baseline.milestones
    .filter((milestone) => milestone.releaseGate)
    .sort((a, b) => (a.targetDate ?? "").localeCompare(b.targetDate ?? ""));
  if (releaseGates.length > 0) return releaseGates[releaseGates.length - 1]!.id;
  return baseline.milestones[baseline.milestones.length - 1]?.id ?? null;
}

function buildPolicyFindings(
  scenario: ProjectGraph,
  option: ProposedChange["option"],
  milestones: ScheduledMilestone[],
  totalEffortDays: number,
): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  for (const milestone of milestones) {
    if (milestone.releaseGate && milestone.breached) {
      findings.push({
        severity: "critical",
        code: "RELEASE_GATE_BREACH",
        message: `Release gate "${milestone.title}" would finish after its target date.`,
      });
    } else if (milestone.releaseGate && milestone.deltaDays > 0) {
      findings.push({
        severity: "warning",
        code: "RELEASE_GATE_SLIP",
        message: `Release gate "${milestone.title}" moves ${milestone.deltaDays} day(s) later.`,
      });
    }
  }

  const capacity = scenario.constraints.capacityPersonDays;
  if (capacity && totalEffortDays > capacity) {
    findings.push({
      severity: "warning",
      code: "STATED_CAPACITY_EXCEEDED",
      message: `Scheduled effort (${totalEffortDays} person-days) exceeds the stated capacity of ${capacity} person-days. Dates are not capacity-levelled.`,
    });
  }

  if (option === "defer") {
    findings.push({
      severity: "warning",
      code: "UNRESOLVED_DEFERRAL_RISK",
      message:
        "The baseline plan does not change, but the ticket risk remains unresolved and must be tracked separately.",
    });
  }
  if (option === "clarify") {
    findings.push({
      severity: "info",
      code: "EVIDENCE_REQUIRED",
      message:
        "No plan change is proposed until the missing evidence is supplied and the analysis is re-run.",
    });
  }

  return findings;
}

export function simulateScenario(
  graph: ProjectGraph,
  options: SimulateOptions,
): ScenarioResult {
  const baselineValidation = validateGraph(graph);
  const applied = applyChange(graph, options.change, options.ticketId);
  const scenarioGraph = applied.graph;
  const scenarioValidation = validateGraph(scenarioGraph);
  const targetMilestoneId = findTargetMilestone(
    graph,
    scenarioGraph,
    options.change,
    options,
  );

  const errors = [
    ...baselineValidation.errors.map((error) => `Baseline: ${error}`),
    ...applied.errors,
    ...scenarioValidation.errors,
  ];
  const warnings = [
    ...baselineValidation.warnings,
    ...applied.warnings,
    ...scenarioValidation.warnings,
  ];

  const option = options.change.option;
  if (errors.length > 0) {
    return {
      option,
      label: OPTION_LABELS[option],
      valid: false,
      validationErrors: [...new Set(errors)],
      validationWarnings: [...new Set(warnings)],
      diff: emptyDiff(targetMilestoneId),
      metrics: {
        tasksAdded: 0,
        tasksChanged: 0,
        tasksRemoved: 0,
        dependenciesAdded: 0,
        effortAddedDays: 0,
        scheduleDeltaDays: 0,
        milestonesShifted: 0,
        milestonesBreached: 0,
        affectedTaskCount: 0,
        totalEffortDays: 0,
      },
      tasks: [],
      milestones: [],
      affectedTaskIds: [],
      affectedMilestoneIds: [],
      policyFindings: [],
      assumptions: options.change.assumptions,
      capacity: null,
      inputHash: hashScenarioInput({ graph, options }),
      computedAt: new Date().toISOString(),
    };
  }

  const baseline = scheduleGraph(graph);
  const scenario = scheduleGraph(scenarioGraph);
  if (!baseline.valid || !scenario.valid) {
    return {
      option,
      label: OPTION_LABELS[option],
      valid: false,
      validationErrors: [...baseline.errors, ...scenario.errors],
      validationWarnings: [...baseline.warnings, ...scenario.warnings],
      diff: emptyDiff(targetMilestoneId),
      metrics: {
        tasksAdded: 0,
        tasksChanged: 0,
        tasksRemoved: 0,
        dependenciesAdded: 0,
        effortAddedDays: 0,
        scheduleDeltaDays: 0,
        milestonesShifted: 0,
        milestonesBreached: 0,
        affectedTaskCount: 0,
        totalEffortDays: 0,
      },
      tasks: [],
      milestones: [],
      affectedTaskIds: [],
      affectedMilestoneIds: [],
      policyFindings: [],
      assumptions: options.change.assumptions,
      capacity: null,
      inputHash: hashScenarioInput({ graph, options }),
      computedAt: new Date().toISOString(),
    };
  }

  const baselineTaskMap = new Map(baseline.tasks.map((task) => [task.id, task]));
  const scenarioTaskMap = new Map(scenario.tasks.map((task) => [task.id, task]));
  const baselineDepKeys = new Set(
    graph.dependencies.map((dep) => `${dep.predecessorId}->${dep.successorId}`),
  );

  const addedTasks = scenario.tasks
    .filter((task) => !baselineTaskMap.has(task.id))
    .map((task) => ({
      id: task.id,
      title: task.title,
      milestoneId: task.milestoneId,
      estimateDays: task.estimateDays,
      plannedStart: task.plannedStart,
      plannedFinish: task.plannedFinish,
    }));

  const removedTasks = baseline.tasks
    .filter((task) => !scenarioTaskMap.has(task.id))
    .map((task) => ({ taskId: task.id, title: task.title }));

  const changedTasks: PlanDiff["changedTasks"] = [];
  for (const [id, before] of baselineTaskMap) {
    const after = scenarioTaskMap.get(id);
    if (!after) continue;
    const changes: PlanDiff["changedTasks"][number]["changes"] = [];
    const fields: Array<{
      field: string;
      before: string | number | boolean | null;
      after: string | number | boolean | null;
    }> = [
      { field: "estimateDays", before: before.estimateDays, after: after.estimateDays },
      { field: "priority", before: before.priority, after: after.priority },
      { field: "milestoneId", before: before.milestoneId, after: after.milestoneId },
      { field: "plannedStart", before: before.plannedStart, after: after.plannedStart },
      { field: "plannedFinish", before: before.plannedFinish, after: after.plannedFinish },
    ];
    for (const item of fields) {
      if (item.before !== item.after) changes.push(item);
    }
    if (changes.length > 0) {
      changedTasks.push({ taskId: id, title: after.title, changes });
    }
  }

  const addedDependencies = scenarioGraph.dependencies
    .filter((dep) => !baselineDepKeys.has(`${dep.predecessorId}->${dep.successorId}`))
    .map((dep) => ({ ...dep }));

  const baselineMilestoneMap = new Map(
    baseline.milestones.map((milestone) => [milestone.id, milestone]),
  );
  const milestoneDeltas: PlanDiff["milestoneDeltas"] = scenario.milestones.map(
    (milestone) => {
      const baselineMilestone = baselineMilestoneMap.get(milestone.id);
      const baselineDate = baselineMilestone?.computedDate ?? null;
      const deltaDays = baselineDate
        ? calendarDaysBetween(baselineDate, milestone.computedDate)
        : 0;
      return {
        milestoneId: milestone.id,
        title: milestone.title,
        targetDate: milestone.targetDate,
        baselineDate,
        simulatedDate: milestone.computedDate,
        deltaDays,
        targetDeltaDays: milestone.targetDeltaDays,
        releaseGate: milestone.releaseGate,
        breached: milestone.breached,
      };
    },
  );

  const targetDelta = milestoneDeltas.find(
    (milestone) => milestone.milestoneId === targetMilestoneId,
  );
  const targetDeltaDays = targetDelta?.deltaDays ?? 0;

  const changedTaskIds = [
    ...addedTasks.map((task) => task.id),
    ...changedTasks.map((task) => task.taskId),
    ...removedTasks.map((task) => task.taskId),
  ];
  const affected = descendantsOf(changedTaskIds, scenarioGraph.dependencies);
  for (const id of changedTaskIds) affected.add(id);

  const affectedMilestoneIds = new Set<string>();
  for (const id of affected) {
    const task = scenarioTaskMap.get(id);
    if (task?.milestoneId) affectedMilestoneIds.add(task.milestoneId);
  }
  for (const delta of milestoneDeltas) {
    if (delta.deltaDays !== 0) affectedMilestoneIds.add(delta.milestoneId);
  }
  for (const task of scenario.tasks) {
    if (task.milestoneId && affectedMilestoneIds.has(task.milestoneId)) {
      affected.add(task.id);
    }
  }

  const impactedTasks: ScheduledTask[] = scenario.tasks.map((task) => ({
    ...task,
    impacted: affected.has(task.id),
  }));

  const scenariosMilestones = scenario.milestones.map((milestone) => ({
    ...milestone,
    baselineComputedDate:
      baselineMilestoneMap.get(milestone.id)?.computedDate ?? null,
    deltaDays:
      milestoneDeltas.find((item) => item.milestoneId === milestone.id)?.deltaDays ?? 0,
  }));

  const totalEffortDays = Math.round(
    scenario.tasks.reduce((sum, task) => sum + task.estimateDays, 0) * 10,
  ) / 10;
  const baselineEffortDays = baseline.tasks.reduce(
    (sum, task) => sum + task.estimateDays,
    0,
  );
  const effortAddedDays =
    Math.round((totalEffortDays - baselineEffortDays) * 10) / 10;

  const policyFindings = buildPolicyFindings(
    scenarioGraph,
    option,
    scenariosMilestones,
    totalEffortDays,
  );

  const assumptions = [
    ...new Set([
      ...options.change.assumptions,
      "Effort is treated as whole working days; weekends are excluded.",
      "Dates use dependency-based earliest-start/earliest-finish scheduling.",
      "No resource levelling, staffing model, or capacity optimisation is applied to task dates.",
      "Estimates come from the stored plan unless the proposal explicitly changes them.",
    ]),
  ];
  if (scenario.tasks.some((task) => !Number.isInteger(task.estimateDays))) {
    assumptions.push(
      "Fractional effort estimates are rounded up to whole working-day durations.",
    );
  }
  if (scenarioGraph.constraints.capacityPersonDays) {
    assumptions.push(
      "Stated capacity is compared with scheduled effort as an advisory check only.",
    );
  }

  return {
    option,
    label: OPTION_LABELS[option],
    valid: true,
    validationErrors: [],
    validationWarnings: [...new Set(warnings)],
    diff: {
      addedTasks,
      changedTasks,
      removedTasks,
      addedDependencies,
      milestoneDeltas,
      criticalPathTaskIds: scenario.criticalPathTaskIds,
      targetMilestoneId,
      targetDeltaDays,
    },
    metrics: {
      tasksAdded: addedTasks.length,
      tasksChanged: changedTasks.length,
      tasksRemoved: removedTasks.length,
      dependenciesAdded: addedDependencies.length,
      effortAddedDays,
      scheduleDeltaDays: targetDeltaDays,
      milestonesShifted: milestoneDeltas.filter((item) => item.deltaDays !== 0).length,
      milestonesBreached: scenario.milestones.filter((item) => item.breached).length,
      affectedTaskCount: affected.size,
      totalEffortDays,
    },
    tasks: impactedTasks,
    milestones: scenariosMilestones,
    affectedTaskIds: [...affected].sort(),
    affectedMilestoneIds: [...affectedMilestoneIds],
    policyFindings,
    assumptions,
    capacity: scenarioGraph.constraints.capacityPersonDays
      ? {
          statedCapacityPersonDays: scenarioGraph.constraints.capacityPersonDays,
          scheduledEffortDays: totalEffortDays,
          utilizationPercent:
            Math.round(
              (totalEffortDays / scenarioGraph.constraints.capacityPersonDays) * 1000,
            ) / 10,
          note: "Advisory only — the scheduler does not level resources against this capacity.",
        }
      : null,
    inputHash: hashScenarioInput({ graph, options }),
    computedAt: new Date().toISOString(),
  };
}

export { OPTION_LABELS };
