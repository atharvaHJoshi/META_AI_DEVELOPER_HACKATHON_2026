"""Graph validation, topological sort and cycle detection for plan graphs."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Iterable


@dataclass
class GraphValidation:
    valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    cycles: list[list[str]] = field(default_factory=list)
    topologicalOrder: list[str] = field(default_factory=list)
    dependencyKeys: list[str] = field(default_factory=list)


def edge_key(dependency: dict) -> str:
    return f"{dependency['predecessorId']}->{dependency['successorId']}"


def find_cycle(node_ids: list[str], edges: list[dict]) -> list[str] | None:
    adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    for edge in edges:
        if edge["predecessorId"] in adjacency and edge["successorId"] in adjacency:
            adjacency[edge["predecessorId"]].append(edge["successorId"])

    state: dict[str, int] = {}
    stack: list[str] = []
    found: list[str] = []

    def visit(node_id: str) -> bool:
        state[node_id] = 1
        stack.append(node_id)
        for nxt in adjacency.get(node_id, []):
            next_state = state.get(nxt, 0)
            if next_state == 0:
                if visit(nxt):
                    return True
            elif next_state == 1:
                try:
                    start = stack.index(nxt)
                except ValueError:
                    start = 0
                found.extend(stack[start:])
                found.append(nxt)
                return True
        stack.pop()
        state[node_id] = 2
        return False

    # Note: the TS recursion returns True through the chain, mirroring the
    # original control flow exactly.
    for node_id in node_ids:
        if state.get(node_id, 0) == 0 and visit(node_id):
            return found
    return None


def topological_sort(
    node_ids: list[str], edges: list[dict]
) -> tuple[list[str], list[list[str]]]:
    indegree: dict[str, int] = {node_id: 0 for node_id in node_ids}
    adjacency: dict[str, list[str]] = {node_id: [] for node_id in node_ids}

    seen: set[str] = set()
    for edge in edges:
        pred, succ = edge["predecessorId"], edge["successorId"]
        if pred not in indegree or succ not in indegree:
            continue
        key = edge_key(edge)
        if key in seen:
            continue
        seen.add(key)
        adjacency[pred].append(succ)
        indegree[succ] = indegree.get(succ, 0) + 1

    import heapq

    ready = [node_id for node_id in node_ids if indegree.get(node_id, 0) == 0]
    heapq.heapify(ready)
    order: list[str] = []
    while ready:
        node_id = heapq.heappop(ready)
        order.append(node_id)
        for nxt in adjacency.get(node_id, []):
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                heapq.heappush(ready, nxt)

    if len(order) == len(node_ids):
        return order, []
    cycle = find_cycle(node_ids, edges)
    return order, [[*cycle]] if cycle else []


def validate_graph(graph: dict) -> GraphValidation:
    errors: list[str] = []
    warnings: list[str] = []

    tasks = graph.get("tasks", [])
    task_ids = [task["id"] for task in tasks]
    unique_task_ids = set(task_ids)

    if len(unique_task_ids) != len(task_ids):
        errors.append("The plan contains duplicate task IDs.")

    milestone_ids = {milestone["id"] for milestone in graph.get("milestones", [])}
    for task in tasks:
        milestone_id = task.get("milestoneId")
        if milestone_id and milestone_id not in milestone_ids:
            errors.append(f'Task "{task["title"]}" references a milestone that does not exist.')
        estimate = task.get("estimateDays")
        try:
            estimate_value = float(estimate)
        except (TypeError, ValueError):
            estimate_value = float("nan")
        if not (estimate_value == estimate_value) or estimate_value <= 0:  # NaN check
            errors.append(f'Task "{task["title"]}" has an invalid effort estimate.')

    seen: set[str] = set()
    valid_edges: list[dict] = []
    for dep in graph.get("dependencies", []):
        key = edge_key(dep)
        if key in seen:
            warnings.append(f"Duplicate dependency {key} was ignored.")
            continue
        seen.add(key)
        if dep["predecessorId"] not in unique_task_ids or dep["successorId"] not in unique_task_ids:
            errors.append(f"Dependency {key} points to a task that does not exist.")
            continue
        if dep["predecessorId"] == dep["successorId"]:
            errors.append(f'Task "{dep["predecessorId"]}" cannot depend on itself.')
            continue
        dependency_type = dep.get("dependencyType", "finishes_to_start")
        if dependency_type != "finishes_to_start":
            warnings.append(
                f'Dependency {key} uses "{dependency_type}"; the MVP schedules all dependencies as finish-to-start.'
            )
        valid_edges.append(dep)

    # Preserve first-seen order like the TS ([...uniqueTaskIds] with a Set).
    ordered_unique_ids = list(dict.fromkeys(task_ids))
    order, cycles = topological_sort(ordered_unique_ids, valid_edges)
    if cycles:
        errors.append(f"Dependency cycle detected: {' → '.join(cycles[0])}")

    for task_id in task_ids:
        if task_id not in order and not cycles:
            errors.append(
                f'Task "{task_id}" could not be scheduled because of an invalid dependency graph.'
            )

    return GraphValidation(
        valid=not errors,
        errors=errors,
        warnings=warnings,
        cycles=cycles,
        topologicalOrder=order,
        dependencyKeys=list(seen),
    )


def descendants_of(task_ids: Iterable[str], dependencies: list[dict]) -> set[str]:
    adjacency: dict[str, list[str]] = {}
    for dep in dependencies:
        adjacency.setdefault(dep["predecessorId"], []).append(dep["successorId"])

    result: set[str] = set()
    queue = deque(task_ids)
    while queue:
        current = queue.popleft()
        for nxt in adjacency.get(current, []):
            if nxt not in result:
                result.add(nxt)
                queue.append(nxt)
    return result
