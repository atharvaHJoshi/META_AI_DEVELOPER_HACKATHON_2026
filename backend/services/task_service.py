"""Tasks, dependencies, milestones — ported from taskService.ts."""

from __future__ import annotations

import json

from django.db import connection, transaction

from core.common import iso_date, new_id, num
from core.errors import ApiError
from ripplemap import schedule_graph, validate_graph
from services import authz
from services.snapshot import build_graph, load_plan_bundle

CONTRIBUTORS = ("owner", "pm", "member")
MANAGERS = ("owner", "pm")

TASK_SELECT = """
  SELECT t.id, t.project_id, t.requirement_id, t.milestone_id, ms.title AS milestone_title,
         t.title, t.description, t.status, t.estimate_days, t.priority, t.owner_role,
         t.assignee_id, u.name AS assignee_name, u.avatar_color AS assignee_color,
         t.labels_json, t.planned_start, t.planned_finish, t.source_ticket_id,
         ARRAY(
           SELECT d.predecessor_task_id FROM task_dependencies d
           WHERE d.successor_task_id = t.id
         ) AS dependency_ids
  FROM tasks t
  LEFT JOIN milestones ms ON ms.id = t.milestone_id
  LEFT JOIN users u ON u.id = t.assignee_id
"""


def _fetchall_dicts(cursor) -> list[dict]:
    rows = cursor.fetchall()
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


def _fetchone_dict(cursor) -> dict | None:
    row = cursor.fetchone()
    if row is None:
        return None
    columns = [column[0] for column in cursor.description]
    return dict(zip(columns, row))


def _map_task(row: dict) -> dict:
    labels = row.get("labels_json")
    dependency_ids = row.get("dependency_ids")
    if isinstance(labels, str):
        try:
            labels = json.loads(labels)
        except json.JSONDecodeError:
            labels = []
    if not isinstance(labels, list):
        labels = []
    if not isinstance(dependency_ids, list):
        dependency_ids = list(dependency_ids) if dependency_ids else []
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "title": row["title"],
        "description": row["description"],
        "status": row["status"],
        "priority": row["priority"],
        "estimateDays": num(row["estimate_days"]),
        "ownerRole": row["owner_role"],
        "requirementId": row["requirement_id"],
        "milestoneId": row["milestone_id"],
        "milestoneTitle": row["milestone_title"],
        "assigneeId": row["assignee_id"],
        "assigneeName": row["assignee_name"],
        "assigneeColor": row["assignee_color"],
        "labels": labels,
        "plannedStart": iso_date(row["planned_start"]),
        "plannedFinish": iso_date(row["planned_finish"]),
        "sourceTicketId": row["source_ticket_id"],
        "dependencyIds": dependency_ids,
    }


def list_project_tasks(user_id: str, project_id: str) -> list[dict]:
    authz.assert_project_access(user_id, project_id)
    with connection.cursor() as cursor:
        cursor.execute(
            TASK_SELECT
            + " WHERE t.project_id = %s\nORDER BY t.planned_start NULLS LAST, t.title",
            [project_id],
        )
        rows = _fetchall_dicts(cursor)
    return [_map_task(row) for row in rows]


def get_task(user_id: str, task_id: str) -> dict:
    with connection.cursor() as cursor:
        cursor.execute(TASK_SELECT + " WHERE t.id = %s", [task_id])
        row = _fetchone_dict(cursor)
    if row is None:
        raise ApiError(404, "TASK_NOT_FOUND", "Task not found.")
    authz.assert_project_access(user_id, row["project_id"])
    return _map_task(row)


def _assert_workspace_member(project_id: str, assignee_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1 FROM projects p
            JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
            WHERE p.id = %s AND wm.user_id = %s
            """,
            [project_id, assignee_id],
        )
        if cursor.fetchone() is None:
            raise ApiError(422, "INVALID_ASSIGNEE", "The assignee is not a member of this workspace.")


def _assert_milestone_in_project(project_id: str, milestone_id: str | None) -> None:
    if not milestone_id:
        return
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT 1 FROM milestones WHERE id = %s AND project_id = %s",
            [milestone_id, project_id],
        )
        if cursor.fetchone() is None:
            raise ApiError(422, "INVALID_MILESTONE", "Milestone does not belong to this project.")


def _assert_requirement_in_project(project_id: str, requirement_id: str | None) -> None:
    if not requirement_id:
        return
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT 1 FROM requirements WHERE id = %s AND project_id = %s",
            [requirement_id, project_id],
        )
        if cursor.fetchone() is None:
            raise ApiError(422, "INVALID_REQUIREMENT", "Requirement does not belong to this project.")


def _validate_estimate(estimate: float) -> None:
    import math

    if estimate is None or math.isnan(estimate) or estimate <= 0 or estimate > 60:
        raise ApiError(422, "INVALID_ESTIMATE", "Estimate must be between 0.5 and 60 working days.")


def _validate_title(title: str) -> str:
    title = (title or "").strip()
    if len(title) < 3:
        raise ApiError(422, "INVALID_TITLE", "Task title is too short.")
    return title


def create_task(user_id: str, project_id: str, input_data: dict) -> dict:
    authz.assert_project_access(user_id, project_id, CONTRIBUTORS)
    title = _validate_title(input_data.get("title", ""))
    estimate = input_data.get("estimateDays", 1)
    try:
        estimate = float(estimate)
    except (TypeError, ValueError):
        raise ApiError(422, "INVALID_ESTIMATE", "Estimate must be a number of working days.") from None
    _validate_estimate(estimate)

    task_id = new_id("task")
    with transaction.atomic():
        _assert_milestone_in_project(project_id, input_data.get("milestoneId"))
        _assert_requirement_in_project(project_id, input_data.get("requirementId"))
        if input_data.get("assigneeId"):
            _assert_workspace_member(project_id, input_data["assigneeId"])

        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO tasks
                  (id, project_id, requirement_id, milestone_id, title, description, status,
                   estimate_days, priority, owner_role, assignee_id, labels_json,
                   planned_start, planned_finish, source_ticket_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    task_id,
                    project_id,
                    input_data.get("requirementId"),
                    input_data.get("milestoneId"),
                    title,
                    input_data.get("description") or "",
                    input_data.get("status") or "planned",
                    estimate,
                    input_data.get("priority") or "P2",
                    (input_data.get("ownerRole") or "Engineering")[:80],
                    input_data.get("assigneeId"),
                    json.dumps(list(input_data.get("labels") or [])[:20]),
                    input_data.get("plannedStart"),
                    input_data.get("plannedFinish"),
                    input_data.get("sourceTicketId"),
                ],
            )
            for dependency_id in input_data.get("dependencyIds") or []:
                cursor.execute(
                    "SELECT 1 FROM tasks WHERE id = %s AND project_id = %s",
                    [dependency_id, project_id],
                )
                if cursor.fetchone() is None:
                    raise ApiError(
                        422, "INVALID_DEPENDENCY",
                        "A dependency task does not belong to this project.",
                    )
                cursor.execute(
                    """
                    INSERT INTO task_dependencies (predecessor_task_id, successor_task_id)
                    VALUES (%s, %s) ON CONFLICT DO NOTHING
                    """,
                    [dependency_id, task_id],
                )
            cursor.execute(
                """
                INSERT INTO audit_events
                  (id, project_id, actor_id, action, entity_type, entity_id, summary)
                VALUES (%s, %s, %s, 'task.created', 'task', %s, %s)
                """,
                [new_id("audit"), project_id, user_id, task_id, f"Task created: {title}"],
            )

    return get_task(user_id, task_id)


def update_task(user_id: str, task_id: str, input_data: dict) -> dict:
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM tasks WHERE id = %s", [task_id])
        current = _fetchone_dict(cursor)
    if current is None:
        raise ApiError(404, "TASK_NOT_FOUND", "Task not found.")
    authz.assert_project_access(user_id, current["project_id"], CONTRIBUTORS)

    title = (input_data.get("title") or current["title"]).strip()
    description = input_data.get("description", current["description"])
    status = input_data.get("status", current["status"])
    priority = input_data.get("priority", current["priority"])
    estimate = input_data.get("estimateDays", num(current["estimate_days"]))
    try:
        estimate = float(estimate)
    except (TypeError, ValueError):
        raise ApiError(422, "INVALID_ESTIMATE", "Estimate must be a number of working days.") from None
    owner_role = input_data.get("ownerRole", current["owner_role"])

    def pick(field, default):
        return input_data[field] if field in input_data else default

    requirement_id = pick("requirementId", current["requirement_id"])
    milestone_id = pick("milestoneId", current["milestone_id"])
    assignee_id = pick("assigneeId", current["assignee_id"])
    labels = input_data.get("labels")
    if labels is None:
        labels_raw = current.get("labels_json")
        if isinstance(labels_raw, str):
            try:
                labels = json.loads(labels_raw)
            except json.JSONDecodeError:
                labels = []
        else:
            labels = list(labels_raw or [])
    planned_start = pick("plannedStart", iso_date(current["planned_start"]))
    planned_finish = pick("plannedFinish", iso_date(current["planned_finish"]))

    title = _validate_title(title)
    _validate_estimate(estimate)

    with transaction.atomic():
        _assert_milestone_in_project(current["project_id"], milestone_id)
        _assert_requirement_in_project(current["project_id"], requirement_id)
        if assignee_id:
            _assert_workspace_member(current["project_id"], assignee_id)

        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE tasks SET
                  title = %s, description = %s, status = %s, priority = %s, estimate_days = %s,
                  owner_role = %s, requirement_id = %s, milestone_id = %s, assignee_id = %s,
                  labels_json = %s, planned_start = %s, planned_finish = %s, updated_at = now()
                WHERE id = %s
                """,
                [
                    title,
                    description,
                    status,
                    priority,
                    estimate,
                    owner_role,
                    requirement_id,
                    milestone_id,
                    assignee_id,
                    json.dumps(list(labels or [])[:20]),
                    planned_start,
                    planned_finish,
                    task_id,
                ],
            )
            cursor.execute(
                """
                INSERT INTO audit_events
                  (id, project_id, actor_id, action, entity_type, entity_id, before_json, after_json, summary)
                VALUES (%s, %s, %s, 'task.updated', 'task', %s, %s, %s, %s)
                """,
                [
                    new_id("audit"),
                    current["project_id"],
                    user_id,
                    task_id,
                    json.dumps({key: (str(value) if value is not None else None) for key, value in current.items()}),
                    json.dumps(
                        {
                            "title": title,
                            "status": status,
                            "priority": priority,
                            "estimateDays": estimate,
                            "ownerRole": owner_role,
                            "requirementId": requirement_id,
                            "milestoneId": milestone_id,
                            "assigneeId": assignee_id,
                            "plannedStart": planned_start,
                            "plannedFinish": planned_finish,
                        }
                    ),
                    f"Task updated: {title}",
                ],
            )

    return get_task(user_id, task_id)


def add_task_dependency(user_id: str, project_id: str, predecessor_id: str, successor_id: str) -> None:
    authz.assert_project_access(user_id, project_id, CONTRIBUTORS)
    if predecessor_id == successor_id:
        raise ApiError(422, "INVALID_DEPENDENCY", "A task cannot depend on itself.")

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT count(DISTINCT id) FROM tasks
                WHERE project_id = %s AND id = ANY(%s::text[])
                """,
                [project_id, [predecessor_id, successor_id]],
            )
            row = cursor.fetchone()
            if not row or row[0] != 2:
                raise ApiError(422, "INVALID_DEPENDENCY", "Both tasks must belong to this project.")
            cursor.execute(
                """
                INSERT INTO task_dependencies (predecessor_task_id, successor_task_id)
                VALUES (%s, %s) ON CONFLICT DO NOTHING
                """,
                [predecessor_id, successor_id],
            )

        bundle = load_plan_bundle(project_id)
        if bundle is None:
            raise ApiError(404, "PROJECT_NOT_FOUND", "Project not found.")
        validation = validate_graph(build_graph(bundle))
        if not validation.valid:
            raise ApiError(
                422,
                "DEPENDENCY_CYCLE",
                "This dependency would create a cycle.",
                {"errors": validation.errors, "cycles": validation.cycles},
            )
        schedule = schedule_graph(build_graph(bundle))
        if schedule["valid"]:
            with connection.cursor() as cursor:
                for task in schedule["tasks"]:
                    cursor.execute(
                        """
                        UPDATE tasks SET planned_start = %s, planned_finish = %s
                        WHERE id = %s
                        """,
                        [task["plannedStart"], task["plannedFinish"], task["id"]],
                    )
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO audit_events
                  (id, project_id, actor_id, action, entity_type, entity_id, summary)
                VALUES (%s, %s, %s, 'dependency.added', 'task', %s, %s)
                """,
                [
                    new_id("audit"),
                    project_id,
                    user_id,
                    successor_id,
                    f"Dependency added: {predecessor_id} → {successor_id}",
                ],
            )


def remove_task_dependency(user_id: str, project_id: str, predecessor_id: str, successor_id: str) -> None:
    authz.assert_project_access(user_id, project_id, CONTRIBUTORS)
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                DELETE FROM task_dependencies d
                USING tasks t
                WHERE t.id = d.successor_task_id AND t.project_id = %s
                  AND d.predecessor_task_id = %s AND d.successor_task_id = %s
                """,
                [project_id, predecessor_id, successor_id],
            )
            if cursor.rowcount == 0:
                raise ApiError(404, "DEPENDENCY_NOT_FOUND", "Dependency not found.")
            cursor.execute(
                """
                INSERT INTO audit_events
                  (id, project_id, actor_id, action, entity_type, entity_id, summary)
                VALUES (%s, %s, %s, 'dependency.removed', 'task', %s, %s)
                """,
                [
                    new_id("audit"),
                    project_id,
                    user_id,
                    successor_id,
                    f"Dependency removed: {predecessor_id} → {successor_id}",
                ],
            )


def list_milestones(user_id: str, project_id: str) -> list[dict]:
    authz.assert_project_access(user_id, project_id)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, title, description, target_date, release_gate, status, position
            FROM milestones
            WHERE project_id = %s
            ORDER BY position, target_date NULLS LAST
            """,
            [project_id],
        )
        rows = _fetchall_dicts(cursor)
    return [
        {
            "id": row["id"],
            "projectId": project_id,
            "title": row["title"],
            "description": row["description"],
            "targetDate": iso_date(row["target_date"]),
            "releaseGate": row["release_gate"],
            "status": row["status"],
            "position": row["position"],
        }
        for row in rows
    ]


def create_milestone(
    user_id: str,
    project_id: str,
    input_data: dict,
) -> dict:
    authz.assert_project_access(user_id, project_id, MANAGERS)
    title = (input_data.get("title") or "").strip()
    if len(title) < 2:
        raise ApiError(422, "INVALID_TITLE", "Milestone title is too short.")

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT COALESCE(max(position), -1) + 1 AS next FROM milestones WHERE project_id = %s",
            [project_id],
        )
        position_row = cursor.fetchone()
    position = (position_row[0] if position_row else 0) or 0
    milestone_id = new_id("ms")

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO milestones
                  (id, project_id, title, description, target_date, release_gate, status, position)
                VALUES (%s, %s, %s, %s, %s, %s, 'planned', %s)
                """,
                [
                    milestone_id,
                    project_id,
                    title,
                    input_data.get("description") or "",
                    input_data.get("targetDate"),
                    bool(input_data.get("releaseGate", False)),
                    position,
                ],
            )
            cursor.execute(
                """
                INSERT INTO audit_events
                  (id, project_id, actor_id, action, entity_type, entity_id, summary)
                VALUES (%s, %s, %s, 'milestone.created', 'milestone', %s, %s)
                """,
                [new_id("audit"), project_id, user_id, milestone_id, f"Milestone created: {title}"],
            )

    milestones = list_milestones(user_id, project_id)
    return next(m for m in milestones if m["id"] == milestone_id)


def update_milestone(user_id: str, milestone_id: str, input_data: dict) -> dict:
    with connection.cursor() as cursor:
        cursor.execute("SELECT project_id FROM milestones WHERE id = %s", [milestone_id])
        current = _fetchone_dict(cursor)
    if current is None:
        raise ApiError(404, "MILESTONE_NOT_FOUND", "Milestone not found.")
    authz.assert_project_access(user_id, current["project_id"], MANAGERS)

    title = input_data.get("title")
    if title is not None:
        title = title.strip() or None

    target_date_provided = "targetDate" in input_data
    target_date = input_data.get("targetDate")

    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE milestones SET
              title = COALESCE(%s, title),
              description = COALESCE(%s, description),
              target_date = CASE WHEN %s THEN %s::date ELSE target_date END,
              release_gate = COALESCE(%s, release_gate),
              status = COALESCE(%s, status)
            WHERE id = %s
            """,
            [
                title,
                input_data.get("description"),
                target_date_provided,
                target_date,
                input_data.get("releaseGate"),
                input_data.get("status"),
                milestone_id,
            ],
        )

    milestones = list_milestones(user_id, current["project_id"])
    return next(m for m in milestones if m["id"] == milestone_id)


def project_roadmap(user_id: str, project_id: str) -> dict:
    tasks = list_project_tasks(user_id, project_id)
    milestones = list_milestones(user_id, project_id)
    return {
        "milestones": milestones,
        "tasks": [
            {
                "id": task["id"],
                "title": task["title"],
                "status": task["status"],
                "milestoneId": task["milestoneId"],
                "plannedStart": task["plannedStart"],
                "plannedFinish": task["plannedFinish"],
                "estimateDays": task["estimateDays"],
                "priority": task["priority"],
                "assigneeName": task["assigneeName"],
                "dependencyIds": task["dependencyIds"],
            }
            for task in tasks
        ],
    }
