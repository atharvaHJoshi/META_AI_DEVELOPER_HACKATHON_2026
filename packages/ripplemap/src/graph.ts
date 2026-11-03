import type { GraphDependency, ProjectGraph } from "@miraiwerk/schemas";

export interface GraphValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  cycles: string[][];
  topologicalOrder: string[];
  dependencyKeys: string[];
}

function edgeKey(dep: GraphDependency): string {
  return `${dep.predecessorId}->${dep.successorId}`;
}

export function findCycle(
  nodeIds: string[],
  edges: GraphDependency[],
): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) {
    if (!adjacency.has(edge.predecessorId) || !adjacency.has(edge.successorId)) continue;
    adjacency.get(edge.predecessorId)!.push(edge.successorId);
  }

  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const found: string[] = [];

  const visit = (id: string): boolean => {
    state.set(id, 1);
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const nextState = state.get(next) ?? 0;
      if (nextState === 0) {
        if (visit(next)) return true;
      } else if (nextState === 1) {
        const start = stack.indexOf(next);
        found.push(...stack.slice(start >= 0 ? start : 0));
        found.push(next);
        return true;
      }
    }
    stack.pop();
    state.set(id, 2);
    return false;
  };

  for (const id of nodeIds) {
    if ((state.get(id) ?? 0) === 0 && visit(id)) return found;
  }
  return null;
}

export function topologicalSort(
  nodeIds: string[],
  edges: GraphDependency[],
): { order: string[]; cycles: string[][] } {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    indegree.set(id, 0);
    adjacency.set(id, []);
  }

  const unique = new Set<string>();
  for (const edge of edges) {
    if (!indegree.has(edge.predecessorId) || !indegree.has(edge.successorId)) continue;
    const key = edgeKey(edge);
    if (unique.has(key)) continue;
    unique.add(key);
    adjacency.get(edge.predecessorId)!.push(edge.successorId);
    indegree.set(edge.successorId, (indegree.get(edge.successorId) ?? 0) + 1);
  }

  const ready = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const value = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, value);
      if (value === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }

  if (order.length === nodeIds.length) return { order, cycles: [] };
  const cycle = findCycle(nodeIds, edges);
  return { order, cycles: cycle ? [cycle] : [] };
}

export function validateGraph(graph: ProjectGraph): GraphValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const taskIds = graph.tasks.map((task) => task.id);
  const uniqueTaskIds = new Set(taskIds);

  if (uniqueTaskIds.size !== taskIds.length) {
    errors.push("The plan contains duplicate task IDs.");
  }

  const milestoneIds = new Set(graph.milestones.map((milestone) => milestone.id));
  for (const task of graph.tasks) {
    if (task.milestoneId && !milestoneIds.has(task.milestoneId)) {
      errors.push(`Task "${task.title}" references a milestone that does not exist.`);
    }
    if (!Number.isFinite(task.estimateDays) || task.estimateDays <= 0) {
      errors.push(`Task "${task.title}" has an invalid effort estimate.`);
    }
  }

  const seen = new Set<string>();
  const validEdges: GraphDependency[] = [];
  for (const dep of graph.dependencies) {
    const key = edgeKey(dep);
    if (seen.has(key)) {
      warnings.push(`Duplicate dependency ${key} was ignored.`);
      continue;
    }
    seen.add(key);
    if (!uniqueTaskIds.has(dep.predecessorId) || !uniqueTaskIds.has(dep.successorId)) {
      errors.push(`Dependency ${key} points to a task that does not exist.`);
      continue;
    }
    if (dep.predecessorId === dep.successorId) {
      errors.push(`Task "${dep.predecessorId}" cannot depend on itself.`);
      continue;
    }
    if (dep.dependencyType !== "finishes_to_start") {
      warnings.push(
        `Dependency ${key} uses "${dep.dependencyType}"; the MVP schedules all dependencies as finish-to-start.`,
      );
    }
    validEdges.push(dep);
  }

  const { order, cycles } = topologicalSort([...uniqueTaskIds], validEdges);
  if (cycles.length > 0) {
    errors.push(`Dependency cycle detected: ${cycles[0]!.join(" → ")}`);
  }

  for (const id of taskIds) {
    if (!order.includes(id) && cycles.length === 0) {
      errors.push(`Task "${id}" could not be scheduled because of an invalid dependency graph.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    cycles,
    topologicalOrder: order,
    dependencyKeys: [...seen],
  };
}

export function descendantsOf(
  taskIds: string[],
  dependencies: GraphDependency[],
): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const dep of dependencies) {
    const list = adjacency.get(dep.predecessorId) ?? [];
    list.push(dep.successorId);
    adjacency.set(dep.predecessorId, list);
  }
  const result = new Set<string>();
  const queue = [...taskIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (!result.has(next)) {
        result.add(next);
        queue.push(next);
      }
    }
  }
  return result;
}
