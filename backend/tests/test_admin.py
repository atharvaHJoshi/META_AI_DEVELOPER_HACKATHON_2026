"""Django admin compatibility tests.

The product uses its own ``users`` table, password hashes and string primary
keys. These tests prove the staff console still authenticates and renders the
registry against that schema, which unit-level API tests cannot cover.
"""

from __future__ import annotations

import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["DJANGO_SETTINGS_MODULE"] = "miraiwerk.settings"
os.environ["AI_PROVIDER"] = "deterministic"
os.environ["DJANGO_ALLOW_ASYNC_UNSAFE"] = "true"

import django  # noqa: E402

django.setup()

from django.test import Client  # noqa: E402

from platform_app import models  # noqa: E402
from platform_app.passwords import hash_password  # noqa: E402

PREFIX = secrets.token_hex(4)
EMAIL = f"admin.surface.{PREFIX}@miraiwerk.test"
PASSWORD = "AdminSurface!2026"


def test_admin_login_index_and_registry_pages() -> None:
    user = models.User.objects.create(
        id=f"usr_admin_{PREFIX}",
        name="Admin Surface",
        email=EMAIL,
        password_hash=hash_password(PASSWORD),
        status="active",
        is_staff=True,
        is_platform_admin=True,
    )
    try:
        client = Client()

        rejected = client.post(
            "/admin/login/", {"username": EMAIL, "password": "definitely-wrong"}
        )
        assert rejected.status_code == 200
        assert "errornote" in rejected.content.decode()

        accepted = client.post(
            "/admin/login/?next=/admin/",
            {"username": EMAIL, "password": PASSWORD},
        )
        assert accepted.status_code == 302
        assert accepted.url == "/admin/"

        index = client.get("/admin/")
        assert index.status_code == 200
        assert "MIRAIWERK Platform" in index.content.decode()

        users = client.get("/admin/platform_app/user/")
        assert users.status_code == 200
        assert EMAIL in users.content.decode()

        projects = client.get("/admin/platform_app/project/")
        assert projects.status_code == 200

        add_form = client.get("/admin/platform_app/user/add/")
        assert add_form.status_code == 200

        logout = client.post("/admin/logout/")
        assert logout.status_code == 200
    finally:
        models.User.objects.filter(id=user.id).delete()


def test_non_staff_user_cannot_open_admin() -> None:
    user = models.User.objects.create(
        id=f"usr_member_{PREFIX}",
        name="Member Surface",
        email=f"member.surface.{PREFIX}@miraiwerk.test",
        password_hash=hash_password(PASSWORD),
        status="active",
        is_staff=False,
    )
    try:
        client = Client()
        client.post(
            "/admin/login/?next=/admin/",
            {"username": user.email, "password": PASSWORD},
        )
        response = client.get("/admin/")
        # The admin redirects non-staff sessions back to the login form.
        assert response.status_code == 302
        assert "/admin/login/" in response.url
    finally:
        models.User.objects.filter(id=user.id).delete()
