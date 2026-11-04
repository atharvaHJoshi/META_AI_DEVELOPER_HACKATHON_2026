"""Create due-soon, overdue and milestone reminders from a scheduled job.

Run once a day after the notification tables exist, for example:

    python manage.py notify_reminders

The command is idempotent for a given day because every event carries a dedupe
key. It is safe to run from cron or a future Celery beat schedule.
"""

from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import connection
from django.utils import timezone

from core.common import iso_date
from services import notification_service


class Command(BaseCommand):
    help = "Create in-app reminders for due-soon tasks, overdue tasks and approaching milestones."

    def add_arguments(self, parser):
        parser.add_argument("--due-soon-days", type=int, default=2)
        parser.add_argument("--milestone-days", type=int, default=7)

    def handle(self, *args, **options):
        today = timezone.localdate()
        due_soon_days = max(0, options["due_soon_days"])
        milestone_days = max(0, options["milestone_days"])
        created = 0
        created += self._task_reminders(today, due_soon_days)
        created += self._milestone_reminders(today, milestone_days)
        self.stdout.write(self.style.SUCCESS(f"Reminder notifications created: {created}"))

    def _task_reminders(self, today, due_soon_days: int) -> int:
        horizon = today + timedelta(days=due_soon_days)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT t.id, t.title, t.assignee_id, t.planned_finish,
                       t.project_id, p.name AS project_name, p.workspace_id
                FROM tasks t JOIN projects p ON p.id = t.project_id
                WHERE t.status <> 'done'
                  AND t.planned_finish IS NOT NULL
                  AND t.planned_finish <= %s
                ORDER BY t.planned_finish
                """,
                [horizon],
            )
            rows = self._dicts(cursor)

        created = 0
        for task in rows:
            finish = task["planned_finish"]
            if not task["assignee_id"]:
                continue
            overdue = finish < today
            recipients = [task["assignee_id"]]
            if overdue:
                recipients += [
                    manager
                    for manager in notification_service._project_managers(task["project_id"])
                    if manager != task["assignee_id"]
                ]
            for recipient in dict.fromkeys(recipients):
                notification_type = "task_overdue" if overdue else "task_due_soon"
                link = f"/tasks?project={task['project_id']}"
                title = (
                    f"Overdue task: {task['title']}"
                    if overdue
                    else f"Task due soon: {task['title']}"
                )
                message = (
                    f"This task in {task['project_name']} was due on {iso_date(finish)}."
                    if overdue
                    else f"This task in {task['project_name']} is due on {iso_date(finish)}."
                )
                notification_id = notification_service.create_notification(
                    recipient_id=recipient,
                    workspace_id=task["workspace_id"],
                    project_id=task["project_id"],
                    notification_type=notification_type,
                    category="tasks",
                    title=title,
                    message=message,
                    entity_type="task",
                    entity_id=task["id"],
                    link=link,
                    email=overdue,
                    dedupe_key=f"{notification_type}:{task['id']}:{iso_date(finish)}",
                )
                created += 1 if notification_id else 0
        return created

    def _milestone_reminders(self, today, milestone_days: int) -> int:
        horizon = today + timedelta(days=milestone_days)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT m.id, m.title, m.target_date, m.project_id,
                       p.name AS project_name, p.workspace_id
                FROM milestones m JOIN projects p ON p.id = m.project_id
                WHERE m.status NOT IN ('done', 'completed', 'cancelled')
                  AND m.target_date IS NOT NULL
                  AND m.target_date BETWEEN %s AND %s
                ORDER BY m.target_date
                """,
                [today, horizon],
            )
            rows = self._dicts(cursor)

        created = 0
        for milestone in rows:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT user_id FROM project_members WHERE project_id = %s
                    UNION
                    SELECT user_id FROM workspace_members WHERE workspace_id = %s
                    """,
                    [milestone["project_id"], milestone["workspace_id"]],
                )
                recipients = [row[0] for row in cursor.fetchall()]
            for recipient in recipients:
                notification_id = notification_service.create_notification(
                    recipient_id=recipient,
                    workspace_id=milestone["workspace_id"],
                    project_id=milestone["project_id"],
                    notification_type="milestone_approaching",
                    category="milestones",
                    title=f"Milestone approaching: {milestone['title']}",
                    message=(
                        f"{milestone['project_name']} targets this milestone on "
                        f"{iso_date(milestone['target_date'])}."
                    ),
                    entity_type="milestone",
                    entity_id=milestone["id"],
                    link=f"/roadmap?project={milestone['project_id']}",
                    dedupe_key=(
                        f"milestone_approaching:{milestone['id']}:"
                        f"{iso_date(milestone['target_date'])}"
                    ),
                )
                created += 1 if notification_id else 0
        return created

    @staticmethod
    def _dicts(cursor) -> list[dict]:
        rows = cursor.fetchall()
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in rows]
