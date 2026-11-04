"""Decision simulation wiring — ported from simulationService.ts."""

from __future__ import annotations

import json

from django.db import connection
from django.db import transaction

from core.common import new_id
from core.errors import ApiError
from ripplemap import simulate_scenario
from ripplemap.simulate import OPTION_LABELS
from services import authz
from services.snapshot import build_graph, load_plan_bundle
from core.db import fetchall_dicts, fetchone_dict, parse_json

OPTION_EMPTY = ("defer", "clarify", "duplicate")


def empty_option_change(option: str) -> dict:
    return {
        "option": option,
        "tasksToAdd": [],
        "tasksToUpdate": [],
        "tasksToRemove": [],
        "dependenciesToAdd": [],
        "assumptions": [OPTION_LABELS[option]],
        "rationale": f"{OPTION_LABELS[option]} does not mutate the stored plan.",
    }


def change_for_proposal_option(proposal: dict, option: str) -> dict:
    changes = parse_json(proposal.get("proposed_changes_json"), {})
    if option == "accept":
        change = changes.get("accept")
        if not change:
            raise ApiError(422, "ACCEPT_NOT_AVAILABLE", "This proposal does not contain an accept option.")
        return change
    if option == "split":
        change = changes.get("split")
        if not change:
            raise ApiError(422, "SPLIT_NOT_AVAILABLE", "This proposal does not contain a split option.")
        return change
    return empty_option_change(option)


def related_context(proposal: dict, bundle: dict) -> dict:
    records = parse_json(proposal.get("related_records_json"), [])
    related_task_ids = sorted(
        record.get("entityId")
        for record in records
        if isinstance(record, dict)
        and record.get("entityType") == "task"
        and record.get("entityId")
    )
    target_milestone_id = next(
        (
            record.get("entityId")
            for record in records
            if isinstance(record, dict)
            and record.get("entityType") == "milestone"
            and record.get("entityId")
        ),
        None,
    )
    if target_milestone_id is None:
        for task in bundle["tasks"]:
            if task.milestone_id and task.id in related_task_ids:
                target_milestone_id = task.milestone_id
                break
    return {"relatedTaskIds": related_task_ids, "targetMilestoneId": target_milestone_id}


def compute_scenario(bundle: dict, proposal: dict, option: str) -> dict:
    change = change_for_proposal_option(proposal, option)
    graph = build_graph(bundle)
    context = related_context(proposal, bundle)
    scenario = simulate_scenario(
        graph,
        {
            "change": change,
            "targetMilestoneId": context["targetMilestoneId"],
            "relatedTaskIds": context["relatedTaskIds"],
            "ticketId": proposal["ticket_id"],
        },
    )
    return {"scenario": scenario, "change": change}


def persist_scenario(proposal_id: str, scenario: dict) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO scenario_runs
              (id, proposal_id, option, label, input_hash, output_json, valid, validation_errors_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                new_id("scn"),
                proposal_id,
                scenario["option"],
                scenario["label"],
                scenario["inputHash"],
                json.dumps(scenario),
                scenario["valid"],
                json.dumps(scenario["validationErrors"]),
            ],
        )


def get_latest_scenario(proposal_id: str, option: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT * FROM scenario_runs
            WHERE proposal_id = %s AND option = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            [proposal_id, option],
        )
        row = cursor.fetchone()
        if row is None:
            return None
        columns = [column[0] for column in cursor.description]
        return dict(zip(columns, row))


def mark_proposal_stale(proposal: dict, actor_id: str | None, reason: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE decision_proposals SET status = 'stale' WHERE id = %s",
            [proposal["id"]],
        )
        cursor.execute(
            """
            INSERT INTO decision_audit
              (id, decision_id, actor_id, action, reason, before_json, after_json)
            VALUES (%s, %s, %s, 'stale', %s, %s, %s)
            """,
            [
                new_id("da"),
                proposal["id"],
                actor_id,
                reason,
                json.dumps(
                    {
                        "status": proposal.get("status"),
                        "basePlanVersion": proposal.get("base_plan_version"),
                    }
                ),
                json.dumps({"status": "stale"}),
            ],
        )


def _current_plan_version(project_id: str) -> int:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT current_plan_version FROM projects WHERE id = %s", [project_id]
        )
        row = cursor.fetchone()
    if row is None:
        raise ApiError(404, "PROJECT_NOT_FOUND", "Project not found.")
    return row[0]


def simulate_decision(
    user_id: str,
    proposal_id: str,
    option: str,
    baseline_version: int | None = None,
) -> dict:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM decision_proposals WHERE id = %s", [proposal_id])
        row = fetchone_dict(cursor)
    if row is None:
        raise ApiError(404, "DECISION_NOT_FOUND", "Decision proposal not found.")
    authz.assert_project_access(user_id, row["project_id"], ("owner", "pm", "member"))
    if row["status"] != "pending":
        raise ApiError(
            409,
            "DECISION_NOT_PENDING",
            f"This proposal is {row['status']} and can no longer be simulated.",
        )

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT * FROM decision_proposals WHERE id = %s FOR UPDATE",
                [proposal_id],
            )
            locked = fetchone_dict(cursor)
        if locked["status"] != "pending":
            raise ApiError(409, "DECISION_NOT_PENDING", "This proposal is no longer pending.")
        version = _current_plan_version(locked["project_id"])
        if baseline_version is not None and baseline_version != locked["base_plan_version"]:
            raise ApiError(
                409,
                "BASELINE_VERSION_MISMATCH",
                (
                    f"The proposal was computed against plan version {locked['base_plan_version']}; "
                    f"the request expected version {baseline_version}."
                ),
            )
        if version != locked["base_plan_version"]:
            mark_proposal_stale(
                locked,
                user_id,
                f"Plan version {version} is newer than proposal baseline {locked['base_plan_version']}.",
            )
            raise ApiError(
                409,
                "STALE_PROPOSAL",
                f"The plan moved to version {version} after this proposal was generated. Re-analyse the ticket to regenerate the decision.",
            )
        bundle = load_plan_bundle(locked["project_id"])
        if bundle is None:
            raise ApiError(404, "PROJECT_NOT_FOUND", "Project not found.")
        computation = compute_scenario(bundle, locked, option)
        persist_scenario(locked["id"], computation["scenario"])
        return computation["scenario"]


