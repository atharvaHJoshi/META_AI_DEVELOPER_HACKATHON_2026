"""Ticket analysis and proposal creation — ported from ticketService.ts."""

from __future__ import annotations

import json
from typing import Any

from django.db import connection, transaction
from django.utils import timezone

from aiml import apply_policy, demo_analyze_ticket
from aiml import gemini as gemini_provider
from aiml.schemas import validate_ticket_analysis
from core import config
from core.common import iso_date, iso_datetime, new_id, num
from core.errors import ApiError
from ripplemap import simulate_scenario
from ripplemap.simulate import OPTION_LABELS
from services import authz, notification_service, plan_service, rate_limit
from services.snapshot import build_graph, constraints_of, load_plan_bundle
from core.db import fetchall_dicts as _fetchall_dicts, fetchone_dict as _fetchone_dict, parse_json

CONTRIBUTOR_ROLES = ("owner", "pm", "member")
ALL_OPTIONS = ("accept", "defer", "clarify", "duplicate")


def map_ticket(row) -> dict:
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "title": row["title"],
        "description": row["description"],
        "source": row["source"],
        "ticketType": row["ticket_type"],
        "affectedComponent": row["affected_component"],
        "reportedImpact": row["reported_impact"],
        "evidence": row["evidence"],
        "reporter": row["reporter"],
        "environment": row["environment"],
        "severityReported": row["severity_reported"],
        "status": row["status"],
        "createdBy": row["created_by"],
        "createdAt": iso_datetime(row["created_at"]),
        "analyzedAt": iso_datetime(row["analyzed_at"]),
    }


def _ticket_row(ticket_id: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM tickets WHERE id = %s", [ticket_id])
        return _fetchone_dict(cursor)


def _proposal_row(proposal_id: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM decision_proposals WHERE id = %s", [proposal_id])
        return _fetchone_dict(cursor)


def _scenarios_for(proposal_ids: list[str]) -> list[dict]:
    if not proposal_ids:
        return []
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT * FROM scenario_runs
            WHERE proposal_id = ANY(%s::text[])
            ORDER BY created_at ASC
            """,
            [proposal_ids],
        )
        return _fetchall_dicts(cursor)


def _latest_proposal(ticket_id: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT * FROM decision_proposals
            WHERE ticket_id = %s ORDER BY created_at DESC LIMIT 1
            """,
            [ticket_id],
        )
        return _fetchone_dict(cursor)


def map_proposal(row: dict, scenarios: list[dict]) -> dict:
    return {
        "id": row["id"],
        "ticketId": row["ticket_id"],
        "projectId": row["project_id"],
        "basePlanVersion": row["base_plan_version"],
        "recommendation": row["recommendation"],
        "summary": row["summary"],
        "classification": parse_json(row["classification_json"], {}),
        "policy": parse_json(row["policy_json"], {}),
        "evidence": parse_json(row["evidence_json"], []),
        "unknowns": parse_json(row["unknowns_json"], []),
        "clarifyingQuestions": parse_json(row["clarifying_questions_json"], []),
        "relatedRecords": parse_json(row["related_records_json"], []),
        "duplicateCandidates": parse_json(row["duplicate_candidates_json"], []),
        "proposedChanges": parse_json(row["proposed_changes_json"], {}),
        "status": row["status"],
        "modelProvider": row["model_provider"],
        "modelName": row["model_name"],
        "modelMeta": parse_json(row["model_meta_json"]),
        "recommendationRationale": row["recommendation_rationale"],
        "createdAt": iso_datetime(row["created_at"]),
        "scenarioRuns": [
            {
                "id": scenario["id"],
                "option": scenario["option"],
                "label": scenario["label"],
                "valid": scenario["valid"],
                "output": parse_json(scenario["output_json"], {}),
                "inputHash": scenario["input_hash"],
                "createdAt": iso_datetime(scenario["created_at"]),
            }
            for scenario in scenarios
        ],
    }


def get_decision_proposal(user_id: str, proposal_id: str) -> dict:
    row = _proposal_row(proposal_id)
    if row is None:
        raise ApiError(404, "DECISION_NOT_FOUND", "Decision proposal not found.")
    authz.assert_project_access(user_id, row["project_id"])
    scenarios = _scenarios_for([row["id"]])
    return map_proposal(row, scenarios)


def get_ticket_detail(user_id: str, ticket_id: str) -> dict:
    row = _ticket_row(ticket_id)
    if row is None:
        raise ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.")
    authz.assert_project_access(user_id, row["project_id"])

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT tl.id, tl.ticket_id, tl.entity_type, tl.entity_id,
                   CASE tl.entity_type
                     WHEN 'requirement' THEN (SELECT title FROM requirements WHERE id = tl.entity_id)
                     WHEN 'task' THEN (SELECT title FROM tasks WHERE id = tl.entity_id)
                     WHEN 'milestone' THEN (SELECT title FROM milestones WHERE id = tl.entity_id)
                     WHEN 'ticket' THEN (SELECT title FROM tickets WHERE id = tl.entity_id)
                   END AS entity_label,
                   tl.relationship_type, tl.evidence_state, tl.rationale, tl.confirmed
            FROM ticket_links tl
            WHERE tl.ticket_id = %s
            ORDER BY tl.created_at ASC
            """,
            [ticket_id],
        )
        links = _fetchall_dicts(cursor)
        cursor.execute(
            """
            SELECT da.id, da.decision_id, da.actor_id, u.name AS actor_name,
                   da.action, da.reason, da.before_json, da.after_json, da.timestamp
            FROM decision_audit da
            LEFT JOIN users u ON u.id = da.actor_id
            WHERE da.decision_id IN (
              SELECT id FROM decision_proposals WHERE ticket_id = %s
            )
            ORDER BY da.timestamp ASC
            """,
            [ticket_id],
        )
        audits = _fetchall_dicts(cursor)

    proposal_row = _latest_proposal(ticket_id)
    scenarios = _scenarios_for([proposal_row["id"]]) if proposal_row else []

    return {
        "ticket": map_ticket(row),
        "links": [
            {
                "id": link["id"],
                "ticketId": link["ticket_id"],
                "entityType": link["entity_type"],
                "entityId": link["entity_id"],
                "entityLabel": link["entity_label"],
                "relationshipType": link["relationship_type"],
                "evidenceState": link["evidence_state"],
                "rationale": link["rationale"],
                "confirmed": link["confirmed"],
            }
            for link in links
        ],
        "proposal": map_proposal(proposal_row, scenarios) if proposal_row else None,
        "audits": [
            {
                "id": audit["id"],
                "decisionId": audit["decision_id"],
                "actorId": audit["actor_id"],
                "actorName": audit["actor_name"],
                "action": audit["action"],
                "reason": audit["reason"],
                "beforeJson": parse_json(audit["before_json"]),
                "afterJson": parse_json(audit["after_json"]),
                "timestamp": iso_datetime(audit["timestamp"]),
            }
            for audit in audits
        ],
    }


def create_ticket(user_id: str, input_data: dict) -> dict:
    authz.assert_project_access(user_id, input_data["projectId"], CONTRIBUTOR_ROLES)

    ticket_id = new_id("tkt")
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO tickets
                  (id, project_id, title, description, source, ticket_type, affected_component,
                   reported_impact, evidence, reporter, environment, severity_reported, status, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'new', %s)
                """,
                [
                    ticket_id,
                    input_data["projectId"],
                    input_data["title"],
                    input_data["description"],
                    input_data.get("source", "manual"),
                    input_data.get("ticketType"),
                    input_data.get("affectedComponent", ""),
                    input_data.get("reportedImpact", ""),
                    input_data.get("evidence", ""),
                    input_data.get("reporter") or input_data.get("source", "manual"),
                    input_data.get("environment", ""),
                    input_data.get("severityReported", "unspecified"),
                    user_id,
                ],
            )
            cursor.execute(
                """
                INSERT INTO audit_events
                  (id, project_id, actor_id, action, entity_type, entity_id, summary)
                VALUES (%s, %s, %s, 'ticket.created', 'ticket', %s, %s)
                """,
                [
                    new_id("audit"),
                    input_data["projectId"],
                    user_id,
                    ticket_id,
                    f"Ticket created from {input_data.get('source', 'manual')}: {input_data['title']}",
                ],
            )
    notification_service.notify_ticket_created(user_id, ticket_id)
    return get_ticket_detail(user_id, ticket_id)


def _build_analysis_context(bundle: dict, ticket: dict, related_tickets: list[dict]) -> dict:
    upstream: dict[str, list[str]] = {}
    downstream: dict[str, list[str]] = {}
    for dep in bundle["dependencies"]:
        downstream.setdefault(dep["predecessor_id"], []).append(dep["successor_id"])
        upstream.setdefault(dep["successor_id"], []).append(dep["predecessor_id"])

    milestone_title = {milestone.id: milestone.title for milestone in bundle["milestones"]}
    project = bundle["project"]

    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "goal": project.goal,
            "startDate": iso_date(project.start_date),
            "targetDate": iso_date(project.target_date),
            "planVersion": project.current_plan_version,
            "constraints": constraints_of(project),
            "currentPlanAssumptions": bundle["assumptions"],
        },
        "requirements": [
            {
                "id": requirement.id,
                "title": requirement.title,
                "description": requirement.description,
                "acceptanceCriteria": list(requirement.acceptance_criteria or []),
            }
            for requirement in bundle["requirements"]
        ],
        "milestones": [
            {
                "id": milestone.id,
                "title": milestone.title,
                "targetDate": iso_date(milestone.target_date),
                "releaseGate": milestone.release_gate,
            }
            for milestone in bundle["milestones"]
        ],
        "tasks": [
            {
                "id": task.id,
                "title": task.title,
                "description": task.description,
                "status": task.status,
                "priority": task.priority,
                "estimateDays": num(task.estimate_days),
                "requirementId": task.requirement_id,
                "milestoneId": task.milestone_id,
                "milestoneTitle": (
                    milestone_title.get(task.milestone_id) if task.milestone_id else None
                ),
                "plannedStart": iso_date(task.planned_start),
                "plannedFinish": iso_date(task.planned_finish),
                "downstreamTaskIds": downstream.get(task.id, []),
                "upstreamTaskIds": upstream.get(task.id, []),
            }
            for task in bundle["tasks"]
        ],
        "relatedTickets": related_tickets,
        "ticket": {
            "id": ticket["id"],
            "title": ticket["title"],
            "description": ticket["description"],
            "source": ticket["source"],
            "affectedComponent": ticket["affected_component"],
            "reportedImpact": ticket["reported_impact"],
            "evidence": ticket["evidence"],
            "reporter": ticket["reporter"],
            "environment": ticket["environment"],
            "severityReported": ticket["severity_reported"],
            "createdAt": iso_datetime(ticket["created_at"]),
        },
    }


def _analyze_with_ai(
    context: dict, project_id: str, workspace_id: str | None, user_id: str | None = None
) -> dict:
    ai = config.ai_mode()
    provider = ai["provider"]
    project_input = {
        "projectId": project_id,
        "workspaceId": workspace_id,
        "userId": user_id,
        "workflow": "ticket_analysis",
    }

    def record(result: dict, *, success: bool = True, degraded: bool, error: str | None = None) -> None:
        plan_service.record_ai_call(
            {
                **project_input,
                "provider": result["provider"],
                "model": result["model"],
                "durationMs": result["latencyMs"],
                "success": success,
                "degraded": degraded,
                "error": error,
                "usage": result.get("usage"),
            }
        )

    if provider == "deterministic-demo":
        result = demo_analyze_ticket(context)
        validate_ticket_analysis(result["analysis"])
        record(result, degraded=False)
        return result

    provider_label = "Gemini" if provider == "gemini" else "Meta Model API"
    if provider == "gemini":
        try:
            raw = gemini_provider.analyze_ticket(context)
            analysis = validate_ticket_analysis(raw["analysis"])
            result = {
                **raw,
                "analysis": analysis.model_dump(),
                "toolCalls": [],
            }
            record(result, degraded=False)
            return result
        except Exception as exc:  # noqa: BLE001
            message = str(exc)[:500]
            if config.AI_FALLBACK_ON_ERROR:
                fallback = demo_analyze_ticket(context)
                validate_ticket_analysis(fallback["analysis"])
                degraded = {
                    **fallback,
                    "degraded": True,
                    "notice": (
                        f"{provider_label} analysis failed ({message[:220]}). MIRAIWERK used "
                        f"labelled deterministic rules; no {provider_label} output is claimed."
                    ),
                }
                record(degraded, degraded=True, error=message)
                return degraded
            plan_service.record_ai_call(
                {
                    **project_input,
                    "provider": provider,
                    "model": ai["model"],
                    "durationMs": 0,
                    "success": False,
                    "degraded": False,
                    "error": message,
                    "usage": None,
                }
            )
            raise ApiError(
                502,
                "MODEL_UNAVAILABLE",
                "The configured AI provider is unavailable. The ticket was saved but no proposal was created.",
            ) from exc

    # Meta is not available in the Python backend; fall back honestly.
    fallback = demo_analyze_ticket(context)
    validate_ticket_analysis(fallback["analysis"])
    degraded = {
        **fallback,
        "degraded": True,
        "notice": (
            "Meta Model API is not available in the Python backend. MIRAIWERK used labelled "
            "deterministic rules; no Meta output is claimed."
        ),
    }
    record(degraded, degraded=True, error="Meta provider unavailable in Python backend")
    return degraded


def _sanitize_analysis(analysis: dict, context: dict) -> dict:
    warnings: list[str] = []
    requirement_ids = {item["id"] for item in context["requirements"]}
    milestone_ids = {item["id"] for item in context["milestones"]}
    task_ids = {item["id"] for item in context["tasks"]}
    ticket_ids = {item["id"] for item in context["relatedTickets"]}

    related_records = []
    for record in analysis.get("relatedRecords", []):
        entity_type = record.get("entityType")
        entity_id = record.get("entityId")
        valid = (
            (entity_type == "requirement" and entity_id in requirement_ids)
            or (entity_type == "task" and entity_id in task_ids)
            or (entity_type == "milestone" and entity_id in milestone_ids)
            or (entity_type == "ticket" and entity_id in ticket_ids)
        )
        if not valid:
            warnings.append(
                f'Discarded a proposed {entity_type} link to unknown record "{entity_id}".'
            )
            continue
        related_records.append(record)

    evidence = []
    for item in analysis.get("evidence", []):
        if item.get("sourceType") != "project" or not item.get("sourceId"):
            evidence.append(item)
            continue
        source_id = item["sourceId"]
        if source_id in requirement_ids or source_id in milestone_ids or source_id in task_ids:
            evidence.append(item)
        else:
            warnings.append(f'Detached evidence from unknown project record "{source_id}".')
            evidence.append({**item, "sourceId": None})

    duplicate_candidates = []
    for candidate in analysis.get("duplicateCandidates", []):
        if candidate.get("ticketId") in ticket_ids:
            duplicate_candidates.append(candidate)
        else:
            warnings.append(
                f'Discarded duplicate candidate "{candidate.get("ticketId")}" outside this project.'
            )

    def sanitize_change(change: dict | None, expected_option: str) -> dict | None:
        if change is None:
            return None
        added_temp_ids: set[str] = set()
        tasks_to_add = []
        for task in change.get("tasksToAdd", []):
            temp_id = task.get("tempId")
            if not temp_id or temp_id in added_temp_ids or temp_id in task_ids:
                warnings.append(f'Discarded duplicate proposed tempId "{temp_id}".')
                continue
            added_temp_ids.add(temp_id)
            tasks_to_add.append(
                {
                    **task,
                    "requirementId": (
                        task.get("requirementId")
                        if task.get("requirementId") in requirement_ids
                        else None
                    ),
                    "milestoneId": (
                        task.get("milestoneId")
                        if task.get("milestoneId") in milestone_ids
                        else None
                    ),
                    "dependencies": [
                        dependency
                        for dependency in task.get("dependencies", [])
                        if dependency in task_ids or dependency in added_temp_ids
                    ],
                }
            )
        return {
            **change,
            "option": expected_option,
            "tasksToAdd": tasks_to_add,
            "tasksToUpdate": [
                update
                for update in change.get("tasksToUpdate", [])
                if update.get("taskId") in task_ids
            ],
            "tasksToRemove": [
                task_id for task_id in change.get("tasksToRemove", []) if task_id in task_ids
            ],
            "dependenciesToAdd": [
                dep
                for dep in change.get("dependenciesToAdd", [])
                if (dep.get("predecessorId") in task_ids or dep.get("predecessorId") in added_temp_ids)
                and (dep.get("successorId") in task_ids or dep.get("successorId") in added_temp_ids)
            ],
        }

    recommendation = analysis.get("recommendedOption")
    rationale = analysis.get("recommendationRationale", "")
    proposed = dict(analysis.get("proposedChanges") or {})
    split = sanitize_change(proposed.get("split"), "split")
    if recommendation == "split" and split is None:
        recommendation = "accept"
        rationale = (
            f"{rationale} The model did not supply a split proposal, so MIRAIWERK shows the "
            "accept scenario instead."
        )
        warnings.append(
            "Recommended split without a split change; fell back to the accept proposal."
        )

    return {
        "analysis": {
            **analysis,
            "recommendedOption": recommendation,
            "recommendationRationale": rationale,
            "relatedRecords": related_records,
            "evidence": evidence,
            "duplicateCandidates": duplicate_candidates,
            "proposedChanges": {
                "accept": sanitize_change(proposed.get("accept"), "accept"),
                "split": split,
            },
        },
        "warnings": warnings,
    }


def _empty_change(option: str) -> dict:
    return {
        "option": option,
        "tasksToAdd": [],
        "tasksToUpdate": [],
        "tasksToRemove": [],
        "dependenciesToAdd": [],
        "assumptions": [],
        "rationale": f"{OPTION_LABELS[option]} without changing the current plan.",
    }


def _change_for_option(option: str, analysis: dict) -> dict | None:
    proposed = analysis.get("proposedChanges") or {}
    if option == "accept":
        return proposed.get("accept")
    if option == "split":
        return proposed.get("split")
    if option in {"defer", "clarify", "duplicate"}:
        return _empty_change(option)
    return None


def analyze_ticket(user_id: str, ticket_id: str) -> dict:
    row = _ticket_row(ticket_id)
    if row is None:
        raise ApiError(404, "TICKET_NOT_FOUND", "Ticket not found.")
    authz.assert_project_access(user_id, row["project_id"], CONTRIBUTOR_ROLES)

    bundle = load_plan_bundle(row["project_id"])
    if bundle is None:
        raise ApiError(404, "PROJECT_NOT_FOUND", "Project not found.")

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, title, description, ticket_type, status, created_at
            FROM tickets
            WHERE project_id = %s AND id <> %s
            ORDER BY created_at DESC
            LIMIT 50
            """,
            [row["project_id"], ticket_id],
        )
        related_rows = _fetchall_dicts(cursor)

    context = _build_analysis_context(
        bundle,
        row,
        [
            {
                "id": ticket["id"],
                "title": ticket["title"],
                "description": ticket["description"],
                "ticketType": ticket["ticket_type"],
                "status": ticket["status"],
                "createdAt": iso_datetime(ticket["created_at"]),
            }
            for ticket in related_rows
        ],
    )

    with connection.cursor() as cursor:
        cursor.execute("UPDATE tickets SET status = 'analyzing' WHERE id = %s", [ticket_id])

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT workspace_id FROM projects WHERE id = %s", [row["project_id"]]
        )
        workspace_row = cursor.fetchone()
    workspace_id = workspace_row[0] if workspace_row else None

    rate_limit.enforce_ai(user_id, workspace_id, "ticket_analysis")

    try:
        result = _analyze_with_ai(context, row["project_id"], workspace_id, user_id)
    except Exception as exc:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE tickets SET status = 'analysis_failed', analyzed_at = now() WHERE id = %s",
                [ticket_id],
            )
            cursor.execute(
                """
                INSERT INTO audit_events
                  (id, project_id, actor_id, action, entity_type, entity_id, summary)
                VALUES (%s, %s, %s, 'ticket.analysis_failed', 'ticket', %s, %s)
                """,
                [
                    new_id("audit"),
                    row["project_id"],
                    user_id,
                    ticket_id,
                    str(exc),
                ],
            )
        raise

    sanitized = _sanitize_analysis(result["analysis"], context)
    policy = apply_policy(sanitized["analysis"], context)
    classification = policy["classification"]
    analysis = {**sanitized["analysis"], "classification": classification}
    warnings = sanitized["warnings"]

    graph = build_graph(bundle)
    related_task_ids = sorted(
        record["entityId"]
        for record in analysis["relatedRecords"]
        if record.get("entityType") == "task"
    )
    milestone_from_records = next(
        (
            record["entityId"]
            for record in analysis["relatedRecords"]
            if record.get("entityType") == "milestone"
        ),
        None,
    )
    milestone_from_tasks = next(
        (
            task.milestone_id
            for task in bundle["tasks"]
            if task.milestone_id and task.id in related_task_ids
        ),
        None,
    )
    target_milestone_id = milestone_from_records or milestone_from_tasks

    options = list(ALL_OPTIONS)
    if analysis["proposedChanges"].get("split"):
        options.insert(1, "split")

    scenarios = []
    for option in options:
        change = _change_for_option(option, analysis)
        if change is None:
            continue
        scenario = simulate_scenario(
            graph,
            {
                "change": change,
                "targetMilestoneId": target_milestone_id,
                "relatedTaskIds": related_task_ids,
                "ticketId": ticket_id,
            },
        )
        scenarios.append({"option": option, "scenario": scenario})

    display_summary = (
        f"{classification['summary']} ({len(warnings)} invalid model reference(s) were discarded.)"
        if warnings
        else classification["summary"]
    )

    proposal_id = new_id("dec")
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE decision_proposals SET status = 'superseded' WHERE ticket_id = %s AND status = 'pending'",
                [ticket_id],
            )
            cursor.execute(
                """
                INSERT INTO decision_proposals
                  (id, ticket_id, project_id, base_plan_version, recommendation, summary,
                   classification_json, policy_json, evidence_json, unknowns_json,
                   clarifying_questions_json, related_records_json, duplicate_candidates_json,
                   proposed_changes_json, recommendation_rationale, status, model_provider,
                   model_name, model_meta_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s, %s, %s)
                """,
                [
                    proposal_id,
                    ticket_id,
                    row["project_id"],
                    bundle["project"].current_plan_version,
                    analysis["recommendedOption"],
                    display_summary,
                    json.dumps(classification),
                    json.dumps(policy["policy"]),
                    json.dumps(analysis["evidence"]),
                    json.dumps(analysis["unknowns"]),
                    json.dumps(analysis["clarifyingQuestions"]),
                    json.dumps(analysis["relatedRecords"]),
                    json.dumps(analysis["duplicateCandidates"]),
                    json.dumps(analysis["proposedChanges"]),
                    analysis["recommendationRationale"],
                    result["provider"],
                    result["model"],
                    json.dumps(
                        {
                            "degraded": result["degraded"],
                            "latencyMs": result["latencyMs"],
                            "notice": result["notice"],
                            "toolCalls": [call["name"] for call in result.get("toolCalls", [])],
                        }
                    ),
                ],
            )
            for record in analysis["relatedRecords"]:
                cursor.execute(
                    """
                    INSERT INTO ticket_links
                      (id, ticket_id, entity_type, entity_id, relationship_type, evidence_state, rationale)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        new_id("link"),
                        ticket_id,
                        record["entityType"],
                        record["entityId"],
                        record["relationshipType"],
                        record["evidenceState"],
                        record["rationale"],
                    ],
                )
            for entry in scenarios:
                scenario = entry["scenario"]
                cursor.execute(
                    """
                    INSERT INTO scenario_runs
                      (id, proposal_id, option, label, input_hash, output_json, valid, validation_errors_json)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        new_id("scn"),
                        proposal_id,
                        entry["option"],
                        scenario["label"],
                        scenario["inputHash"],
                        json.dumps(scenario),
                        scenario["valid"],
                        json.dumps(scenario["validationErrors"]),
                    ],
                )
            cursor.execute(
                """
                UPDATE tickets
                SET status = %s, ticket_type = %s, analyzed_at = now()
                WHERE id = %s
                """,
                [
                    "needs_clarification" if analysis["recommendedOption"] == "clarify" else "analyzed",
                    classification["ticketType"],
                    ticket_id,
                ],
            )
            provider_text = (
                f"Gemini {result['model']}"
                if result["provider"] == "gemini"
                else ("Meta " + result["model"] if result["provider"] == "meta" else "deterministic rules")
            )
            cursor.execute(
                """
                INSERT INTO audit_events
                  (id, project_id, actor_id, action, entity_type, entity_id, summary)
                VALUES (%s, %s, %s, 'ticket.analyzed', 'ticket', %s, %s)
                """,
                [
                    new_id("audit"),
                    row["project_id"],
                    user_id,
                    ticket_id,
                    (
                        f"Ticket analysed with {provider_text}"
                        + (" (degraded fallback)" if result["degraded"] else "")
                        + f". Recommendation: {analysis['recommendedOption']}. Final priority: {classification['priority']}."
                    ),
                ],
            )
            cursor.execute(
                """
                INSERT INTO audit_events
                  (id, project_id, actor_id, action, entity_type, entity_id, summary)
                VALUES (%s, %s, %s, 'decision.proposed', 'decision', %s, %s)
                """,
                [
                    new_id("audit"),
                    row["project_id"],
                    user_id,
                    proposal_id,
                    f"Draft decision proposal {proposal_id} created against plan version {bundle['project'].current_plan_version}.",
                ],
            )

    notification_service.notify_decision_proposed(user_id, proposal_id)
    return get_ticket_detail(user_id, ticket_id)
