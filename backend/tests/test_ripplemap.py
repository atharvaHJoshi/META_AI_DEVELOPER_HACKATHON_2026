"""Unit tests for the RippleMap port (verified against the original engine)."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ripplemap.dates import format_iso_date  # noqa: E402
from ripplemap import (  # noqa: E402
    add_working_days,
    hash_scenario_input,
    parse_iso_date,
    schedule_graph,
    simulate_scenario,
    validate_graph,
)

GRAPH = {
    "projectId": "p1",
    "startDate": "2026-10-26",  # Monday
    "targetDate": "2026-11-20",
    "tasks": [
        {
            "id": "t1", "title": "Foundation", "description": "", "requirementId": None,
            "milestoneId": "m1", "estimateDays": 2, "priority": "P2", "status": "planned",
            "ownerRole": "Engineering", "plannedStart": None, "plannedFinish": None,
            "sourceTicketId": None,
        },
        {
            "id": "t2", "title": "Payment API", "description": "", "requirementId": None,
            "milestoneId": "m1", "estimateDays": 3, "priority": "P1", "status": "planned",
            "ownerRole": "Engineering", "plannedStart": None, "plannedFinish": None,
            "sourceTicketId": None,
        },
        {
            "id": "t3", "title": "Checkout UI", "description": "", "requirementId": None,
            "milestoneId": "m1", "estimateDays": 2, "priority": "P2", "status": "planned",
            "ownerRole": "Engineering", "plannedStart": None, "plannedFinish": None,
            "sourceTicketId": None,
        },
    ],
    "milestones": [
        {"id": "m1", "title": "Payments ready", "targetDate": "2026-11-06", "releaseGate": True},
    ],
    "dependencies": [
        {"predecessorId": "t1", "successorId": "t2", "dependencyType": "finishes_to_start"},
    ],
    "constraints": {"capacityPersonDays": 20},
}

ACCEPT_CHANGE = {
    "option": "accept",
    "tasksToAdd": [
        {
            "tempId": "new-1", "title": "Idempotency fix", "description": "",
            "requirementId": None, "milestoneId": "m1", "estimateDays": 3, "priority": "P0",
            "ownerRole": "Engineering", "dependencies": ["t2"],
        },
        {
            "tempId": "new-2", "title": "Duplicate charge regression test", "description": "",
            "requirementId": None, "milestoneId": "m1", "estimateDays": 1, "priority": "P0",
            "ownerRole": "QA", "dependencies": ["new-1"],
        },
    ],
    "tasksToUpdate": [{"taskId": "t2", "estimateDays": 4}],
    "tasksToRemove": [],
    "dependenciesToAdd": [
        {"predecessorId": "new-2", "successorId": "t3", "dependencyType": "finishes_to_start"},
    ],
    "assumptions": ["The retry path can be reproduced in staging."],
    "rationale": "Protect the release gate.",
}


def test_working_days_skip_weekends() -> None:
    friday = parse_iso_date("2026-10-30")
    assert format_iso_date(add_working_days(friday, 1)) == "2026-11-02"
    assert format_iso_date(add_working_days(friday, 3)) == "2026-11-04"


def test_cycle_detection_reports_path() -> None:
    cyclic = {
        **GRAPH,
        "dependencies": [
            {"predecessorId": "t1", "successorId": "t2", "dependencyType": "finishes_to_start"},
            {"predecessorId": "t2", "successorId": "t3", "dependencyType": "finishes_to_start"},
            {"predecessorId": "t3", "successorId": "t1", "dependencyType": "finishes_to_start"},
        ],
    }
    result = validate_graph(cyclic)
    assert result.valid is False
    assert result.cycles[0] == ["t1", "t2", "t3", "t1"]


def test_dangling_dependency_rejected() -> None:
    result = validate_graph(
        {**GRAPH, "dependencies": [{"predecessorId": "ghost", "successorId": "t2", "dependencyType": "finishes_to_start"}]}
    )
    assert result.valid is False
    assert "does not exist" in " ".join(result.errors)


def test_schedule_is_deterministic() -> None:
    result = schedule_graph(GRAPH)
    assert result["valid"] is True
    assert result["projectFinish"] is not None
    starts = {task["id"]: task["plannedStart"] for task in result["tasks"]}
    by_id = {task["id"]: task for task in result["tasks"]}
    assert starts["t2"] >= starts["t1"]
    assert by_id["t2"]["plannedStart"] > by_id["t1"]["plannedFinish"]
    assert result["projectFinish"] == max(t["plannedFinish"] for t in result["tasks"])


def test_simulate_accept_option_matches_engine() -> None:
    options = {"change": ACCEPT_CHANGE, "relatedTaskIds": ["t2"], "ticketId": "ticket-1"}
    result = simulate_scenario(GRAPH, options)
    assert result["valid"] is True
    assert len(result["diff"]["addedTasks"]) == 2
    assert len(result["diff"]["changedTasks"]) == 2
    assert result["metrics"]["scheduleDeltaDays"] > 0
    assert result["diff"]["targetMilestoneId"] == "m1"
    assert "t3" in result["affectedTaskIds"]
    assert len(result["inputHash"]) == 16

    repeat = simulate_scenario(GRAPH, options)
    assert repeat["inputHash"] == result["inputHash"]
    assert repeat["diff"]["milestoneDeltas"] == result["diff"]["milestoneDeltas"]


def test_simulate_cycle_is_invalid() -> None:
    cyclic_change = {
        **ACCEPT_CHANGE,
        "dependenciesToAdd": [
            {"predecessorId": "new-2", "successorId": "t1", "dependencyType": "finishes_to_start"},
        ],
    }
    result = simulate_scenario(GRAPH, {"change": cyclic_change})
    assert result["valid"] is False
    assert "cycle" in " ".join(result["validationErrors"]).lower()
    assert result["metrics"]["tasksAdded"] == 0


def test_defer_leaves_plan_unchanged() -> None:
    result = simulate_scenario(
        GRAPH,
        {
            "change": {
                "option": "defer",
                "tasksToAdd": [],
                "tasksToUpdate": [],
                "tasksToRemove": [],
                "dependenciesToAdd": [],
                "assumptions": [],
                "rationale": "No capacity this sprint.",
            },
            "relatedTaskIds": ["t2"],
        },
    )
    assert result["valid"] is True
    assert result["metrics"]["tasksAdded"] == 0
    assert result["metrics"]["scheduleDeltaDays"] == 0
    assert any(f["code"] == "UNRESOLVED_DEFERRAL_RISK" for f in result["policyFindings"])


def test_input_hash_is_stable_under_key_order() -> None:
    options_a = {"change": ACCEPT_CHANGE, "relatedTaskIds": ["t2"], "ticketId": "ticket-1"}
    options_b = {"ticketId": "ticket-1", "relatedTaskIds": ["t2"], "change": ACCEPT_CHANGE}
    assert hash_scenario_input({"graph": GRAPH, "options": options_a}) == hash_scenario_input(
        {"graph": GRAPH, "options": options_b}
    )
