import type {
  ProjectGraph,
  ScheduledMilestone,
  ScheduledTask,
} from "@miraiwerk/schemas";
import {
  addWorkingDays,
  formatIsoDate,
  nextWorkingDay,
  parseIsoDate,
  workingDaysBetween,
} from "./date.js";
import { validateGraph } from "./graph.js";

export interface ScheduleResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  tasks: ScheduledTask[];
  milestones: ScheduledMilestone[];
  projectFinish: string | null;
  criticalPathTaskIds: string[];
  assumptions: string[];
}

function durationOf(estimateDays: number): number {
  return Math.max(1, Math.ceil(estimateDays));
}

export function scheduleGraph(graph: ProjectGraph): ScheduleResult {
  const validation = validateGraph(graph);
  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors,
      warnings: validation.warnings,
      tasks: [],
      milestones: [],
      projectFinish: null,
      criticalPathTaskIds: [],
      assumptions: [],
    };
  }

  const taskById = new Map(graph.tasks.map((task) => [task.id, task]));
  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const task of graph.tasks) {
    predecessors.set(task.id, []);
    successors.set(task.id, []);
  }
  const seen = new Set<string>();
  const dependencies = [];
  for (const dep of graph.dependencies) {
    const key = `${dep.predecessorId}->${dep.successorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dependencies.push(dep);
    predecessors.get(dep.successorId)?.push(dep.predecessorId);
    successors.get(dep.predecessorId)?.push(dep.successorId);
  }

  const projectStart = nextWorkingDay(parseIsoDate(graph.startDate));
  const startDates = new Map<string, Date>();
  const finishDates = new Map<string, Date>();

  for (const id of validation.topologicalOrder) {
    const task = taskById.get(id);
    if (!task) continue;
    let start = projectStart;
    for (const predecessorId of predecessors.get(id) ?? []) {
      const predecessorFinish = finishDates.get(predecessorId);
      if (!predecessorFinish) continue;
      const candidate = addWorkingDays(predecessorFinish, 1);
      if (candidate.getTime() > start.getTime()) start = candidate;
    }
    start = nextWorkingDay(start);
    const finish = addWorkingDays(start, durationOf(task.estimateDays) - 1);
    startDates.set(id, start);
    finishDates.set(id, finish);
  }

  let projectFinish: Date | null = null;
  for (const finish of finishDates.values()) {
    if (!projectFinish || finish.getTime() > projectFinish.getTime()) {
      projectFinish = finish;
    }
  }

  const latestFinish = new Map<string, Date>();
  const latestStart = new Map<string, Date>();
  for (const id of [...validation.topologicalOrder].reverse()) {
    const task = taskById.get(id);
    if (!task) continue;
    const nextTasks = successors.get(id) ?? [];
    let latest: Date;
    if (nextTasks.length === 0) {
      latest = projectFinish ?? finishDates.get(id) ?? projectStart;
    } else {
      latest = addWorkingDays(
        latestStart.get(nextTasks[0]!) ?? projectFinish ?? projectStart,
        -1,
      );
      for (const nextId of nextTasks.slice(1)) {
        const candidate = addWorkingDays(
          latestStart.get(nextId) ?? projectFinish ?? projectStart,
          -1,
        );
        if (candidate.getTime() < latest.getTime()) latest = candidate;
      }
    }
    latestFinish.set(id, latest);
    latestStart.set(
      id,
      addWorkingDays(latest, -(durationOf(task.estimateDays) - 1)),
    );
  }

  const scheduledTasks: ScheduledTask[] = graph.tasks
    .map((task) => {
      const start = startDates.get(task.id) ?? projectStart;
      const finish = finishDates.get(task.id) ?? start;
      const taskLatestFinish = latestFinish.get(task.id) ?? finish;
      const slack = workingDaysBetween(finish, taskLatestFinish);
      return {
        ...task,
        plannedStart: formatIsoDate(start),
        plannedFinish: formatIsoDate(finish),
        onCriticalPath: slack === 0,
        slackDays: slack,
        impacted: false,
      };
    })
    .sort((a, b) => {
      const startCompare = (a.plannedStart ?? "").localeCompare(b.plannedStart ?? "");
      return startCompare !== 0 ? startCompare : a.id.localeCompare(b.id);
    });

  const milestones: ScheduledMilestone[] = graph.milestones
    .map((milestone) => {
      const scoped = scheduledTasks.filter(
        (task) => task.milestoneId === milestone.id,
      );
      const computed =
        scoped.length > 0
          ? scoped.reduce(
              (latest, task) =>
                (task.plannedFinish ?? "") > latest ? task.plannedFinish! : latest,
              scoped[0]!.plannedFinish ?? formatIsoDate(projectStart),
            )
          : (milestone.targetDate ?? formatIsoDate(projectStart));
      const targetDelta =
        milestone.targetDate
          ? Math.round(
              (parseIsoDate(computed).getTime() -
                parseIsoDate(milestone.targetDate).getTime()) /
                86_400_000,
            )
          : null;
      return {
        ...milestone,
        computedDate: computed,
        baselineComputedDate: null,
        deltaDays: 0,
        targetDeltaDays: targetDelta,
        breached: Boolean(milestone.targetDate && computed > milestone.targetDate),
      };
    })
    .sort((a, b) => {
      const dateCompare = (a.computedDate ?? "").localeCompare(b.computedDate ?? "");
      return dateCompare !== 0 ? dateCompare : a.title.localeCompare(b.title);
    });

  const criticalPathTaskIds = scheduledTasks
    .filter((task) => task.onCriticalPath)
    .map((task) => task.id);

  return {
    valid: true,
    errors: [],
    warnings: validation.warnings,
    tasks: scheduledTasks,
    milestones,
    projectFinish: projectFinish ? formatIsoDate(projectFinish) : null,
    criticalPathTaskIds,
    assumptions: [],
  };
}

export function workingDayDuration(estimateDays: number): number {
  return durationOf(estimateDays);
}
