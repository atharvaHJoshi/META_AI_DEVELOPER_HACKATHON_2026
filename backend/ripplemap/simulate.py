"""Scenario simulation: apply a proposed change to a plan graph and diff it."""

from __future__ import annotations

from typing import Any

from ripplemap.dates import calendar_days_between
from ripplemap.graph import descendants_of, validate_graph
from ripplemap.hashing import hash_scenario_input
from ripplemap.schedule import schedule_graph

OPTION_LABELS = {
    "accept": "Accept and prioritize now",
    "defer": "Defer to a later sprint",
    "split": "Split into mitigation + permanent fix",
    "clarify": "Request more information",
    "duplicate": "Link to existing work",
}

OPTION_VALUES = tuple(OPTION_LABELS.keys())

OPTION_LABELS_LIST = list(OPTION_LABELS.values())


def _empty_diff(target_milestone_id: str | None) -> dict:
    return {
        "addedTasks": [],
        "changedTasks": [],
        "removedTasks": [],
        "addedDependencies": [],
        "milestoneDeltas": [],
        "criticalPathTaskIds": [],
        "targetMilestoneId": target_milestone_id,
        "targetDeltaDays": 0,
    }


def _zero_metrics() -> dict:
    return {
        "tasksAdded": 0,
        "tasksChanged": 0,
        "tasksRemoved": 0,
        "dependenciesAdded": 0,
        "effortAddedDays": 0,
        "scheduleDeltaDays": 0,
        "milestonesShifted": 0,
        "milestonesBreached": 0,
        "affectedTaskCount": 0,
        "totalEffortDays": 0,
    }


def _invalid_result(option: str, target_milestone_id: str | None, errors: list[str],
                    warnings: list[str], assumptions: list[str], graph: dict,
                    options: dict) -> dict:
    return {
        "option": option,
        "label": OPTION_LABELS[option],
        "valid": False,
        "validationErrors": sorted(set(errors)),
        "validationWarnings": sorted(set(warnings)),
        "diff": _empty_diff(target_milestone_id),
        "metrics": _zero_metrics(),
        "tasks": [],
        "milestones": [],
        "affectedTaskIds": [],
        "affectedMilestoneIds": [],
        "policyFindings": [],
        "assumptions": assumptions,
        "capacity": None,
        "inputHash": hash_scenario_input({"graph": graph, "options": options}),
        "computedAt": _now_iso(),
    }


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _apply_change(graph: dict, change: dict, ticket_id: str | None):
    errors: list[str] = []
    warnings: list[str] = []
    tasks = [dict(task) for task in graph["tasks"]]
    existing_ids = {task["id"] for task in tasks}
    milestone_ids = {milestone["id"] for milestone in graph["milestones"]}
    added_ids: set[str] = set()

    for added in change.get("tasksToAdd", []):
        temp_id = added["tempId"]
        if temp_id in existing_ids:
            errors.append(f'New task ID "{temp_id}" conflicts with an existing task.')
            continue
        if temp_id in added_ids:
            errors.append(f'New task ID "{temp_id}" is used more than once.')
            continue
        if added.get("milestoneId") and added["milestoneId"] not in milestone_ids:
            errors.append(f'New task "{added["title"]}" references an unknown milestone.')
        added_ids.add(temp_id)
        tasks.append(
            {
                "id": temp_id,
                "title": added["title"],
                "description": added.get("description", ""),
                "requirementId": added.get("requirementId"),
                "milestoneId": added.get("milestoneId"),
                "estimateDays": added["estimateDays"],
                "priority": added.get("priority", "P1"),
                "status": "planned",
                "ownerRole": added.get("ownerRole", "Engineering"),
                "plannedStart": None,
                "plannedFinish": None,
                "sourceTicketId": ticket_id,
            }
        )

    for update in change.get("tasksToUpdate", []):
        task = next((item for item in tasks if item["id"] == update["taskId"]), None)
        if task is None:
            errors.append(f'Cannot update task "{update["taskId"]}" because it does not exist.')
            continue
        if "estimateDays" in update and update["estimateDays"] is not None:
            task["estimateDays"] = update["estimateDays"]
        if "priority" in update and update["priority"] is not None:
            task["priority"] = update["priority"]
        if "milestoneId" in update:
            milestone_id = update["milestoneId"]
            if milestone_id and milestone_id not in milestone_ids:
                errors.append(f'Update for "{task["title"]}" references an unknown milestone.')
            else:
                task["milestoneId"] = milestone_id

    for task_id in change.get("tasksToRemove", []):
        if task_id not in existing_ids:
            warnings.append(f'Task "{task_id}" was scheduled for removal but no longer exists.')

    removal_set = set(change.get("tasksToRemove", []))
    remaining_tasks = [task for task in tasks if task["id"] not in removal_set]

    dependencies = [
        dict(dep)
        for dep in graph["dependencies"]
        if dep["predecessorId"] not in removal_set and dep["successorId"] not in removal_set
    ]
    dependency_keys = {f"{dep['predecessorId']}->{dep['successorId']}" for dep in dependencies}

    def add_dependency(predecessor_id: str, successor_id: str, dependency_type: str = "finishes_to_start") -> None:
        key = f"{predecessor_id}->{successor_id}"
        if key in dependency_keys:
            return
        dependency_keys.add(key)
        dependencies.append(
            {
                "predecessorId": predecessor_id,
                "successorId": successor_id,
                "dependencyType": dependency_type,
            }
        )

    for added in change.get("tasksToAdd", []):
        for dependency_id in added.get("dependencies", []):
            add_dependency(dependency_id, added["tempId"])
    for dep in change.get("dependenciesToAdd", []):
        add_dependency(
            dep["predecessorId"],
            dep["successorId"],
            dep.get("dependencyType", "finishes_to_start"),
        )

    return {
        "graph": {**graph, "tasks": remaining_tasks, "dependencies": dependencies},
        "errors": errors,
        "warnings": warnings,
    }


def _find_target_milestone(baseline: dict, scenario: dict, change: dict, options: dict) -> str | None:
    if options.get("targetMilestoneId"):
        return options["targetMilestoneId"]

    added_milestone_ids = [
        task["milestoneId"]
        for task in change.get("tasksToAdd", [])
        if task.get("milestoneId")
    ]
    if added_milestone_ids:
        gates = [
            milestone
            for milestone in scenario["milestones"]
            if milestone["id"] in added_milestone_ids and milestone.get("releaseGate")
        ]
        if gates:
            return gates[-1]["id"]
        return added_milestone_ids[0]

    related_milestones = []
    for task_id in options.get("relatedTaskIds") or []:
        task = next((item for item in scenario["tasks"] if item["id"] == task_id), None)
        if task and task.get("milestoneId"):
            related_milestones.append(task["milestoneId"])
    if related_milestones:
        gates = [
            milestone
            for milestone in scenario["milestones"]
            if milestone["id"] in related_milestones and milestone.get("releaseGate")
        ]
        if gates:
            return gates[-1]["id"]
        return related_milestones[0]

    release_gates = [
        milestone
        for milestone in baseline["milestones"]
        if milestone.get("releaseGate")
    ]
    release_gates.sort(key=lambda milestone: milestone.get("targetDate") or "")
    if release_gates:
        return release_gates[-1]["id"]
    return baseline["milestones"][-1]["id"] if baseline["milestones"] else None


def _build_policy_findings(scenario: dict, option: str, milestones: list[dict],
                            total_effort_days: float) -> list[dict]:
    findings: list[dict] = []
    for milestone in milestones:
        if milestone.get("releaseGate") and milestone.get("breached"):
            findings.append(
                {
                    "severity": "critical",
                    "code": "RELEASE_GATE_BREACH",
                    "message": f'Release gate "{milestone["title"]}" would finish after its target date.',
                }
            )
        elif milestone.get("releaseGate") and (milestone.get("deltaDays") or 0) > 0:
            findings.append(
                {
                    "severity": "warning",
                    "code": "RELEASE_GATE_SLIP",
                    "message": f'Release gate "{milestone["title"]}" moves {milestone["deltaDays"]} day(s) later.',
                }
            )

    capacity = (scenario.get("constraints") or {}).get("capacityPersonDays")
    if capacity and total_effort_days > capacity:
        findings.append(
            {
                "severity": "warning",
                "code": "STATED_CAPACITY_EXCEEDED",
                "message": (
                    f"Scheduled effort ({total_effort_days} person-days) exceeds the stated "
                    f"capacity of {capacity} person-days. Dates are not capacity-levelled."
                ),
            }
        )

    if option == "defer":
        findings.append(
            {
                "severity": "warning",
                "code": "UNRESOLVED_DEFERRAL_RISK",
                "message": "The baseline plan does not change, but the ticket risk remains unresolved and must be tracked separately.",
            }
        )
    if option == "clarify":
        findings.append(
            {
                "severity": "info",
                "code": "EVIDENCE_REQUIRED",
                "message": "No plan change is proposed until the missing evidence is supplied and the analysis is re-run.",
            }
        )

    return findings


def simulate_scenario(graph: dict, options: dict) -> dict:
    change = options["change"]
    option = change["option"]
    baseline_validation = validate_graph(graph)
    applied = _apply_change(graph, change, options.get("ticketId"))
    scenario_graph = applied["graph"]
    scenario_validation = validate_graph(scenario_graph)
    target_milestone_id = _find_target_milestone(graph, scenario_graph, change, options)

    errors = [
        *(f"Baseline: {error}" for error in baseline_validation.errors),
        *applied["errors"],
        *scenario_validation.errors,
    ]
    warnings = [
        *baseline_validation.warnings,
        *applied["warnings"],
        *scenario_validation.warnings,
    ]

    if errors:
        return _invalid_result(option, target_milestone_id, errors, warnings,
                               list(change.get("assumptions", [])), graph, options)

    baseline = schedule_graph(graph)
    scenario = schedule_graph(scenario_graph)
    if not baseline["valid"] or not scenario["valid"]:
        return _invalid_result(
            option,
            target_milestone_id,
            [*baseline["errors"], *scenario["errors"]],
            [*baseline["warnings"], *scenario["warnings"]],
            list(change.get("assumptions", [])),
            graph,
            options,
        )

    baseline_task_map = {task["id"]: task for task in baseline["tasks"]}
    scenario_task_map = {task["id"]: task for task in scenario["tasks"]}
    baseline_dep_keys = {f"{dep['predecessorId']}->{dep['successorId']}" for dep in graph["dependencies"]}

    added_tasks = [
        {
            "id": task["id"],
            "title": task["title"],
            "milestoneId": task.get("milestoneId"),
            "estimateDays": task["estimateDays"],
            "plannedStart": task["plannedStart"],
            "plannedFinish": task["plannedFinish"],
        }
        for task in scenario["tasks"]
        if task["id"] not in baseline_task_map
    ]

    removed_tasks = [
        {"taskId": task["id"], "title": task["title"]}
        for task in baseline["tasks"]
        if task["id"] not in scenario_task_map
    ]

    changed_tasks: list[dict] = []
    for task_id, before in baseline_task_map.items():
        after = scenario_task_map.get(task_id)
        if after is None:
            continue
        fields = [
            ("estimateDays", before["estimateDays"], after["estimateDays"]),
            ("priority", before.get("priority"), after.get("priority")),
            ("milestoneId", before.get("milestoneId"), after.get("milestoneId")),
            ("plannedStart", before.get("plannedStart"), after.get("plannedStart")),
            ("plannedFinish", before.get("plannedFinish"), after.get("plannedFinish")),
        ]
        changes = [
            {"field": field, "before": prior, "after": current}
            for field, prior, current in fields
            if prior != current
        ]
        if changes:
            changed_tasks.append({"taskId": task_id, "title": after["title"], "changes": changes})

    added_dependencies = [
        dep
        for dep in scenario_graph["dependencies"]
        if f"{dep['predecessorId']}->{dep['successorId']}" not in baseline_dep_keys
    ]

    baseline_milestone_map = {milestone["id"]: milestone for milestone in baseline["milestones"]}
    milestone_deltas: list[dict] = []
    for milestone in scenario["milestones"]:
        baseline_milestone = baseline_milestone_map.get(milestone["id"])
        baseline_date = baseline_milestone["computedDate"] if baseline_milestone else None
        delta_days = (
            calendar_days_between(baseline_date, milestone["computedDate"]) if baseline_date else 0
        )
        milestone_deltas.append(
            {
                "milestoneId": milestone["id"],
                "title": milestone["title"],
                "targetDate": milestone.get("targetDate"),
                "baselineDate": baseline_date,
                "simulatedDate": milestone["computedDate"],
                "deltaDays": delta_days,
                "targetDeltaDays": milestone.get("targetDeltaDays"),
                "releaseGate": milestone.get("releaseGate", False),
                "breached": milestone.get("breached", False),
            }
        )

    target_delta = next(
        (delta for delta in milestone_deltas if delta["milestoneId"] == target_milestone_id),
        None,
    )
    target_delta_days = target_delta["deltaDays"] if target_delta else 0

    changed_task_ids = [
        *(task["id"] for task in added_tasks),
        *(task["taskId"] for task in changed_tasks),
        *(task["taskId"] for task in removed_tasks),
    ]
    affected = descendants_of(changed_task_ids, scenario_graph["dependencies"])
    affected.update(changed_task_ids)

    affected_milestone_ids: set[str] = set()
    for task_id in affected:
        task = scenario_task_map.get(task_id)
        if task and task.get("milestoneId"):
            affected_milestone_ids.add(task["milestoneId"])
    for delta in milestone_deltas:
        if delta["deltaDays"] != 0:
            affected_milestone_ids.add(delta["milestoneId"])
    for task in scenario["tasks"]:
        if task.get("milestoneId") and task["milestoneId"] in affected_milestone_ids:
            affected.add(task["id"])

    impacted_tasks = [
        {**task, "impacted": task["id"] in affected} for task in scenario["tasks"]
    ]

    scenarios_milestones = [
        {
            **milestone,
            "baselineComputedDate": (
                baseline_milestone_map.get(milestone["id"], {}).get("computedDate")
            ),
            "deltaDays": next(
                (
                    delta["deltaDays"]
                    for delta in milestone_deltas
                    if delta["milestoneId"] == milestone["id"]
                ),
                0,
            ),
        }
        for milestone in scenario["milestones"]
    ]

    def _num(value: float) -> int | float:
        number = round(value * 10) / 10
        return int(number) if number.is_integer() else number

    total_effort_days = _num(sum(task["estimateDays"] for task in scenario["tasks"]))
    baseline_effort_days = sum(task["estimateDays"] for task in baseline["tasks"])
    effort_added_days = _num(total_effort_days - baseline_effort_days)

    policy_findings = _build_policy_findings(scenario_graph, option, scenarios_milestones, total_effort_days)

    assumptions = list(
        dict.fromkeys(
            [
                *change.get("assumptions", []),
                "Effort is treated as whole working days; weekends are excluded.",
                "Dates use dependency-based earliest-start/earliest-finish scheduling.",
                "No resource levelling, staffing model, or capacity optimisation is applied to task dates.",
                "Estimates come from the stored plan unless the proposal explicitly changes them.",
            ]
        )
    )
    if any(not float(task["estimateDays"]).is_integer() for task in scenario["tasks"]):
        assumptions.append(
            "Fractional effort estimates are rounded up to whole working-day durations."
        )
    if (scenario_graph.get("constraints") or {}).get("capacityPersonDays"):
        assumptions.append(
            "Stated capacity is compared with scheduled effort as an advisory check only."
        )

    return {
        "option": option,
        "label": OPTION_LABELS[option],
        "valid": True,
        "validationErrors": [],
        "validationWarnings": sorted(set(warnings)),
        "diff": {
            "addedTasks": added_tasks,
            "changedTasks": changed_tasks,
            "removedTasks": removed_tasks,
            "addedDependencies": added_dependencies,
            "milestoneDeltas": milestone_deltas,
            "criticalPathTaskIds": scenario["criticalPathTaskIds"],
            "targetMilestoneId": target_milestone_id,
            "targetDeltaDays": target_delta_days,
        },
        "metrics": {
            "tasksAdded": len(added_tasks),
            "tasksChanged": len(changed_tasks),
            "tasksRemoved": len(removed_tasks),
            "dependenciesAdded": len(added_dependencies),
            "effortAddedDays": effort_added_days,
            "scheduleDeltaDays": target_delta_days,
            "milestonesShifted": sum(1 for delta in milestone_deltas if delta["deltaDays"] != 0),
            "milestonesBreached": sum(1 for milestone in scenario["milestones"] if milestone.get("breached")),
            "affectedTaskCount": len(affected),
            "totalEffortDays": total_effort_days,
        },
        "tasks": impacted_tasks,
        "milestones": scenarios_milestones,
        "affectedTaskIds": sorted(affected),
        "affectedMilestoneIds": list(affected_milestone_ids),
        "policyFindings": policy_findings,
        "assumptions": assumptions,
        "capacity": (
            {
                "statedCapacityPersonDays": scenario_graph["constraints"]["capacityPersonDays"],
                "scheduledEffortDays": total_effort_days,
                "utilizationPercent": round(
                    (total_effort_days / scenario_graph["constraints"]["capacityPersonDays"]) * 1000
                )
                / 10,
                "note": "Advisory only — the scheduler does not level resources against this capacity.",
            }
            if (scenario_graph.get("constraints") or {}).get("capacityPersonDays")
            else None
        ),
        "inputHash": hash_scenario_input({"graph": graph, "options": options}),
        "computedAt": _now_iso(),
    }
