"""Security, rate-limit, audit and notification tests.

These tests exercise the production-hardening layer directly rather than
through the demo flows: shared fixed-window limits, append-only audit tables,
transactional email delivery, notification preferences and the notification
centre API.
"""

from __future__ import annotations

import os
import secrets
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["DJANGO_SETTINGS_MODULE"] = "miraiwerk.settings"
os.environ["AI_PROVIDER"] = "deterministic"
os.environ["DJANGO_ALLOW_ASYNC_UNSAFE"] = "true"
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("GOOGLE_AI_API_KEY", None)
os.environ.pop("MODEL_API_KEY", None)
os.environ.pop("META_API_KEY", None)

import django  # noqa: E402

django.setup()

import pytest  # noqa: E402
from django.db import DatabaseError, connection  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from core import config, env  # noqa: E402
from core.errors import ApiError  # noqa: E402
from miraiwerk.asgi import application  # noqa: E402
from platform_app import models  # noqa: E402
from platform_app.passwords import hash_password  # noqa: E402
from services import email_service, notification_service, rate_limit  # noqa: E402

PREFIX = secrets.token_hex(4)
PASSWORD = f"Security!{PREFIX}9"
OWNER_EMAIL = f"security.owner.{PREFIX}@miraiwerk.test"
OTHER_EMAIL = f"security.other.{PREFIX}@miraiwerk.test"
ORG_ID = f"org_security_{PREFIX}"
WS_ID = f"ws_security_{PREFIX}"

client = TestClient(application)


def _create_fixtures() -> tuple[str, str]:
    owner = models.User.objects.create(
        id=f"usr_security_owner_{PREFIX}",
        name="Security Owner",
        email=OWNER_EMAIL,
        password_hash=hash_password(PASSWORD),
        status="active",
    )
    other = models.User.objects.create(
        id=f"usr_security_other_{PREFIX}",
        name="Security Other",
        email=OTHER_EMAIL,
        password_hash=hash_password(PASSWORD),
        status="active",
    )
    models.Organization.objects.create(
        id=ORG_ID, name="Security Test Org", slug=f"security-test-{PREFIX}", created_by=owner.id
    )
    models.Workspace.objects.create(
        id=WS_ID,
        organization_id=ORG_ID,
        name="Security Test Workspace",
        slug=f"security-test-ws-{PREFIX}",
        created_by=owner.id,
    )
    models.WorkspaceMember.objects.create(workspace_id=WS_ID, user_id=owner.id, role="owner")
    models.WorkspaceMember.objects.create(workspace_id=WS_ID, user_id=other.id, role="member")
    return owner.id, other.id


def _cleanup() -> None:
    models.NotificationPreference.objects.filter(
        user__email__in=[OWNER_EMAIL, OTHER_EMAIL]
    ).delete()
    models.Notification.objects.filter(workspace_id=WS_ID).delete()
    models.AiCall.objects.filter(workspace_id=WS_ID).delete()
    models.Project.objects.filter(workspace_id=WS_ID).delete()
    models.Workspace.objects.filter(id=WS_ID).delete()
    models.Organization.objects.filter(id=ORG_ID).delete()
    models.User.objects.filter(email__in=[OWNER_EMAIL, OTHER_EMAIL]).delete()
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM email_deliveries WHERE recipient IN (%s, %s)", [OWNER_EMAIL, OTHER_EMAIL])
        cursor.execute("DELETE FROM rate_limit_buckets WHERE scope LIKE %s", [f"test.security.{PREFIX}%"])


def _headers(user_id: str) -> dict:
    return {"x-user-id": user_id, "x-workspace-id": WS_ID}


# --------------------------------------------------------------------------
# Rate limiting
# --------------------------------------------------------------------------


def test_fixed_window_limit_is_shared_and_reports_retry_after(monkeypatch) -> None:
    scope = f"test.security.{PREFIX}.login"
    identity = f"user-{PREFIX}@example.test"
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)

    first = rate_limit.hit(scope, identity, limit=2, window_seconds=60)
    second = rate_limit.hit(scope, identity, limit=2, window_seconds=60)
    third = rate_limit.hit(scope, identity, limit=2, window_seconds=60)

    assert first.allowed and first.remaining == 1
    assert second.allowed and second.remaining == 0
    assert not third.allowed and third.retry_after > 0

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*) FROM rate_limit_buckets WHERE scope = %s",
            [scope],
        )
        assert cursor.fetchone()[0] == 1

    with pytest.raises(ApiError) as raised:
        rate_limit.enforce(scope, identity, 2, 60, "Slow down.")
    assert raised.value.status == 429
    assert raised.value.code == "RATE_LIMITED"
    assert raised.value.details["retryAfter"] > 0


def test_rate_limiter_hashes_the_identity(monkeypatch) -> None:
    scope = f"test.security.{PREFIX}.hash"
    identity = f"private-{PREFIX}@example.test"
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    rate_limit.hit(scope, identity, limit=3, window_seconds=60)
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT identity_hash FROM rate_limit_buckets WHERE scope = %s", [scope]
        )
        stored = cursor.fetchone()[0]
    assert stored != identity
    assert identity not in stored
    assert len(stored) == 64


def test_login_route_returns_429_when_the_limit_is_exhausted(monkeypatch) -> None:
    ip = f"203.0.113.{secrets.randbelow(200) + 1}"
    email = f"throttled.{PREFIX}@miraiwerk.test"
    monkeypatch.setattr(config, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(config, "RATE_LIMIT_LOGIN_IP", 1)
    monkeypatch.setattr(config, "RATE_LIMIT_LOGIN_ACCOUNT", 1)

    headers = {"x-forwarded-for": ip}
    first = client.post(
        "/api/auth/login", json={"email": email, "password": "wrong-password"}, headers=headers
    )
    assert first.status_code == 401

    second = client.post(
        "/api/auth/login", json={"email": email, "password": "wrong-password"}, headers=headers
    )
    assert second.status_code == 429
    error = second.json()["error"]
    assert error["code"] == "RATE_LIMITED"
    assert error["details"]["retryAfter"] > 0

    with connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM rate_limit_buckets WHERE scope = ANY(%s::text[]) AND identity_hash = ANY(%s::text[])",
            [
                ["auth.login.ip", "auth.login.account"],
                [
                    rate_limit._identity_hash(ip),
                    rate_limit._identity_hash(email),
                ],
            ],
        )


# --------------------------------------------------------------------------
# Append-only audit
# --------------------------------------------------------------------------


def test_audit_tables_reject_mutation_without_maintenance_mode() -> None:
    audit_id = f"sec_guard_{PREFIX}"
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO security_audit
              (id, action, outcome, user_agent, metadata, created_at)
            VALUES (%s, 'test.audit_guard', 'success', '', '{}', now())
            """,
            [audit_id],
        )

    with pytest.raises(DatabaseError) as raised:
        models.SecurityAudit.objects.filter(id=audit_id).update(outcome="failure")
    assert "append-only" in str(raised.value)

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT count(*) FROM pg_trigger
            WHERE NOT tgisinternal
              AND tgrelid IN (
                'security_audit'::regclass,
                'audit_events'::regclass,
                'decision_audit'::regclass
              )
            """
        )
        assert cursor.fetchone()[0] == 3

    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('miraiwerk.audit_maintenance', 'on', false)")
    try:
        models.SecurityAudit.objects.filter(id=audit_id).delete()
    finally:
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('miraiwerk.audit_maintenance', 'off', false)")


# --------------------------------------------------------------------------
# Production configuration
# --------------------------------------------------------------------------


def test_production_configuration_rejects_unsafe_defaults(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("DJANGO_SECRET_KEY", raising=False)
    monkeypatch.delenv("ALLOWED_HOSTS", raising=False)
    monkeypatch.setenv("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
    monkeypatch.setenv("AUTH_ALLOW_DEMO", "true")
    issues = env.production_issues()
    assert any("JWT_SECRET" in issue for issue in issues)
    assert any("DJANGO_SECRET_KEY" in issue for issue in issues)
    assert any("ALLOWED_HOSTS" in issue for issue in issues)
    assert any("EMAIL_BACKEND" in issue for issue in issues)
    assert any("AUTH_ALLOW_DEMO" in issue for issue in issues)


def test_production_configuration_accepts_a_safe_setup(monkeypatch) -> None:
    strong = "a" * 64
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("JWT_SECRET", strong)
    monkeypatch.setenv("DJANGO_SECRET_KEY", strong)
    monkeypatch.setenv("ALLOWED_HOSTS", "miraiwerk.example.com")
    monkeypatch.setenv("FRONTEND_ORIGINS", "https://miraiwerk.example.com")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("SECURE_SSL_REDIRECT", "true")
    monkeypatch.setenv("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend")
    monkeypatch.setenv("AUTH_ALLOW_DEMO", "false")
    assert env.production_issues() == []


# --------------------------------------------------------------------------
# Email delivery
# --------------------------------------------------------------------------


def test_password_reset_email_is_delivered_and_recorded() -> None:
    user = {"name": "Security Owner", "email": OWNER_EMAIL}
    sent = email_service.send_password_reset(user, "test-reset-token")
    assert sent is True
    delivery = models.EmailDelivery.objects.filter(
        recipient=OWNER_EMAIL, template="password_reset"
    ).first()
    assert delivery is not None
    assert delivery.status == "sent"


# --------------------------------------------------------------------------
# Notification centre
# --------------------------------------------------------------------------


def test_task_assignment_event_creates_an_in_app_notification() -> None:
    owner_id, other_id = _create_fixtures()
    try:
        models.NotificationPreference.objects.create(
            user_id=other_id, category="tasks", in_app=True, email=False
        )
        project = models.Project.objects.create(
            id=f"prj_security_{PREFIX}",
            organization_id=ORG_ID,
            workspace_id=WS_ID,
            name="Security Test Project",
            start_date=date.today(),
            created_by=owner_id,
        )
        task = models.Task.objects.create(
            id=f"tsk_security_{PREFIX}",
            project=project,
            title="Review the release gate",
            estimate_days=2,
            assignee_id=other_id,
        )

        notification_service.notify_task_assigned(owner_id, task.id)

        created = models.Notification.objects.get(
            recipient_id=other_id, entity_id=task.id
        )
        assert created.notification_type == "task_assigned"
        assert created.title == "Task assigned: Review the release gate"
        assert created.link == f"/tasks?project={project.id}"
        assert created.is_read is False
    finally:
        _cleanup()


def test_notification_centre_read_flow_and_preferences() -> None:
    owner_id, other_id = _create_fixtures()
    try:
        notification_id = notification_service.create_notification(
            recipient_id=owner_id,
            workspace_id=WS_ID,
            notification_type="task_assigned",
            category="tasks",
            title="Task assigned: Review release gate",
            message="You own the release review.",
            entity_type="task",
            entity_id="tsk_security",
            link="/tasks",
        )
        assert notification_id

        listing = client.get("/api/notifications", headers=_headers(owner_id))
        assert listing.status_code == 200, listing.text
        payload = listing.json()
        assert payload["unreadCount"] == 1
        assert payload["notifications"][0]["title"] == "Task assigned: Review release gate"

        unread = client.get(
            "/api/notifications?status=unread&limit=5", headers=_headers(owner_id)
        )
        assert unread.status_code == 200
        assert len(unread.json()["notifications"]) == 1

        other_listing = client.get("/api/notifications", headers=_headers(other_id))
        assert other_listing.status_code == 200
        assert other_listing.json()["notifications"] == []

        forbidden = client.post(
            f"/api/notifications/{notification_id}/read", headers=_headers(other_id)
        )
        assert forbidden.status_code == 404

        marked = client.post(
            f"/api/notifications/{notification_id}/read", headers=_headers(owner_id)
        )
        assert marked.status_code == 200
        assert marked.json() == {"ok": True}

        count = client.get(
            "/api/notifications/unread-count", headers=_headers(owner_id)
        )
        assert count.json() == {"unreadCount": 0}

        preferences = client.get(
            "/api/notification-preferences", headers=_headers(owner_id)
        )
        assert preferences.status_code == 200
        security_pref = next(
            item for item in preferences.json()["preferences"] if item["category"] == "security"
        )
        assert security_pref["locked"] is True

        patched = client.patch(
            "/api/notification-preferences",
            headers=_headers(owner_id),
            json={"preferences": [{"category": "tasks", "inApp": False, "email": False}]},
        )
        assert patched.status_code == 200
        tasks_pref = next(
            item for item in patched.json()["preferences"] if item["category"] == "tasks"
        )
        assert tasks_pref["inApp"] is False

        suppressed = notification_service.create_notification(
            recipient_id=owner_id,
            workspace_id=WS_ID,
            notification_type="task_assigned",
            category="tasks",
            title="Suppressed task notification",
        )
        assert suppressed is None

        locked = client.patch(
            "/api/notification-preferences",
            headers=_headers(owner_id),
            json={"preferences": [{"category": "security", "inApp": False}]},
        )
        assert locked.status_code == 422
        assert locked.json()["error"]["code"] == "INVALID_NOTIFICATION_CATEGORY"

        second = notification_service.create_notification(
            recipient_id=owner_id,
            workspace_id=WS_ID,
            notification_type="decision_proposed",
            category="decisions",
            title="Decision ready for review",
        )
        assert second
        all_read = client.post("/api/notifications/read-all", headers=_headers(owner_id))
        assert all_read.status_code == 200
        assert all_read.json()["updated"] == 1
    finally:
        _cleanup()
