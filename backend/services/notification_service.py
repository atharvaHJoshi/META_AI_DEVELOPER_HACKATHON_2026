"""In-app notifications and event-driven email alerts.

Notifications are created by backend events — never by the frontend. They are
tenant-scoped, deduplicated where an event can be observed more than once, and
respect per-user notification preferences. Security-relevant notices bypass
project notification preferences and must never be silently disabled.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Iterable

from django.db import connection, transaction

from core.common import iso_datetime, new_id
from core.errors import ApiError
from platform_app import models
from services import authz, email_service

logger = logging.getLogger("miraiwerk.notifications")

CATEGORIES = (
    "tasks",
    "tickets",
    "decisions",
    "meetings",
    "discussions",
    "milestones",
    "digests",
    "security",
)
NON_DISABLEABLE = {"security"}
_MENTION_RE = re.compile(r"@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})")


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


def _preference_enabled(user_id: str, category: str | None, channel: str) -> bool:
    if not category:
        return False
    if category in NON_DISABLEABLE:
        return True
    preference = models.NotificationPreference.objects.filter(
        user_id=user_id, category=category
    ).first()
    if preference is None:
        return True
    return bool(getattr(preference, channel))


def create_notification(
    *,
    recipient_id: str,
    workspace_id: str | None,
    notification_type: str,
    title: str,
    message: str = "",
    category: str | None = None,
    project_id: str | None = None,
    entity_type: str = "",
    entity_id: str = "",
    link: str = "",
    email: bool = False,
    dedupe_key: str | None = None,
) -> str | None:
    """Create one notification if the recipient's preferences allow it.

    Returns the notification id when a row was created, or ``None`` when the
    event was suppressed or deduplicated.
    """
    if not _preference_enabled(recipient_id, category, "in_app"):
        return None

    notification_id = new_id("ntf")
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO notifications
              (id, recipient_id, workspace_id, project_id, notification_type, title, message,
               entity_type, entity_id, link, is_read, dedupe_key, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false, %s, now())
            ON CONFLICT (recipient_id, dedupe_key) DO NOTHING
            RETURNING id
            """,
            [
                notification_id,
                recipient_id,
                workspace_id,
                project_id,
                notification_type[:60],
                title[:255],
                message[:4000],
                entity_type[:50],
                entity_id[:64],
                link[:300],
                dedupe_key,
            ],
        )
        inserted = cursor.fetchone()

    if inserted is None:
        return None

    if email and _preference_enabled(recipient_id, category, "email"):
        def _deliver() -> None:
            try:
                recipient = models.User.objects.filter(id=recipient_id).only("email", "name").first()
                if recipient is None:
                    return
                email_service.send_notification_email(
                    email=recipient.email,
                    name=recipient.name,
                    title=title,
                    message=message,
                    link=link,
                )
            except Exception:  # noqa: BLE001 - email must never break the notification
                logger.exception("Notification email failed")

        transaction.on_commit(_deliver)

    return inserted[0]


def _recipient_users(user_ids: Iterable[str]) -> list[dict]:
    ids = [user_id for user_id in dict.fromkeys(user_ids) if user_id]
    if not ids:
        return []
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, name, email, status FROM users WHERE id = ANY(%s::text[]) AND status = 'active'",
            [ids],
        )
        return _fetchall_dicts(cursor)


def _project_context(project_id: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT p.id, p.name, p.workspace_id, w.name AS workspace_name
            FROM projects p
            LEFT JOIN workspaces w ON w.id = p.workspace_id
            WHERE p.id = %s
            """,
            [project_id],
        )
        return _fetchone_dict(cursor)


def _project_managers(project_id: str) -> list[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT user_id FROM project_members WHERE project_id = %s AND role IN ('owner', 'pm')",
            [project_id],
        )
        return [row[0] for row in cursor.fetchall()]


def _workspace_members(workspace_id: str) -> list[str]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT user_id FROM workspace_members WHERE workspace_id = %s",
            [workspace_id],
        )
        return [row[0] for row in cursor.fetchall()]


def notify_task_assigned(actor_id: str, task_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT t.id, t.title, t.project_id, t.assignee_id, p.workspace_id, p.name AS project_name
            FROM tasks t JOIN projects p ON p.id = t.project_id
            WHERE t.id = %s
            """,
            [task_id],
        )
        task = _fetchone_dict(cursor)
    if not task or not task["assignee_id"] or task["assignee_id"] == actor_id:
        return
    actor = models.User.objects.filter(id=actor_id).only("name").first()
    actor_name = actor.name if actor else "A teammate"
    create_notification(
        recipient_id=task["assignee_id"],
        workspace_id=task["workspace_id"],
        project_id=task["project_id"],
        notification_type="task_assigned",
        category="tasks",
        title=f"Task assigned: {task['title']}",
        message=f"{actor_name} assigned you this task in {task['project_name']}.",
        entity_type="task",
        entity_id=task_id,
        link=f"/tasks?project={task['project_id']}",
        email=True,
    )


def notify_ticket_created(actor_id: str, ticket_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT t.id, t.title, t.project_id, p.workspace_id, p.name AS project_name
            FROM tickets t JOIN projects p ON p.id = t.project_id
            WHERE t.id = %s
            """,
            [ticket_id],
        )
        ticket = _fetchone_dict(cursor)
    if not ticket:
        return
    recipients = [user_id for user_id in _project_managers(ticket["project_id"]) if user_id != actor_id]
    for user in _recipient_users(recipients):
        create_notification(
            recipient_id=user["id"],
            workspace_id=ticket["workspace_id"],
            project_id=ticket["project_id"],
            notification_type="ticket_created",
            category="tickets",
            title=f"New ticket: {ticket['title']}",
            message=f"A new ticket was submitted in {ticket['project_name']} and needs triage.",
            entity_type="ticket",
            entity_id=ticket_id,
            link=f"/tickets/{ticket_id}",
            email=True,
        )


def notify_decision_proposed(actor_id: str, proposal_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT dp.id, dp.project_id, dp.ticket_id, t.title AS ticket_title,
                   p.workspace_id, p.name AS project_name
            FROM decision_proposals dp
            JOIN tickets t ON t.id = dp.ticket_id
            JOIN projects p ON p.id = dp.project_id
            WHERE dp.id = %s
            """,
            [proposal_id],
        )
        proposal = _fetchone_dict(cursor)
    if not proposal:
        return
    recipients = [user_id for user_id in _project_managers(proposal["project_id"]) if user_id != actor_id]
    for user in _recipient_users(recipients):
        create_notification(
            recipient_id=user["id"],
            workspace_id=proposal["workspace_id"],
            project_id=proposal["project_id"],
            notification_type="decision_proposed",
            category="decisions",
            title=f"Decision ready: {proposal['ticket_title']}",
            message="An AI proposal and RippleMap impact are ready for human review.",
            entity_type="decision",
            entity_id=proposal_id,
            link=f"/ripplemap/{proposal_id}",
            email=True,
        )


def notify_decision_outcome(actor_id: str, proposal_id: str, outcome: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT dp.id, dp.project_id, dp.ticket_id, t.title AS ticket_title, t.created_by,
                   p.workspace_id, p.name AS project_name
            FROM decision_proposals dp
            JOIN tickets t ON t.id = dp.ticket_id
            JOIN projects p ON p.id = dp.project_id
            WHERE dp.id = %s
            """,
            [proposal_id],
        )
        proposal = _fetchone_dict(cursor)
    if not proposal:
        return
    recipients = [proposal["created_by"], *_project_managers(proposal["project_id"])]
    for user in _recipient_users(recipient for recipient in recipients if recipient != actor_id):
        create_notification(
            recipient_id=user["id"],
            workspace_id=proposal["workspace_id"],
            project_id=proposal["project_id"],
            notification_type=f"decision_{outcome}",
            category="decisions",
            title=f"Decision {outcome}: {proposal['ticket_title']}",
            message=f"The decision for this ticket was {outcome} in {proposal['project_name']}.",
            entity_type="decision",
            entity_id=proposal_id,
            link=f"/tickets/{proposal['ticket_id']}",
            email=True,
        )


def notify_meeting_scheduled(actor_id: str, meeting_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT m.id, m.title, m.project_id, m.scheduled_at, m.workspace_id,
                   w.name AS workspace_name
            FROM meetings m JOIN workspaces w ON w.id = m.workspace_id
            WHERE m.id = %s
            """,
            [meeting_id],
        )
        meeting = _fetchone_dict(cursor)
    if not meeting:
        return
    recipients = (
        _project_managers(meeting["project_id"])
        if meeting["project_id"]
        else _workspace_members(meeting["workspace_id"])
    )
    scheduled = iso_datetime(meeting["scheduled_at"]) if meeting["scheduled_at"] else "not yet scheduled"
    for user in _recipient_users(recipient for recipient in recipients if recipient != actor_id):
        create_notification(
            recipient_id=user["id"],
            workspace_id=meeting["workspace_id"],
            project_id=meeting["project_id"],
            notification_type="meeting_scheduled",
            category="meetings",
            title=f"Meeting scheduled: {meeting['title']}",
            message=f"{scheduled} in {meeting['workspace_name']}.",
            entity_type="meeting",
            entity_id=meeting_id,
            link="/meetings",
            email=True,
        )


def notify_mentions(
    *, actor_id: str, workspace_id: str, project_id: str | None, thread_id: str, body: str
) -> None:
    mentioned = {match.lower() for match in _MENTION_RE.findall(body or "")}
    if not mentioned:
        return
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT u.id, u.name, u.email
            FROM users u
            JOIN workspace_members wm ON wm.user_id = u.id
            WHERE wm.workspace_id = %s AND lower(u.email) = ANY(%s::text[]) AND u.status = 'active'
            """,
            [workspace_id, list(mentioned)],
        )
        users = _fetchall_dicts(cursor)
    for user in users:
        if user["id"] == actor_id:
            continue
        create_notification(
            recipient_id=user["id"],
            workspace_id=workspace_id,
            project_id=project_id,
            notification_type="discussion_mention",
            category="discussions",
            title="You were mentioned in a discussion",
            message=f"You were mentioned in a discussion reply. Open Discussions to respond.",
            entity_type="thread",
            entity_id=thread_id,
            link="/discussions",
            email=True,
        )


def notify_milestone_approaching(recipient_id: str, milestone_id: str) -> None:
    """Used by the reminder command; kept separate for testability."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT m.id, m.title, m.target_date, m.project_id, p.workspace_id, p.name AS project_name
            FROM milestones m JOIN projects p ON p.id = m.project_id
            WHERE m.id = %s
            """,
            [milestone_id],
        )
        milestone = _fetchone_dict(cursor)
    if not milestone:
        return
    target = iso_datetime(milestone["target_date"]) if milestone["target_date"] else "unknown"
    create_notification(
        recipient_id=recipient_id,
        workspace_id=milestone["workspace_id"],
        project_id=milestone["project_id"],
        notification_type="milestone_approaching",
        category="milestones",
        title=f"Milestone approaching: {milestone['title']}",
        message=f"{milestone['project_name']} targets this milestone on {target[:10]}.",
        entity_type="milestone",
        entity_id=milestone_id,
        link=f"/roadmap?project={milestone['project_id']}",
        dedupe_key=f"milestone_approaching:{milestone_id}:{target[:10]}:{recipient_id}",
    )


# --------------------------------------------------------------------------
# Read surface
# --------------------------------------------------------------------------


def _notification_dto(row: dict) -> dict:
    return {
        "id": row["id"],
        "workspaceId": row["workspace_id"],
        "projectId": row["project_id"],
        "type": row["notification_type"],
        "title": row["title"],
        "message": row["message"],
        "entityType": row["entity_type"],
        "entityId": row["entity_id"],
        "link": row["link"],
        "isRead": row["is_read"],
        "createdAt": iso_datetime(row["created_at"]),
    }


def list_notifications(
    user_id: str,
    workspace_id: str,
    *,
    status: str = "all",
    limit: int = 20,
    offset: int = 0,
) -> dict:
    authz.assert_workspace_access(user_id, workspace_id)
    limit = max(1, min(int(limit or 20), 50))
    offset = max(0, int(offset or 0))
    unread_only = status == "unread"

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, workspace_id, project_id, notification_type, title, message,
                   entity_type, entity_id, link, is_read, created_at
            FROM notifications
            WHERE recipient_id = %s
              AND (workspace_id = %s OR workspace_id IS NULL)
              AND (%s = false OR is_read = false)
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s
            """,
            [user_id, workspace_id, unread_only, limit + 1, offset],
        )
        rows = _fetchall_dicts(cursor)
        cursor.execute(
            """
            SELECT count(*) FROM notifications
            WHERE recipient_id = %s
              AND (workspace_id = %s OR workspace_id IS NULL)
              AND is_read = false
            """,
            [user_id, workspace_id],
        )
        unread = int(cursor.fetchone()[0])

    has_more = len(rows) > limit
    return {
        "notifications": [_notification_dto(row) for row in rows[:limit]],
        "unreadCount": unread,
        "hasMore": has_more,
    }


def mark_read(user_id: str, notification_id: str) -> dict:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE notifications
            SET is_read = true, read_at = now()
            WHERE id = %s AND recipient_id = %s
            RETURNING id
            """,
            [notification_id, user_id],
        )
        row = cursor.fetchone()
    if row is None:
        raise ApiError(404, "NOTIFICATION_NOT_FOUND", "Notification not found.")
    return {"ok": True}


def mark_all_read(user_id: str, workspace_id: str) -> dict:
    authz.assert_workspace_access(user_id, workspace_id)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE notifications
            SET is_read = true, read_at = now()
            WHERE recipient_id = %s
              AND (workspace_id = %s OR workspace_id IS NULL)
              AND is_read = false
            """,
            [user_id, workspace_id],
        )
        updated = cursor.rowcount
    return {"ok": True, "updated": updated}


def list_preferences(user_id: str) -> dict:
    stored = {
        preference.category: preference
        for preference in models.NotificationPreference.objects.filter(user_id=user_id)
    }
    return {
        "preferences": [
            {
                "category": category,
                "inApp": True
                if category in NON_DISABLEABLE
                else bool(stored[category].in_app)
                if category in stored
                else True,
                "email": True
                if category in NON_DISABLEABLE
                else bool(stored[category].email)
                if category in stored
                else True,
                "locked": category in NON_DISABLEABLE,
            }
            for category in CATEGORIES
        ]
    }


def update_preferences(user_id: str, preferences: list[dict]) -> dict:
    allowed = set(CATEGORIES) - NON_DISABLEABLE
    for item in preferences:
        category = str(item.get("category") or "").strip()
        if category not in allowed:
            raise ApiError(422, "INVALID_NOTIFICATION_CATEGORY", f"Unknown notification category: {category}")
        models.NotificationPreference.objects.update_or_create(
            user_id=user_id,
            category=category,
            defaults={
                "in_app": bool(item.get("inApp", True)),
                "email": bool(item.get("email", True)),
            },
        )
    return list_preferences(user_id)
