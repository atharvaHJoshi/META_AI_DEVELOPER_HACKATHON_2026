"""Project listing, plan retrieval, creation, history, bootstrap."""

from __future__ import annotations

import json

from django.db import connection, transaction

from core.common import iso_date, iso_datetime, new_id, num
from core.errors import ApiError
from platform_app import models
from ripplemap import schedule_graph, validate_graph
from services import authz
from services.org_service import (
    ensure_personal_workspace,
    list_organizations,
    list_workspaces,
)
from services.plan_service import build_project_graph_from_draft, validate_plan_draft
from services.snapshot import (
    build_graph,
    constraints_of,
    load_plan_bundle,
    persist_snapshot,
    to_milestone,
    to_requirement,
    to_task,
)
from core import config

SUMMARY_SELECT = """
  SELECT p.id, p.name, p.description, p.goal, p.start_date, p.target_date,
         p.status, p.current_plan_version, p.created_at,
         COALESCE(pm.role,
           CASE
             WHEN wm.role IN ('owner','admin') OR om.role IN ('owner','admin') THEN 'owner'
             WHEN wm.role = 'manager' OR om.role = 'manager' THEN 'pm'
             WHEN wm.role = 'member' OR om.role = 'member' THEN 'member'
             ELSE 'viewer'
           END
         ) AS role,
         (SELECT count(*)::int FROM project_members m WHERE m.project_id = p.id) AS member_count,
         (SELECT count(*)::int FROM tickets t
            WHERE t.project_id = p.id
              AND t.status IN ('new','analyzing','analyzed','needs_clarification','analysis_failed')) AS open_ticket_count,
         (SELECT count(*)::int FROM decision_proposals dp
            WHERE dp.project_id = p.id AND dp.status = 'pending') AS pending_decision_count,
         (SELECT count(*)::int FROM milestones ms WHERE ms.project_id = p.id) AS milestone_count,
         (SELECT count(*)::int FROM tasks tk WHERE tk.project_id = p.id) AS task_count,
         (SELECT json_build_object('id', ms.id, 'title', ms.title,
                                    'targetDate', ms.target_date, 'releaseGate', ms.release_gate)
            FROM milestones ms
           WHERE ms.project_id = p.id AND ms.target_date IS NOT NULL
           ORDER BY ms.target_date ASC LIMIT 1) AS next_milestone
  FROM projects p
  LEFT JOIN workspaces w ON w.id = p.workspace_id
  LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = %s
  LEFT JOIN workspace_members wm ON wm.workspace_id = p.workspace_id AND wm.user_id = %s
  LEFT JOIN organization_members om
    ON om.organization_id = COALESCE(p.organization_id, w.organization_id) AND om.user_id = %s
"""


def _fetchone_dict(cursor) -> dict | None:
    row = cursor.fetchone()
    if row is None:
        return None
    columns = [column[0] for column in cursor.description]
    return dict(zip(columns, row))


def _fetchall_dicts(cursor) -> list[dict]:
    rows = cursor.fetchall()
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


def _map_summary(row: dict) -> dict:
    next_milestone = row.get("next_milestone")
    if isinstance(next_milestone, str):
        try:
            next_milestone = json.loads(next_milestone)
        except json.JSONDecodeError:
            next_milestone = None
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "goal": row["goal"],
        "startDate": iso_date(row["start_date"]),
        "targetDate": iso_date(row["target_date"]),
        "status": row["status"],
        "currentPlanVersion": row["current_plan_version"],
        "createdAt": iso_datetime(row["created_at"]),
        "role": row["role"],
        "memberCount": row["member_count"],
        "openTicketCount": row["open_ticket_count"],
        "pendingDecisionCount": row["pending_decision_count"],
        "milestoneCount": row["milestone_count"],
        "taskCount": row["task_count"],
        "nextMilestone": next_milestone,
    }


def list_projects(user_id: str, workspace_id: str | None = None) -> list[dict]:
    with connection.cursor() as cursor:
        cursor.execute(
            SUMMARY_SELECT
            + """
     WHERE (pm.user_id = %s OR wm.user_id = %s OR om.user_id = %s)
       AND (%s::text IS NULL OR p.workspace_id = %s)
     ORDER BY p.updated_at DESC, p.created_at DESC""",
            [user_id, user_id, user_id, user_id, user_id, user_id, workspace_id, workspace_id],
        )
        rows = _fetchall_dicts(cursor)
    return [_map_summary(row) for row in rows]


def get_project_summary(user_id: str, project_id: str) -> dict:
    with connection.cursor() as cursor:
        cursor.execute(
            SUMMARY_SELECT
            + """
     WHERE p.id = %s AND (pm.user_id = %s OR wm.user_id = %s OR om.user_id = %s)""",
            [user_id, user_id, user_id, project_id, user_id, user_id, user_id],
        )
        row = _fetchone_dict(cursor)
    if row is None:
        raise ApiError(404, "PROJECT_NOT_FOUND", "Project not found.")
    return _map_summary(row)


def _resolve_workspace(user_id: str, workspace_id: str | None) -> dict:
    if workspace_id:
        authz.assert_workspace_access(
            user_id, workspace_id, ("owner", "admin", "manager", "member")
        )
        row = (
            models.Workspace.objects.filter(id=workspace_id)
            .values("id", "organization_id")
            .first()
        )
        if row is None:
            raise ApiError(404, "WORKSPACE_NOT_FOUND", "Workspace not found.")
        return {"id": row["id"], "organizationId": row["organization_id"]}

    existing = (
        models.WorkspaceMember.objects.filter(user_id=user_id)
        .order_by("created_at")
        .values("workspace_id")
        .first()
    )
    if existing:
        workspace = models.Workspace.objects.filter(id=existing["workspace_id"]).values(
            "id", "organization_id"
        ).first()
        if workspace:
            return {"id": workspace["id"], "organizationId": workspace["organization_id"]}

    user = authz.get_user_by_id(user_id)
    ensure_personal_workspace(user_id, (user or {}).get("name", "Member"))
    created = (
        models.WorkspaceMember.objects.filter(user_id=user_id)
        .order_by("created_at")
        .values("workspace_id")
        .first()
    )
    workspace = (
        models.Workspace.objects.filter(id=created["workspace_id"]).values("id", "organization_id").first()
        if created
        else None
    )
    if workspace is None:
        raise ApiError(500, "WORKSPACE_REQUIRED", "No workspace is available.")
    return {"id": workspace["id"], "organizationId": workspace["organization_id"]}


def get_project_plan(user_id: str, project_id: str) -> dict:
    authz.assert_project_access(user_id, project_id)
    bundle = load_plan_bundle(project_id)
    if bundle is None:
        raise ApiError(404, "PROJECT_NOT_FOUND", "Project not found.")

    summary = get_project_summary(user_id, project_id)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT pm.user_id, u.name, u.title, pm.role, u.avatar_color
            FROM project_members pm
            JOIN users u ON u.id = pm.user_id
            WHERE pm.project_id = %s
            ORDER BY CASE pm.role WHEN 'owner' THEN 0 WHEN 'pm' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
                     u.name
            """,
            [project_id],
        )
        member_rows = _fetchall_dicts(cursor)

    graph = build_graph(bundle)
    graph_validation = validate_graph(graph)
    schedule = schedule_graph(graph)
    validation = {
        "valid": graph_validation.valid,
        "errors": graph_validation.errors,
        "warnings": list(dict.fromkeys([*graph_validation.warnings, *schedule["warnings"]])),
        "cycle": (
            " → ".join(graph_validation.cycles[0]) if graph_validation.cycles else None
        ),
    }

    return {
        "project": summary,
        "version": bundle["project"].current_plan_version,
        "requirements": [to_requirement(requirement) for requirement in bundle["requirements"]],
        "milestones": [to_milestone(milestone) for milestone in bundle["milestones"]],
        "tasks": [to_task(task) for task in bundle["tasks"]],
        "dependencies": [
            {
                "predecessorId": dep["predecessor_id"],
                "successorId": dep["successor_id"],
                "dependencyType": dep["dependency_type"],
            }
            for dep in bundle["dependencies"]
        ],
        "members": [
            {
                "userId": row["user_id"],
                "name": row["name"],
                "title": row["title"],
                "role": row["role"],
                "avatarColor": row["avatar_color"],
            }
            for row in member_rows
        ],
        "constraints": constraints_of(bundle["project"]),
        "assumptions": bundle["assumptions"],
        "missingInformation": bundle["missingInformation"],
        "validation": validation,
    }


def create_project(
    user_id: str,
    input_data: dict,
    generation: dict | None,
    context: dict | None = None,
) -> dict:
    workspace = _resolve_workspace(user_id, (context or {}).get("workspaceId"))
    draft = input_data["draft"]
    validation = validate_plan_draft(draft)
    if not validation["valid"]:
        raise ApiError(
            422,
            "INVALID_PLAN",
            "The project plan failed dependency or schema validation.",
            validation,
        )

    project_id = new_id("prj")
    requirement_ids = {requirement["tempId"]: new_id("req") for requirement in draft["requirements"]}
    milestone_ids = {milestone["tempId"]: new_id("ms") for milestone in draft["milestones"]}
    task_ids = {task["tempId"]: new_id("task") for task in draft["tasks"]}

    # Normalise constraints: keep only well-typed keys.
    raw_constraints = input_data.get("constraints") or {}
    constraints: dict = {}
    if isinstance(raw_constraints, dict):
        for key in ("team", "technology", "nonNegotiables"):
            value = raw_constraints.get(key)
            if isinstance(value, str):
                constraints[key] = value
        if isinstance(raw_constraints.get("capacityPersonDays"), (int, float)):
            constraints["capacityPersonDays"] = raw_constraints["capacityPersonDays"]
        if isinstance(raw_constraints.get("workingDaysAvailable"), (int, float)):
            constraints["workingDaysAvailable"] = raw_constraints["workingDaysAvailable"]
        policy = raw_constraints.get("policy")
        if isinstance(policy, dict):
            out_policy = {}
            if isinstance(policy.get("criticalResponseHours"), (int, float)):
                out_policy["criticalResponseHours"] = policy["criticalResponseHours"]
            if isinstance(policy.get("highResponseDays"), (int, float)):
                out_policy["highResponseDays"] = policy["highResponseDays"]
            if isinstance(policy.get("normalResponseDays"), (int, float)):
                out_policy["normalResponseDays"] = policy["normalResponseDays"]
            if isinstance(policy.get("requireEvidenceForP0"), bool):
                out_policy["requireEvidenceForP0"] = policy["requireEvidenceForP0"]
            if isinstance(policy.get("escalationComponents"), list):
                out_policy["escalationComponents"] = [str(i) for i in policy["escalationComponents"]]
            if isinstance(policy.get("releaseFreezeDays"), (int, float)):
                out_policy["releaseFreezeDays"] = policy["releaseFreezeDays"]
            if out_policy:
                constraints["policy"] = out_policy

    scheduled = schedule_graph(build_project_graph_from_draft(draft))
    if not scheduled["valid"]:
        raise ApiError(422, "INVALID_PLAN", "The plan could not be scheduled.", scheduled["errors"])
    scheduled_by_id = {task["id"]: task for task in scheduled["tasks"]}

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO projects
                  (id, name, description, goal, start_date, target_date, status, constraints_json,
                   current_plan_version, created_by, organization_id, workspace_id)
                VALUES (%s, %s, %s, %s, %s, %s, 'active', %s, 1, %s, %s, %s)
                """,
                [
                    project_id,
                    draft["name"],
                    draft["description"],
                    draft["goal"],
                    draft["startDate"],
                    draft.get("targetDate"),
                    json.dumps(constraints),
                    user_id,
                    workspace["organizationId"],
                    workspace["id"],
                ],
            )
            cursor.execute(
                """
                INSERT INTO project_members (project_id, user_id, role)
                SELECT %s, wm.user_id,
                       CASE
                         WHEN wm.user_id = %s THEN 'owner'
                         WHEN wm.role IN ('owner','admin','manager') THEN 'pm'
                         WHEN wm.role = 'member' THEN 'member'
                         ELSE 'viewer'
                       END
                FROM workspace_members wm
                WHERE wm.workspace_id = %s
                ON CONFLICT (project_id, user_id) DO NOTHING
                """,
                [project_id, user_id, workspace["id"]],
            )
            for requirement in draft["requirements"]:
                cursor.execute(
                    """
                    INSERT INTO requirements
                      (id, project_id, title, description, acceptance_criteria, source, status)
                    VALUES (%s, %s, %s, %s, %s, %s, 'confirmed')
                    """,
                    [
                        requirement_ids[requirement["tempId"]],
                        project_id,
                        requirement["title"],
                        requirement["description"],
                        json.dumps(requirement["acceptanceCriteria"]),
                        requirement["source"],
                    ],
                )
            for position, milestone in enumerate(draft["milestones"]):
                cursor.execute(
                    """
                    INSERT INTO milestones
                      (id, project_id, title, description, target_date, release_gate, status, position)
                    VALUES (%s, %s, %s, %s, %s, %s, 'planned', %s)
                    """,
                    [
                        milestone_ids[milestone["tempId"]],
                        project_id,
                        milestone["title"],
                        milestone.get("description", ""),
                        milestone.get("targetDate"),
                        bool(milestone.get("releaseGate")),
                        position,
                    ],
                )
            for task in draft["tasks"]:
                schedule = scheduled_by_id.get(task["tempId"])
                cursor.execute(
                    """
                    INSERT INTO tasks
                      (id, project_id, requirement_id, milestone_id, title, description, status,
                       estimate_days, priority, owner_role, planned_start, planned_finish)
                    VALUES (%s, %s, %s, %s, %s, %s, 'planned', %s, %s, %s, %s, %s)
                    """,
                    [
                        task_ids[task["tempId"]],
                        project_id,
                        requirement_ids.get(task.get("requirementTempId") or ""),
                        milestone_ids.get(task.get("milestoneTempId") or ""),
                        task["title"],
                        task.get("description", ""),
                        task["estimateDays"],
                        task.get("priority", "P2"),
                        task.get("ownerRole", "Engineering"),
                        schedule.get("plannedStart") if schedule else None,
                        schedule.get("plannedFinish") if schedule else None,
                    ],
                )
            for task in draft["tasks"]:
                successor_id = task_ids[task["tempId"]]
                for dependency in task.get("dependencies", []):
                    predecessor_id = task_ids.get(dependency)
                    if not predecessor_id:
                        continue
                    cursor.execute(
                        """
                        INSERT INTO task_dependencies
                          (predecessor_task_id, successor_task_id, dependency_type)
                        VALUES (%s, %s, 'finishes_to_start')
                        ON CONFLICT DO NOTHING
                        """,
                        [predecessor_id, successor_id],
                    )

        bundle = load_plan_bundle(project_id)
        if bundle is None:
            raise ApiError(500, "PROJECT_LOAD_FAILED", "Project could not be reloaded.")
        bundle["assumptions"] = draft.get("assumptions", [])
        bundle["missingInformation"] = draft.get("missingInformation", [])
        provider = (generation or {}).get("provider") if generation else None
        persist_snapshot(
            bundle,
            1,
            id=new_id("pv"),
            parent_version_id=None,
            change_summary=(
                f"Baseline plan generated with {'Meta ' + (generation or {}).get('model', '') if provider == 'meta' else 'deterministic demo rules'}"
                + (" (degraded fallback)" if generation and generation.get("degraded") else "")
                + "."
                if generation
                else "Baseline plan approved."
            ),
            created_by=user_id,
        )
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO audit_events
                  (id, project_id, actor_id, action, entity_type, entity_id, summary)
                VALUES (%s, %s, %s, 'plan.created', 'project', %s, %s)
                """,
                [
                    new_id("audit"),
                    project_id,
                    user_id,
                    project_id,
                    f"Baseline plan version 1 created from an approved {'Meta' if provider == 'meta' else 'deterministic'} plan.",
                ],
            )

    return get_project_plan(user_id, project_id)


def list_tickets(user_id: str, project_id: str) -> list[dict]:
    authz.assert_project_access(user_id, project_id)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT t.id, t.project_id, t.title, t.ticket_type, t.status, t.severity_reported,
                   t.created_at, dp.id AS latest_decision_id, dp.status AS latest_decision_status,
                   dp.recommendation AS latest_recommendation,
                   dp.classification_json->>'priority' AS latest_priority,
                   CASE WHEN dp.id IS NULL THEN 0 ELSE jsonb_array_length(dp.unknowns_json) END AS unknown_count
            FROM tickets t
            LEFT JOIN LATERAL (
              SELECT * FROM decision_proposals
              WHERE ticket_id = t.id ORDER BY created_at DESC LIMIT 1
            ) dp ON true
            WHERE t.project_id = %s
            ORDER BY
              CASE WHEN dp.status = 'pending' THEN 0 ELSE 1 END,
              CASE t.status WHEN 'new' THEN 0 WHEN 'analysis_failed' THEN 1 ELSE 2 END,
              t.created_at DESC
            """,
            [project_id],
        )
        rows = _fetchall_dicts(cursor)
    return [
        {
            "id": row["id"],
            "projectId": row["project_id"],
            "title": row["title"],
            "ticketType": row["ticket_type"],
            "status": row["status"],
            "severityReported": row["severity_reported"],
            "createdAt": iso_datetime(row["created_at"]),
            "latestDecisionId": row["latest_decision_id"],
            "latestDecisionStatus": row["latest_decision_status"],
            "latestRecommendation": row["latest_recommendation"],
            "latestPriority": row["latest_priority"],
            "missingEvidenceCount": row["unknown_count"] or 0,
        }
        for row in rows
    ]


def get_project_history(user_id: str, project_id: str) -> dict:
    authz.assert_project_access(user_id, project_id)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT pv.id, pv.project_id, pv.version_number, pv.parent_version_id,
                   pv.change_summary, pv.created_by, pv.created_at,
                   u.name AS approved_by_name
            FROM plan_versions pv
            LEFT JOIN users u ON u.id = pv.created_by
            WHERE pv.project_id = %s
            ORDER BY pv.version_number DESC
            """,
            [project_id],
        )
        versions = _fetchall_dicts(cursor)
        cursor.execute(
            """
            SELECT da.id, da.decision_id, da.action, u.name AS actor_name, da.reason,
                   da.timestamp, dp.ticket_id, t.title AS ticket_title, dp.recommendation AS option
            FROM decision_audit da
            JOIN decision_proposals dp ON dp.id = da.decision_id
            JOIN tickets t ON t.id = dp.ticket_id
            LEFT JOIN users u ON u.id = da.actor_id
            WHERE dp.project_id = %s
            ORDER BY da.timestamp DESC
            """,
            [project_id],
        )
        decisions = _fetchall_dicts(cursor)
        cursor.execute(
            """
            SELECT ae.id, ae.action, ae.entity_type, ae.entity_id, u.name AS actor_name,
                   ae.timestamp, ae.summary
            FROM audit_events ae
            LEFT JOIN users u ON u.id = ae.actor_id
            WHERE ae.project_id = %s
            ORDER BY ae.timestamp DESC
            LIMIT 100
            """,
            [project_id],
        )
        audits = _fetchall_dicts(cursor)

    return {
        "versions": [
            {
                "id": row["id"],
                "projectId": row["project_id"],
                "versionNumber": row["version_number"],
                "parentVersionId": row.get("parent_version_id"),
                "changeSummary": row["change_summary"],
                "approvedBy": row["created_by"],
                "approvedByName": row["approved_by_name"],
                "createdAt": iso_datetime(row["created_at"]),
            }
            for row in versions
        ],
        "decisions": [
            {
                "id": row["id"],
                "decisionId": row["decision_id"],
                "action": row["action"],
                "actorName": row["actor_name"],
                "reason": row["reason"],
                "timestamp": iso_datetime(row["timestamp"]),
                "ticketId": row["ticket_id"],
                "ticketTitle": row["ticket_title"],
                "option": row["option"],
            }
            for row in decisions
        ],
        "auditEvents": [
            {
                "id": row["id"],
                "action": row["action"],
                "entityType": row["entity_type"],
                "entityId": row["entity_id"],
                "actorName": row["actor_name"],
                "timestamp": iso_datetime(row["timestamp"]),
                "summary": row["summary"],
            }
            for row in audits
        ],
    }


def get_bootstrap(user_id: str, workspace_id: str | None = None) -> dict:
    projects = list_projects(user_id, workspace_id)
    organizations = list_organizations(user_id)
    workspaces = list_workspaces(user_id)
    current_user = authz.get_user_by_id(user_id)

    with connection.cursor() as cursor:
        if workspace_id:
            cursor.execute(
                """
                SELECT u.id, u.name, u.email, u.title, u.avatar_color
                FROM workspace_members wm
                JOIN users u ON u.id = wm.user_id
                WHERE wm.workspace_id = %s
                ORDER BY u.name
                """,
                [workspace_id],
            )
        else:
            cursor.execute(
                """
                SELECT DISTINCT u.id, u.name, u.email, u.title, u.avatar_color
                FROM users u
                JOIN workspace_members wm ON wm.user_id = u.id
                JOIN workspace_members me ON me.workspace_id = wm.workspace_id AND me.user_id = %s
                ORDER BY u.name
                """,
                [user_id],
            )
        member_rows = _fetchall_dicts(cursor)

    project_ids = [project["id"] for project in projects]
    approved_count = 0
    if project_ids:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT count(*)::int AS count FROM decision_proposals
                WHERE status = 'approved' AND project_id = ANY(%s::text[])
                """,
                [project_ids],
            )
            row = cursor.fetchone()
            approved_count = row[0] if row else 0

    return {
        "users": [
            {
                "id": row["id"],
                "name": row["name"],
                "email": row["email"],
                "title": row["title"],
                "avatarColor": row["avatar_color"],
            }
            for row in member_rows
        ],
        "projects": projects,
        "currentUser": (
            {
                "id": current_user["id"],
                "name": current_user["name"],
                "email": current_user["email"],
                "title": current_user["title"],
                "avatarColor": current_user["avatar_color"],
                "avatarUrl": current_user.get("avatar_url"),
                "status": current_user.get("status") or "active",
                "isPlatformAdmin": bool(current_user.get("is_platform_admin")),
            }
            if current_user
            else None
        ),
        "organizations": organizations,
        "workspaces": workspaces,
        "activeWorkspaceId": workspace_id,
        "aiMode": config.ai_mode(),
        "ticketCounts": {
            "open": sum(project["openTicketCount"] for project in projects),
            "pendingDecisions": sum(project["pendingDecisionCount"] for project in projects),
            "approvedDecisions": approved_count,
        },
    }
