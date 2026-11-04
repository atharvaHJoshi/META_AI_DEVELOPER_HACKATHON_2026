"""Documents, meetings, forum — ported from collabService.ts."""

from __future__ import annotations

import json
from datetime import datetime

from django.db import connection, transaction

from core.common import iso_datetime, new_id
from core.errors import ApiError
from services import authz, task_service


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


def _iso_or_none(value) -> str | None:
    return iso_datetime(value)


def _assert_access(user_id: str, workspace_id: str, project_id: str | None, write: bool = False) -> None:
    if project_id:
        if write:
            authz.assert_project_access(user_id, project_id, ("owner", "pm", "member"))
        else:
            authz.assert_project_access(user_id, project_id)
    else:
        if write:
            authz.assert_workspace_access(user_id, workspace_id, ("owner", "admin", "manager", "member"))
        else:
            authz.assert_workspace_access(user_id, workspace_id)


def _document_dto(row: dict) -> dict:
    return {
        "id": row["id"],
        "workspaceId": row["workspace_id"],
        "projectId": row["project_id"],
        "title": row["title"],
        "docType": row["doc_type"],
        "content": row["content"],
        "status": row["status"],
        "createdBy": row["created_by"],
        "createdByName": row["created_by_name"],
        "updatedByName": row["updated_by_name"],
        "createdAt": _iso_or_none(row["created_at"]),
        "updatedAt": _iso_or_none(row["updated_at"]),
    }


def list_documents(user_id: str, workspace_id: str, project_id: str | None = None) -> list[dict]:
    _assert_access(user_id, workspace_id, project_id)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT d.id, d.workspace_id, d.project_id, d.title, d.doc_type, d.content, d.status,
                   d.created_by, c.name AS created_by_name, u.name AS updated_by_name,
                   d.created_at, d.updated_at
            FROM documents d
            LEFT JOIN users c ON c.id = d.created_by
            LEFT JOIN users u ON u.id = d.updated_by
            WHERE d.workspace_id = %s
              AND (%s::text IS NULL OR d.project_id = %s)
            ORDER BY d.updated_at DESC
            """,
            [workspace_id, project_id, project_id],
        )
        rows = _fetchall_dicts(cursor)
    return [_document_dto(row) for row in rows]


def create_document(user_id: str, workspace_id: str, input_data: dict) -> dict:
    project_id = input_data.get("projectId")
    _assert_access(user_id, workspace_id, project_id, write=True)
    title = (input_data.get("title") or "").strip()
    if len(title) < 2:
        raise ApiError(422, "INVALID_TITLE", "Document title is too short.")
    document_id = new_id("doc")
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO documents
                  (id, workspace_id, project_id, title, doc_type, content, created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    document_id,
                    workspace_id,
                    project_id,
                    title,
                    input_data.get("docType") or "markdown",
                    input_data.get("content") or "",
                    user_id,
                    user_id,
                ],
            )
            if project_id:
                cursor.execute(
                    """
                    INSERT INTO audit_events
                      (id, project_id, actor_id, action, entity_type, entity_id, summary)
                    VALUES (%s, %s, %s, 'document.created', 'document', %s, %s)
                    """,
                    [new_id("audit"), project_id, user_id, document_id, f"Document created: {title}"],
                )
    docs = list_documents(user_id, workspace_id, project_id)
    return next(doc for doc in docs if doc["id"] == document_id)


def _load_document(document_id: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT workspace_id, project_id FROM documents WHERE id = %s",
            [document_id],
        )
        return _fetchone_dict(cursor)


def update_document(user_id: str, document_id: str, input_data: dict) -> dict:
    existing = _load_document(document_id)
    if existing is None:
        raise ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found.")
    _assert_access(user_id, existing["workspace_id"], existing["project_id"])
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE documents SET
              title = COALESCE(%s, title),
              content = COALESCE(%s, content),
              status = COALESCE(%s, status),
              doc_type = COALESCE(%s, doc_type),
              updated_by = %s,
              updated_at = now()
            WHERE id = %s
            """,
            [
                (input_data.get("title") or "").strip() or None,
                input_data.get("content"),
                input_data.get("status"),
                input_data.get("docType"),
                user_id,
                document_id,
            ],
        )
    docs = list_documents(user_id, existing["workspace_id"], existing["project_id"])
    return next(doc for doc in docs if doc["id"] == document_id)


def delete_document(user_id: str, document_id: str) -> None:
    existing = _load_document(document_id)
    if existing is None:
        raise ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found.")
    _assert_access(user_id, existing["workspace_id"], existing["project_id"])
    role = authz.workspace_role(user_id, existing["workspace_id"])
    if role is None or role == "viewer":
        raise ApiError(403, "FORBIDDEN", "Viewers cannot delete documents.")
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM documents WHERE id = %s", [document_id])


def _parse_action_items(value) -> list[dict]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    return list(value) if isinstance(value, list) else []


def _meeting_dto(row: dict) -> dict:
    return {
        "id": row["id"],
        "workspaceId": row["workspace_id"],
        "projectId": row["project_id"],
        "title": row["title"],
        "agenda": row["agenda"],
        "notes": row["notes"],
        "scheduledAt": _iso_or_none(row["scheduled_at"]),
        "durationMinutes": row["duration_minutes"],
        "status": row["status"],
        "summary": row["summary"],
        "actionItems": _parse_action_items(row.get("action_items_json")),
        "createdByName": row["created_by_name"],
        "createdAt": _iso_or_none(row["created_at"]),
        "updatedAt": _iso_or_none(row["updated_at"]),
    }


def list_meetings(user_id: str, workspace_id: str, project_id: str | None = None) -> list[dict]:
    _assert_access(user_id, workspace_id, project_id)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT m.id, m.workspace_id, m.project_id, m.title, m.agenda, m.notes,
                   m.scheduled_at, m.duration_minutes, m.status, m.summary, m.action_items_json,
                   u.name AS created_by_name, m.created_at, m.updated_at
            FROM meetings m
            LEFT JOIN users u ON u.id = m.created_by
            WHERE m.workspace_id = %s
              AND (%s::text IS NULL OR m.project_id = %s)
            ORDER BY m.scheduled_at DESC NULLS LAST, m.created_at DESC
            """,
            [workspace_id, project_id, project_id],
        )
        rows = _fetchall_dicts(cursor)
    return [_meeting_dto(row) for row in rows]


def create_meeting(user_id: str, workspace_id: str, input_data: dict) -> dict:
    project_id = input_data.get("projectId")
    _assert_access(user_id, workspace_id, project_id, write=True)
    title = (input_data.get("title") or "").strip()
    if len(title) < 2:
        raise ApiError(422, "INVALID_TITLE", "Meeting title is too short.")
    meeting_id = new_id("mtg")
    scheduled_at = input_data.get("scheduledAt")
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO meetings
              (id, workspace_id, project_id, title, agenda, scheduled_at, duration_minutes, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            [
                meeting_id,
                workspace_id,
                project_id,
                title,
                input_data.get("agenda") or "",
                _parse_datetime(scheduled_at),
                input_data.get("durationMinutes") or 30,
                user_id,
            ],
        )
    meetings = list_meetings(user_id, workspace_id, project_id)
    return next(meeting for meeting in meetings if meeting["id"] == meeting_id)


def _parse_datetime(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    # Accept JS-ish ISO strings (…Z) and fall back to Django-style naive handling.
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed


def update_meeting(user_id: str, meeting_id: str, input_data: dict) -> dict:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT workspace_id, project_id FROM meetings WHERE id = %s", [meeting_id]
        )
        existing = _fetchone_dict(cursor)
    if existing is None:
        raise ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.")
    _assert_access(user_id, existing["workspace_id"], existing["project_id"])
    scheduled_at_provided = "scheduledAt" in input_data
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE meetings SET
              title = COALESCE(%s, title),
              agenda = COALESCE(%s, agenda),
              notes = COALESCE(%s, notes),
              scheduled_at = CASE WHEN %s THEN %s ELSE scheduled_at END,
              duration_minutes = COALESCE(%s, duration_minutes),
              status = COALESCE(%s, status),
              summary = COALESCE(%s, summary),
              action_items_json = COALESCE(%s, action_items_json),
              updated_at = now()
            WHERE id = %s
            """,
            [
                (input_data.get("title") or "").strip() or None,
                input_data.get("agenda"),
                input_data.get("notes"),
                scheduled_at_provided,
                _parse_datetime(input_data.get("scheduledAt")),
                input_data.get("durationMinutes"),
                input_data.get("status"),
                input_data.get("summary"),
                json.dumps(input_data["actionItems"]) if input_data.get("actionItems") is not None else None,
                meeting_id,
            ],
        )
    meetings = list_meetings(user_id, existing["workspace_id"], existing["project_id"])
    return next(meeting for meeting in meetings if meeting["id"] == meeting_id)


def convert_action_items_to_tasks(user_id: str, meeting_id: str, project_id: str) -> list[dict]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT workspace_id, project_id, action_items_json
            FROM meetings WHERE id = %s
            """,
            [meeting_id],
        )
        meeting = _fetchone_dict(cursor)
    if meeting is None:
        raise ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.")
    authz.assert_workspace_access(user_id, meeting["workspace_id"])
    if meeting["project_id"] and meeting["project_id"] != project_id:
        raise ApiError(422, "PROJECT_MISMATCH", "The meeting belongs to another project.")
    authz.assert_project_access(user_id, project_id, ("owner", "pm", "member"))

    items = _parse_action_items(meeting.get("action_items_json"))
    if not items:
        return []

    created = []
    updated_items = []
    for item in items:
        if item.get("taskId"):
            updated_items.append(item)
            continue
        task = task_service.create_task(
            user_id,
            project_id,
            {
                "title": str(item.get("title", ""))[:200],
                "description": (
                    "Created from meeting action item. Owner: "
                    + (item.get("owner") or "unassigned")
                    + "."
                ),
                "priority": "P2",
                "sourceTicketId": None,
                "labels": ["meeting-action"],
            },
        )
        created.append(task)
        updated_items.append({**item, "taskId": task["id"]})

    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE meetings SET action_items_json = %s, updated_at = now() WHERE id = %s",
            [json.dumps(updated_items), meeting_id],
        )
    return created


def _thread_dto(row: dict, reply_count: int | None = None, replies: list[dict] | None = None) -> dict:
    out = {
        "id": row["id"],
        "workspaceId": row["workspace_id"],
        "projectId": row["project_id"],
        "title": row["title"],
        "body": row["body"],
        "category": row["category"],
        "solved": row["solved"],
        "createdByName": row["created_by_name"],
        "replyCount": reply_count if reply_count is not None else row.get("reply_count", 0),
        "createdAt": _iso_or_none(row["created_at"]),
        "updatedAt": _iso_or_none(row["updated_at"]),
    }
    if replies is not None:
        out["replies"] = replies
    return out


def list_threads(user_id: str, workspace_id: str, project_id: str | None = None) -> list[dict]:
    _assert_access(user_id, workspace_id, project_id)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT t.id, t.workspace_id, t.project_id, t.title, t.body, t.category, t.solved,
                   u.name AS created_by_name,
                   (SELECT count(*)::int FROM forum_replies r WHERE r.thread_id = t.id) AS reply_count,
                   t.created_at, t.updated_at
            FROM forum_threads t
            LEFT JOIN users u ON u.id = t.created_by
            WHERE t.workspace_id = %s
              AND (%s::text IS NULL OR t.project_id = %s)
            ORDER BY t.solved ASC, t.updated_at DESC
            """,
            [workspace_id, project_id, project_id],
        )
        rows = _fetchall_dicts(cursor)
    return [_thread_dto(row) for row in rows]


def get_thread(user_id: str, thread_id: str) -> dict:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT t.id, t.workspace_id, t.project_id, t.title, t.body, t.category, t.solved,
                   u.name AS created_by_name, t.created_at, t.updated_at
            FROM forum_threads t
            LEFT JOIN users u ON u.id = t.created_by
            WHERE t.id = %s
            """,
            [thread_id],
        )
        thread = _fetchone_dict(cursor)
    if thread is None:
        raise ApiError(404, "THREAD_NOT_FOUND", "Discussion not found.")
    _assert_access(user_id, thread["workspace_id"], thread["project_id"])
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT r.id, r.thread_id, r.body, r.created_by, u.name AS created_by_name, r.created_at
            FROM forum_replies r
            LEFT JOIN users u ON u.id = r.created_by
            WHERE r.thread_id = %s
            ORDER BY r.created_at
            """,
            [thread_id],
        )
        replies = _fetchall_dicts(cursor)
    reply_dtos = [
        {
            "id": reply["id"],
            "threadId": reply["thread_id"],
            "body": reply["body"],
            "createdBy": reply["created_by"],
            "createdByName": reply["created_by_name"],
            "createdAt": _iso_or_none(reply["created_at"]),
        }
        for reply in replies
    ]
    return _thread_dto(thread, reply_count=len(reply_dtos), replies=reply_dtos)


def create_thread(user_id: str, workspace_id: str, input_data: dict) -> dict:
    project_id = input_data.get("projectId")
    _assert_access(user_id, workspace_id, project_id, write=True)
    thread_id = new_id("thr")
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO forum_threads (id, workspace_id, project_id, title, body, category, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            [
                thread_id,
                workspace_id,
                project_id,
                (input_data.get("title") or "").strip(),
                input_data.get("body") or "",
                input_data.get("category") or "general",
                user_id,
            ],
        )
    return get_thread(user_id, thread_id)


def reply_to_thread(user_id: str, thread_id: str, body: str) -> dict:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT workspace_id, project_id FROM forum_threads WHERE id = %s", [thread_id]
        )
        thread = _fetchone_dict(cursor)
    if thread is None:
        raise ApiError(404, "THREAD_NOT_FOUND", "Discussion not found.")
    _assert_access(user_id, thread["workspace_id"], thread["project_id"], write=True)
    with connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO forum_replies (id, thread_id, body, created_by) VALUES (%s, %s, %s, %s)",
            [new_id("rep"), thread_id, body, user_id],
        )
        cursor.execute(
            "UPDATE forum_threads SET updated_at = now() WHERE id = %s", [thread_id]
        )
    return get_thread(user_id, thread_id)


def set_thread_solved(user_id: str, thread_id: str, solved: bool) -> dict:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT workspace_id, project_id FROM forum_threads WHERE id = %s", [thread_id]
        )
        thread = _fetchone_dict(cursor)
    if thread is None:
        raise ApiError(404, "THREAD_NOT_FOUND", "Discussion not found.")
    _assert_access(user_id, thread["workspace_id"], thread["project_id"], write=True)
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE forum_threads SET solved = %s, updated_at = now() WHERE id = %s",
            [solved, thread_id],
        )
    return get_thread(user_id, thread_id)
