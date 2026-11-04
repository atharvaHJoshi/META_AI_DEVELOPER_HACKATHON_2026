"""Earliest-start/earliest-finish scheduling with critical-path detection."""

from __future__ import annotations

import math
from datetime import date
from typing import Any

from ripplemap.dates import (
    add_working_days,
    format_iso_date,
    next_working_day,
    parse_iso_date,
    working_days_between,
)
from ripplemap.graph import validate_graph


def duration_of(estimate_days: float) -> int:
    return max(1, math.ceil(estimate_days))


def schedule_graph(graph: dict[str, Any]) -> dict[str, Any]:
    validation = validate_graph(graph)
    if not validation.valid:
        return {
            "valid": False,
            "errors": validation.errors,
            "warnings": validation.warnings,
            "tasks": [],
            "milestones": [],
            "projectFinish": None,
            "criticalPathTaskIds": [],
            "assumptions": [],
        }

    task_by_id = {task["id"]: task for task in graph["tasks"]}
    predecessors: dict[str, list[str]] = {task["id"]: [] for task in graph["tasks"]}
    successors: dict[str, list[str]] = {task["id"]: [] for task in graph["tasks"]}
    seen: set[str] = set()
    dependencies: list[dict] = []
    for dep in graph["dependencies"]:
        key = f"{dep['predecessorId']}->{dep['successorId']}"
        if key in seen:
            continue
        seen.add(key)
        dependencies.append(dep)
        predecessors[dep["successorId"]].append(dep["predecessorId"])
        successors[dep["predecessorId"]].append(dep["successorId"])

    project_start = next_working_day(parse_iso_date(graph["startDate"]))
    start_dates: dict[str, date] = {}
    finish_dates: dict[str, date] = {}

    for task_id in validation.topologicalOrder:
        task = task_by_id.get(task_id)
        if task is None:
            continue
        start = project_start
        for predecessor_id in predecessors.get(task_id, []):
            predecessor_finish = finish_dates.get(predecessor_id)
            if predecessor_finish is None:
                continue
            candidate = add_working_days(predecessor_finish, 1)
            if candidate > start:
                start = candidate
        start = next_working_day(start)
        finish = add_working_days(start, duration_of(task["estimateDays"]) - 1)
        start_dates[task_id] = start
        finish_dates[task_id] = finish

    project_finish: date | None = None
    for finish in finish_dates.values():
        if project_finish is None or finish > project_finish:
            project_finish = finish

    latest_finish: dict[str, date] = {}
    latest_start: dict[str, date] = {}
    for task_id in reversed(validation.topologicalOrder):
        task = task_by_id.get(task_id)
        if task is None:
            continue
        next_tasks = successors.get(task_id, [])
        if not next_tasks:
            latest = project_finish or finish_dates.get(task_id, project_start)
        else:
            latest = add_working_days(
                latest_start.get(next_tasks[0], project_finish or project_start), -1
            )
            for next_id in next_tasks[1:]:
                candidate = add_working_days(
                    latest_start.get(next_id, project_finish or project_start), -1
                )
                if candidate < latest:
                    latest = candidate
        latest_finish[task_id] = latest
        latest_start[task_id] = add_working_days(
            latest, -(duration_of(task["estimateDays"]) - 1)
        )

    scheduled_tasks: list[dict] = []
    for task in graph["tasks"]:
        start = start_dates.get(task["id"], project_start)
        finish = finish_dates.get(task["id"], start)
        task_latest_finish = latest_finish.get(task["id"], finish)
        slack = working_days_between(finish, task_latest_finish)
        scheduled_tasks.append(
            {
                **task,
                "plannedStart": format_iso_date(start),
                "plannedFinish": format_iso_date(finish),
                "onCriticalPath": slack == 0,
                "slackDays": slack,
                "impacted": False,
            }
        )

    scheduled_tasks.sort(key=lambda task: ((task["plannedStart"] or ""), task["id"]))

    milestones: list[dict] = []
    for milestone in graph["milestones"]:
        scoped = [task for task in scheduled_tasks if task.get("milestoneId") == milestone["id"]]
        if scoped:
            computed = max(task["plannedFinish"] for task in scoped)
        else:
            computed = milestone.get("targetDate") or format_iso_date(project_start)
        target_date = milestone.get("targetDate")
        if target_date:
            target_delta = (parse_iso_date(computed) - parse_iso_date(target_date)).days
        else:
            target_delta = None
        milestones.append(
            {
                **milestone,
                "computedDate": computed,
                "baselineComputedDate": None,
                "deltaDays": 0,
                "targetDeltaDays": target_delta,
                "breached": bool(target_date and computed > target_date),
            }
        )

    milestones.sort(key=lambda milestone: ((milestone["computedDate"] or ""), milestone["title"]))

    critical_path = [task["id"] for task in scheduled_tasks if task["onCriticalPath"]]

    return {
        "valid": True,
        "errors": [],
        "warnings": validation.warnings,
        "tasks": scheduled_tasks,
        "milestones": milestones,
        "projectFinish": format_iso_date(project_finish) if project_finish else None,
        "criticalPathTaskIds": critical_path,
        "assumptions": [],
    }
