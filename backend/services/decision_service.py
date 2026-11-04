"""Decision approval flow — ported from decisionService.ts."""

from __future__ import annotations

import json

from django.db import connection, transaction

from core.common import iso_datetime, new_id
from core.errors import ApiError
from ripplemap import schedule_graph
from services import authz, notification_service
from services.snapshot import build_graph, load_plan_bundle, persist_snapshot
from services.simulation_service import (
    compute_scenario,
    get_latest_scenario,
    mark_proposal_stale,
)
from services.ticket_service import get_decision_proposal
from core.db import fetchall_dicts as _fetchall_dicts, fetchone_dict as _fetchone_dict, parse_json

TICKET_STATUS_BY_OPTION = {
    "accept": "accepted",
    "defer": "deferred",
    "split": "accepted",
    "clarify": "needs_clarification",
    "duplicate": "duplicate",
}

APPROVER_ROLES = ("owner", "pm")


def _proposal_row(cursor, proposal_id: str, *, for_update: bool = False) -> dict | None:
    sql = "SELECT * FROM decision_proposals WHERE id = %s"
    if for_update:
        sql += " FOR UPDATE"
    cursor.execute(sql, [proposal_id])
    return _fetchone_dict(cursor)


def _load_proposal(proposal_id: str) -> dict | None:
    with connection.cursor() as owned:
        return _proposal_row(owned, proposal_id)


def _latest_audit(proposal_id: str) -> dict:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT da.id, da.decision_id, da.actor_id, u.name AS actor_name, da.action,
                   da.reason, da.before_json, da.after_json, da.timestamp
            FROM decision_audit da
            LEFT JOIN users u ON u.id = da.actor_id
            WHERE da.decision_id = %s
            ORDER BY da.timestamp DESC
            LIMIT 1
            """,
            [proposal_id],
        )
        row = _fetchone_dict(cursor)
    if row is None:
        raise ApiError(500, "AUDIT_MISSING", "The decision audit record was not written.")
    return {
        "id": row["id"],
        "decisionId": row["decision_id"],
        "actorId": row["actor_id"],
        "actorName": row["actor_name"],
        "action": row["action"],
        "reason": row["reason"],
        "beforeJson": parse_json(row["before_json"]),
        "afterJson": parse_json(row["after_json"]),
        "timestamp": iso_datetime(row["timestamp"]),
    }


def _write_decision_audit(
    *,
    proposal_id: str,
    actor_id: str,
    action: str,
    reason: str,
    before,
    after,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO decision_audit
              (id, decision_id, actor_id, action, reason, before_json, after_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            [
                new_id("da"),
                proposal_id,
                actor_id,
                action,
                reason,
                json.dumps(before) if before is not None else None,
                json.dumps(after) if after is not None else None,
            ],
        )


def _write_project_audit(
    *,
    project_id: str,
    actor_id: str,
    action: str,
    entity_type: str,
    entity_id: str,
    summary: str,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO audit_events
              (id, project_id, actor_id, action, entity_type, entity_id, summary)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            [new_id("audit"), project_id, actor_id, action, entity_type, entity_id, summary],
        )


def _apply_plan_changes(
    proposal: dict,
    bundle: dict,
    option: str,
    change: dict,
    scenario: dict,
    user_id: str,
) -> dict:
    requirement_ids = {requirement.id for requirement in bundle["requirements"]}
    milestone_ids = {milestone.id for milestone in bundle["milestones"]}
    existing_task_ids = {task.id for task in bundle["tasks"]}

    temp_to_real: dict[str, str] = {}
    for task in change.get("tasksToAdd", []):
        if task["tempId"] in existing_task_ids:
            raise ApiError(
                422,
                "INVALID_PROPOSED_CHANGE",
                f'New task "{task["tempId"]}" conflicts with an existing task.',
            )
        temp_to_real[task["tempId"]] = new_id("task")

    def resolve_task_id(value: str) -> str | None:
        return temp_to_real.get(value) or (value if value in existing_task_ids else None)

    project_id = proposal["project_id"]
    ticket_id = proposal["ticket_id"]

    with connection.cursor() as cursor:
        for task in change.get("tasksToAdd", []):
            if task.get("requirementId") and task["requirementId"] not in requirement_ids:
                raise ApiError(422, "INVALID_PROPOSED_CHANGE", "A new task references an unknown requirement.")
            if task.get("milestoneId") and task["milestoneId"] not in milestone_ids:
                raise ApiError(422, "INVALID_PROPOSED_CHANGE", "A new task references an unknown milestone.")
            cursor.execute(
                """
                INSERT INTO tasks
                  (id, project_id, requirement_id, milestone_id, title, description, status,
                   estimate_days, priority, owner_role, source_ticket_id)
                VALUES (%s, %s, %s, %s, %s, %s, 'planned', %s, %s, %s, %s)
                """,
                [
                    temp_to_real[task["tempId"]],
                    project_id,
                    task.get("requirementId"),
                    task.get("milestoneId"),
                    task["title"],
                    task.get("description", ""),
                    task["estimateDays"],
                    task.get("priority", "P1"),
                    task.get("ownerRole", "Engineering"),
                    ticket_id,
                ],
            )

        for update in change.get("tasksToUpdate", []):
            if update["taskId"] not in existing_task_ids:
                raise ApiError(
                    422,
                    "INVALID_PROPOSED_CHANGE",
                    "An update references a task that no longer exists.",
                )
            if update.get("milestoneId") and update["milestoneId"] not in milestone_ids:
                raise ApiError(422, "INVALID_PROPOSED_CHANGE", "An update references an unknown milestone.")
            apply_milestone = update.get("milestoneId") is not None
            cursor.execute(
                """
                UPDATE tasks
                SET estimate_days = COALESCE(%s, estimate_days),
                    priority = COALESCE(%s, priority),
                    milestone_id = CASE WHEN %s THEN %s ELSE milestone_id END
                WHERE id = %s AND project_id = %s
                """,
                [
                    update.get("estimateDays"),
                    update.get("priority"),
                    apply_milestone,
                    update.get("milestoneId"),
                    update["taskId"],
                    project_id,
                ],
            )

        for task_id in change.get("tasksToRemove", []):
            if task_id not in existing_task_ids:
                continue
            cursor.execute(
                "DELETE FROM tasks WHERE id = %s AND project_id = %s",
                [task_id, project_id],
            )

        dependency_keys: set[str] = set()
        for task in change.get("tasksToAdd", []):
            for dependency_id in task.get("dependencies", []):
                predecessor = resolve_task_id(dependency_id)
                successor = temp_to_real[task["tempId"]]
                if not predecessor:
                    raise ApiError(422, "INVALID_PROPOSED_CHANGE", "A new task depends on an unknown task.")
                key = f"{predecessor}->{successor}"
                if key in dependency_keys:
                    continue
                dependency_keys.add(key)
                cursor.execute(
                    """
                    INSERT INTO task_dependencies (predecessor_task_id, successor_task_id, dependency_type)
                    VALUES (%s, %s, 'finishes_to_start')
                    ON CONFLICT DO NOTHING
                    """,
                    [predecessor, successor],
                )
        for dependency in change.get("dependenciesToAdd", []):
            predecessor = resolve_task_id(dependency["predecessorId"])
            successor = resolve_task_id(dependency["successorId"])
            if not predecessor or not successor:
                raise ApiError(
                    422,
                    "INVALID_PROPOSED_CHANGE",
                    "A proposed dependency references an unknown task.",
                )
            key = f"{predecessor}->{successor}"
            if key in dependency_keys:
                continue
            dependency_keys.add(key)
            cursor.execute(
                """
                INSERT INTO task_dependencies (predecessor_task_id, successor_task_id, dependency_type)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                [predecessor, successor, dependency.get("dependencyType", "finishes_to_start")],
            )

    updated = load_plan_bundle(project_id)
    if updated is None:
        raise ApiError(404, "PROJECT_NOT_FOUND", "Project not found.")

    schedule = schedule_graph(build_graph(updated))
    if not schedule["valid"]:
        raise ApiError(
            422,
            "INVALID_PLAN_AFTER_APPROVAL",
            "The change would leave the plan in an invalid state.",
            schedule["errors"],
        )

    with connection.cursor() as cursor:
        for task in schedule["tasks"]:
            cursor.execute(
                """
                UPDATE tasks SET planned_start = %s, planned_finish = %s
                WHERE id = %s AND project_id = %s
                """,
                [task["plannedStart"], task["plannedFinish"], task["id"], project_id],
            )

    for task in updated["tasks"]:
        scheduled = next(
            (item for item in schedule["tasks"] if item["id"] == task.id), None
        )
        if scheduled:
            task.planned_start = scheduled["plannedStart"]
            task.planned_finish = scheduled["plannedFinish"]

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id FROM plan_versions
            WHERE project_id = %s AND version_number = %s
            """,
            [project_id, updated["project"].current_plan_version],
        )
        previous_version = _fetchone_dict(cursor)

    next_version = updated["project"].current_plan_version + 1
    added_titles = [task["title"] for task in change.get("tasksToAdd", [])]
    summary = (
        f"{'Split mitigation approved' if option == 'split' else 'Change approved'} "
        f"for ticket {ticket_id}: {'; '.join(added_titles)}. "
        f"Scenario {scenario['inputHash']}: release impact {scenario['metrics']['scheduleDeltaDays']} day(s), "
        f"{scenario['metrics']['affectedTaskCount']} affected task(s)."
    )

    persist_snapshot(
        updated,
        next_version,
        id=new_id("pv"),
        parent_version_id=(previous_version or {}).get("id"),
        change_summary=summary,
        created_by=user_id,
    )

    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE projects SET current_plan_version = %s, updated_at = now() WHERE id = %s",
            [next_version, project_id],
        )
        cursor.execute(
            """
            UPDATE decision_proposals SET status = 'stale'
            WHERE project_id = %s AND status = 'pending' AND id <> %s
            RETURNING id, base_plan_version
            """,
            [project_id, proposal["id"]],
        )
        stale_siblings = _fetchall_dicts(cursor)
        for sibling in stale_siblings:
            cursor.execute(
                """
                INSERT INTO decision_audit
                  (id, decision_id, actor_id, action, reason, before_json, after_json)
                VALUES (%s, %s, %s, 'stale', %s, %s, %s)
                """,
                [
                    new_id("da"),
                    sibling["id"],
                    user_id,
                    (
                        f"Plan version {next_version} was created from decision {proposal['id']}; "
                        f"this proposal was computed against version {sibling['base_plan_version']} and must be re-analysed."
                    ),
                    json.dumps(
                        {"status": "pending", "basePlanVersion": sibling["base_plan_version"]}
                    ),
                    json.dumps({"status": "stale", "currentPlanVersion": next_version}),
                ],
            )

    if stale_siblings:
        _write_project_audit(
            project_id=project_id,
            actor_id=user_id,
            action="decision.stale",
            entity_type="project",
            entity_id=project_id,
            summary=f"{len(stale_siblings)} sibling proposal(s) marked stale after plan version {next_version}.",
        )

    return {"planVersionNumber": next_version, "summary": summary}


def _outcome(proposal_id: str, user_id: str, scenario: dict | None, plan_version_number, message: str) -> dict:
    proposal = get_decision_proposal(user_id, proposal_id)
    return {
        "proposal": proposal,
        "scenario": scenario,
        "planVersionNumber": plan_version_number,
        "audit": _latest_audit(proposal_id),
        "message": message,
    }


def approve_decision(user_id: str, proposal_id: str, option: str, reason: str) -> dict:
    initial = _load_proposal(proposal_id)
    if initial is None:
        raise ApiError(404, "DECISION_NOT_FOUND", "Decision proposal not found.")
    authz.assert_project_access(user_id, initial["project_id"], APPROVER_ROLES)

    if option == "clarify":
        raise ApiError(
            422,
            "USE_CLARIFY_ACTION",
            "Use the clarify action to request more information instead of approving.",
        )
    if option == "duplicate" and not parse_json(initial.get("duplicate_candidates_json"), []):
        raise ApiError(
            422,
            "NO_DUPLICATE_CANDIDATE",
            "This proposal did not identify a duplicate candidate.",
        )

    with transaction.atomic():
        with connection.cursor() as cursor:
            proposal = _proposal_row(cursor, proposal_id, for_update=True)
            assert proposal is not None
            if proposal["status"] != "pending":
                raise ApiError(
                    409,
                    "DECISION_NOT_PENDING",
                    f"This proposal is {proposal['status']} and cannot be approved.",
                )
            cursor.execute(
                "SELECT current_plan_version FROM projects WHERE id = %s FOR UPDATE",
                [proposal["project_id"]],
            )
            project_row = _fetchone_dict(cursor)
        if project_row is None:
            raise ApiError(404, "PROJECT_NOT_FOUND", "Project not found.")
        current_version = project_row["current_plan_version"]
        if current_version != proposal["base_plan_version"]:
            mark_proposal_stale(
                proposal,
                user_id,
                (
                    f"Plan moved to version {current_version} after the proposal was "
                    f"computed on version {proposal['base_plan_version']}."
                ),
            )
            raise ApiError(
                409,
                "STALE_PROPOSAL",
                f"The plan moved to version {current_version} after this proposal was generated. Re-analyse the ticket before approving.",
            )

        bundle = load_plan_bundle(proposal["project_id"])
        if bundle is None:
            raise ApiError(404, "PROJECT_NOT_FOUND", "Project not found.")

        computation = compute_scenario(bundle, proposal, option)
        scenario = computation["scenario"]
        if not scenario["valid"]:
            raise ApiError(
                422,
                "SCENARIO_INVALID",
                "The selected scenario is invalid and cannot be approved.",
                scenario["validationErrors"],
            )

        stored = get_latest_scenario(proposal["id"], option)
        if stored is None:
            raise ApiError(
                409,
                "SCENARIO_REQUIRED",
                "Simulate this option before approving it.",
            )
        if not stored["valid"]:
            raise ApiError(
                422,
                "SCENARIO_INVALID",
                "The stored scenario for this option is invalid. Simulate again after correcting the proposal.",
            )
        if stored["input_hash"] != scenario["inputHash"]:
            raise ApiError(
                409,
                "SCENARIO_STALE",
                "The stored scenario does not match the current plan. Simulate the option again before approving.",
            )

        if option in {"accept", "split"}:
            applied = _apply_plan_changes(
                proposal, bundle, option, computation["change"], scenario, user_id
            )
        else:
            applied = {
                "planVersionNumber": None,
                "summary": (
                    "Deferred without changing the plan."
                    if option == "defer"
                    else "Linked as a duplicate without changing the plan."
                ),
            }

        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE decision_proposals SET status = 'approved' WHERE id = %s",
                [proposal["id"]],
            )
            cursor.execute(
                "UPDATE tickets SET status = %s WHERE id = %s",
                [TICKET_STATUS_BY_OPTION[option], proposal["ticket_id"]],
            )

        after = {
            "status": "approved",
            "option": option,
            "planVersionNumber": applied["planVersionNumber"],
            "scenario": scenario,
        }
        _write_decision_audit(
            proposal_id=proposal["id"],
            actor_id=user_id,
            action="approved",
            reason=reason,
            before={
                "status": proposal["status"],
                "basePlanVersion": proposal["base_plan_version"],
                "recommendation": proposal["recommendation"],
            },
            after=after,
        )
        _write_project_audit(
            project_id=proposal["project_id"],
            actor_id=user_id,
            action="decision.approved",
            entity_type="decision",
            entity_id=proposal["id"],
            summary=f'Decision {proposal["id"]} approved as "{option}". {applied["summary"]}',
        )
        if applied["planVersionNumber"] is not None:
            _write_project_audit(
                project_id=proposal["project_id"],
                actor_id=user_id,
                action="plan.versioned",
                entity_type="project",
                entity_id=proposal["project_id"],
                summary=f"Plan version {applied['planVersionNumber']} created from decision {proposal['id']}.",
            )

    notification_service.notify_decision_outcome(user_id, proposal_id, "approved")
    message = (
        f'Decision approved as "{option}". The plan is unchanged and the outcome is recorded in the audit trail.'
        if applied["planVersionNumber"] is None
        else f'Decision approved as "{option}". Plan version {applied["planVersionNumber"]} now contains the approved change.'
    )
    proposal = get_decision_proposal(user_id, proposal_id)
    stored_scenario = next(
        (run["output"] for run in proposal["scenarioRuns"] if run["option"] == option),
        None,
    )
    return {
        "proposal": proposal,
        "scenario": stored_scenario,
        "planVersionNumber": applied["planVersionNumber"],
        "audit": _latest_audit(proposal_id),
        "message": message,
    }


def reject_decision(user_id: str, proposal_id: str, reason: str) -> dict:
    initial = _load_proposal(proposal_id)
    if initial is None:
        raise ApiError(404, "DECISION_NOT_FOUND", "Decision proposal not found.")
    authz.assert_project_access(user_id, initial["project_id"], APPROVER_ROLES)

    with transaction.atomic():
        with connection.cursor() as cursor:
            proposal = _proposal_row(cursor, proposal_id, for_update=True)
            assert proposal is not None
            if proposal["status"] != "pending":
                raise ApiError(409, "DECISION_NOT_PENDING", f"This proposal is {proposal['status']}.")
            cursor.execute(
                "UPDATE decision_proposals SET status = 'rejected' WHERE id = %s",
                [proposal["id"]],
            )
            cursor.execute(
                "UPDATE tickets SET status = 'rejected' WHERE id = %s",
                [proposal["ticket_id"]],
            )
        _write_decision_audit(
            proposal_id=proposal["id"],
            actor_id=user_id,
            action="rejected",
            reason=reason,
            before={"status": proposal["status"], "recommendation": proposal["recommendation"]},
            after={"status": "rejected"},
        )
        _write_project_audit(
            project_id=proposal["project_id"],
            actor_id=user_id,
            action="decision.rejected",
            entity_type="decision",
            entity_id=proposal["id"],
            summary=f"Decision {proposal['id']} rejected: {reason}",
        )
    notification_service.notify_decision_outcome(user_id, proposal_id, "rejected")
    return _outcome(
        proposal_id,
        user_id,
        None,
        None,
        "Decision rejected. The plan was not changed.",
    )


def clarify_decision(user_id: str, proposal_id: str, input_data: dict) -> dict:
    initial = _load_proposal(proposal_id)
    if initial is None:
        raise ApiError(404, "DECISION_NOT_FOUND", "Decision proposal not found.")
    authz.assert_project_access(user_id, initial["project_id"], APPROVER_ROLES)

    questions = list(
        dict.fromkeys(
            [*parse_json(initial.get("clarifying_questions_json"), []), *(input_data.get("questions") or [])]
        )
    )
    with transaction.atomic():
        with connection.cursor() as cursor:
            proposal = _proposal_row(cursor, proposal_id, for_update=True)
            assert proposal is not None
            if proposal["status"] != "pending":
                raise ApiError(409, "DECISION_NOT_PENDING", f"This proposal is {proposal['status']}.")
            cursor.execute(
                "UPDATE decision_proposals SET status = 'clarified', clarifying_questions_json = %s WHERE id = %s",
                [json.dumps(questions), proposal["id"]],
            )
            cursor.execute(
                "UPDATE tickets SET status = 'needs_clarification' WHERE id = %s",
                [proposal["ticket_id"]],
            )
        _write_decision_audit(
            proposal_id=proposal["id"],
            actor_id=user_id,
            action="clarified",
            reason=input_data.get("reason", ""),
            before={"status": proposal["status"], "questions": parse_json(proposal.get("clarifying_questions_json"), [])},
            after={"status": "clarified", "questions": questions},
        )
        _write_project_audit(
            project_id=proposal["project_id"],
            actor_id=user_id,
            action="decision.clarified",
            entity_type="decision",
            entity_id=proposal["id"],
            summary=f"Clarification requested on decision {proposal['id']}: {input_data.get('reason', '')}",
        )
    notification_service.notify_decision_outcome(user_id, proposal_id, "clarified")
    return _outcome(
        proposal_id,
        user_id,
        None,
        None,
        "Clarification requested. The plan was not changed.",
    )


def list_decision_queue(user_id: str, workspace_id: str, status: str = "pending") -> list[dict]:
    authz.assert_workspace_access(user_id, workspace_id)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT dp.id, dp.project_id, p.name AS project_name, dp.ticket_id,
                   t.title AS ticket_title, dp.status, dp.recommendation,
                   COALESCE(t.severity_reported, 'medium') AS priority, dp.created_at
            FROM decision_proposals dp
            JOIN tickets t ON t.id = dp.ticket_id
            JOIN projects p ON p.id = dp.project_id
            LEFT JOIN workspaces w ON w.id = p.workspace_id
            LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = %s
            LEFT JOIN workspace_members wm ON wm.workspace_id = p.workspace_id AND wm.user_id = %s
            LEFT JOIN organization_members om
              ON om.organization_id = COALESCE(p.organization_id, w.organization_id) AND om.user_id = %s
            WHERE p.workspace_id = %s
              AND (pm.user_id = %s OR wm.user_id = %s OR om.user_id = %s)
              AND (%s::text = 'all' OR dp.status = 'pending')
            ORDER BY CASE dp.recommendation
                       WHEN 'accept' THEN 0
                       WHEN 'split' THEN 1
                       WHEN 'clarify' THEN 2
                       ELSE 3
                     END,
                     dp.created_at DESC
            LIMIT 100
            """,
            [user_id, user_id, user_id, workspace_id, user_id, user_id, user_id, status],
        )
        rows = _fetchall_dicts(cursor)
    return [
        {
            "id": row["id"],
            "projectId": row["project_id"],
            "projectName": row["project_name"],
            "ticketId": row["ticket_id"],
            "ticketTitle": row["ticket_title"],
            "status": row["status"],
            "recommendation": row["recommendation"],
            "priority": row["priority"],
            "createdAt": iso_datetime(row["created_at"]),
        }
        for row in rows
    ]
