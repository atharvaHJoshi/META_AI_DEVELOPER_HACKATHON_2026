"""Transactional email delivery.

Django's email framework is used so the same code path works with the console
backend in development, the locmem backend in tests and SMTP/SES-compatible
backends in production. The API response never contains a reset token in
production; the token is delivered only by email.

Every attempt is recorded in ``email_deliveries``. A delivery failure is logged
and recorded but does not roll back the business transaction that triggered it.
"""

from __future__ import annotations

import logging
from urllib.parse import quote

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import connection
from django.utils.html import escape

from core import config
from core.common import new_id

logger = logging.getLogger("miraiwerk.email")


def absolute_link(path: str) -> str:
    base = (config.WEB_ORIGIN or "http://localhost:5173").rstrip("/")
    return f"{base}/{path.lstrip('/')}"


def _record_delivery(recipient: str, template: str, status: str, error: str | None) -> None:
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO email_deliveries (id, recipient, template, status, error, created_at)
                VALUES (%s, %s, %s, %s, %s, now())
                """,
                [new_id("mail"), recipient[:320], template[:80], status, error],
            )
    except Exception:  # noqa: BLE001 - delivery telemetry must never break the caller
        logger.exception("Failed to record email delivery")


def send_email(
    *,
    to: str,
    subject: str,
    text: str,
    template: str,
    html: str | None = None,
) -> bool:
    recipient = (to or "").strip()
    if not recipient or "@" not in recipient:
        _record_delivery(recipient, template, "skipped", "invalid recipient")
        return False

    try:
        message = EmailMultiAlternatives(
            subject=subject,
            body=text,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[recipient],
        )
        if html:
            message.attach_alternative(html, "text/html")
        sent = message.send(fail_silently=False)
        status = "sent" if sent else "failed"
        _record_delivery(recipient, template, status, None if sent else "backend returned 0")
        return bool(sent)
    except Exception as exc:  # noqa: BLE001 - email failure is reported, not raised
        logger.warning("Email delivery failed for template %s: %s", template, exc)
        _record_delivery(recipient, template, "failed", str(exc)[:1000])
        return False


def _paragraphs(*lines: str) -> str:
    return "\n\n".join(line for line in lines if line)


def send_password_reset(user: dict, token: str) -> bool:
    link = absolute_link(f"/reset-password?token={quote(token)}")
    name = user.get("name") or "there"
    text = _paragraphs(
        f"Hi {name},",
        "A password reset was requested for your MIRAIWERK AI account. The link below expires in 30 minutes and can be used once.",
        link,
        "If you did not request this, you can ignore this email. Your current password remains unchanged.",
    )
    html = (
        f"<p>Hi {escape(name)},</p>"
        "<p>A password reset was requested for your MIRAIWERK AI account. "
        "The link below expires in 30 minutes and can be used once.</p>"
        f'<p><a href="{escape(link)}">Reset your password</a></p>'
        "<p>If you did not request this, you can ignore this email. Your current password remains unchanged.</p>"
    )
    return send_email(
        to=user.get("email", ""),
        subject="Reset your MIRAIWERK AI password",
        text=text,
        template="password_reset",
        html=html,
    )


def send_workspace_invitation(
    *,
    email: str,
    workspace_name: str,
    actor_name: str,
    role: str,
) -> bool:
    link = absolute_link(f"/register?email={quote(email)}")
    text = _paragraphs(
        f"{actor_name} invited you to the {workspace_name} workspace on MIRAIWERK AI as a {role}.",
        "Create your account with this email address to accept the invitation:",
        link,
        "If you were not expecting this invitation, you can ignore this email.",
    )
    html = (
        f"<p>{escape(actor_name)} invited you to the <strong>{escape(workspace_name)}</strong> "
        f"workspace on MIRAIWERK AI as a {escape(role)}.</p>"
        f'<p><a href="{escape(link)}">Create your account</a></p>'
        "<p>If you were not expecting this invitation, you can ignore this email.</p>"
    )
    return send_email(
        to=email,
        subject=f"You were invited to {workspace_name} on MIRAIWERK AI",
        text=text,
        template="workspace_invitation",
        html=html,
    )


def send_organization_invitation(
    *,
    email: str,
    organization_name: str,
    actor_name: str,
    role: str,
) -> bool:
    link = absolute_link(f"/register?email={quote(email)}")
    text = _paragraphs(
        f"{actor_name} invited you to the {organization_name} organization on MIRAIWERK AI as a {role}.",
        "Create your account with this email address to accept the invitation:",
        link,
    )
    return send_email(
        to=email,
        subject=f"You were invited to {organization_name} on MIRAIWERK AI",
        text=text,
        template="organization_invitation",
    )


def send_task_assignment(
    *, email: str, name: str, task_title: str, project_name: str, project_id: str, actor_name: str
) -> bool:
    link = absolute_link(f"/projects/{project_id}")
    text = _paragraphs(
        f"Hi {name},",
        f"{actor_name} assigned you the task \"{task_title}\" in {project_name}.",
        link,
    )
    return send_email(
        to=email,
        subject=f"Task assigned: {task_title}",
        text=text,
        template="task_assignment",
    )


def send_decision_outcome(
    *, email: str, name: str, ticket_title: str, outcome: str, link: str
) -> bool:
    url = absolute_link(link)
    text = _paragraphs(
        f"Hi {name},",
        f"The decision for \"{ticket_title}\" was {outcome}.",
        url,
    )
    return send_email(
        to=email,
        subject=f"Decision {outcome}: {ticket_title}",
        text=text,
        template="decision_outcome",
    )


def send_meeting_invitation(
    *, email: str, name: str, meeting_title: str, scheduled_at: str | None, workspace_name: str
) -> bool:
    link = absolute_link("/meetings")
    text = _paragraphs(
        f"Hi {name},",
        f"You were invited to \"{meeting_title}\" in {workspace_name}.",
        f"Scheduled: {scheduled_at or 'not yet scheduled'}",
        link,
    )
    return send_email(
        to=email,
        subject=f"Meeting invited: {meeting_title}",
        text=text,
        template="meeting_invitation",
    )


def send_notification_email(
    *, email: str, name: str, title: str, message: str, link: str | None
) -> bool:
    url = absolute_link(link) if link else None
    text = _paragraphs(f"Hi {name},", title, message, url or "")
    return send_email(
        to=email,
        subject=title,
        text=text,
        template="notification",
    )
