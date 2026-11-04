"""Role resolution and access assertions (ported from Express auth.ts)."""

from __future__ import annotations

from django.db import connection

from core.errors import ApiError

WORKSPACE_ROLE_RANK = {
    "viewer": 0,
    "member": 1,
    "manager": 2,
    "admin": 3,
    "owner": 4,
}

PROJECT_ROLE_RANK = {
    "viewer": 0,
    "member": 1,
    "pm": 2,
    "owner": 3,
}

WORKSPACE_ROLES = ("owner", "admin", "manager", "member", "viewer")

PROJECT_TO_WORKSPACE = {
    "owner": "owner",
    "pm": "manager",
    "member": "member",
    "viewer": "viewer",
}


def get_user_by_id(user_id: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, name, email, title, avatar_color, status,
                   is_platform_admin, avatar_url
            FROM users WHERE id = %s
            """,
            [user_id],
        )
        row = cursor.fetchone()
    if row is None:
        return None
    return _user_dict(row)


def get_user_by_email(email: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, name, email, title, avatar_color, status,
                   is_platform_admin, avatar_url
            FROM users WHERE lower(email) = lower(%s)
            """,
            [email],
        )
        row = cursor.fetchone()
    if row is None:
        return None
    return _user_dict(row)


def _user_dict(row) -> dict:
    return {
        "id": row[0],
        "name": row[1],
        "email": row[2],
        "title": row[3],
        "avatar_color": row[4],
        "status": row[5],
        "is_platform_admin": row[6],
        "avatar_url": row[7],
    }


def get_user_with_password(user_id: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, name, email, title, avatar_color, avatar_url, status,
                   is_platform_admin, password_hash
            FROM users WHERE id = %s
            """,
            [user_id],
        )
        row = cursor.fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "name": row[1],
        "email": row[2],
        "title": row[3],
        "avatar_color": row[4],
        "avatar_url": row[5],
        "status": row[6],
        "is_platform_admin": row[7],
        "password_hash": row[8],
    }


def get_user_with_password_by_email(email: str) -> dict | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, name, email, title, avatar_color, avatar_url, status,
                   is_platform_admin, password_hash
            FROM users WHERE lower(email) = lower(%s)
            """,
            [email],
        )
        row = cursor.fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "name": row[1],
        "email": row[2],
        "title": row[3],
        "avatar_color": row[4],
        "avatar_url": row[5],
        "status": row[6],
        "is_platform_admin": row[7],
        "password_hash": row[8],
    }


def organization_role(user_id: str, organization_id: str) -> str | None:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT role FROM organization_members WHERE user_id = %s AND organization_id = %s",
            [user_id, organization_id],
        )
        row = cursor.fetchone()
    return row[0] if row else None


def workspace_role(user_id: str, workspace_id: str) -> str | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT wm.role AS workspace_role, om.role AS org_role
            FROM workspaces w
            LEFT JOIN workspace_members wm
              ON wm.workspace_id = w.id AND wm.user_id = %s
            LEFT JOIN organization_members om
              ON om.organization_id = w.organization_id AND om.user_id = %s
            WHERE w.id = %s
            """,
            [user_id, user_id, workspace_id],
        )
        row = cursor.fetchone()
    if row is None:
        return None
    candidates = [role for role in (row[0], row[1]) if role]
    if not candidates:
        return None
    return max(candidates, key=lambda role: WORKSPACE_ROLE_RANK.get(role, -1))


def assert_organization_access(
    user_id: str,
    organization_id: str,
    allowed: list[str] | tuple[str, ...] = WORKSPACE_ROLES,
) -> str:
    role = organization_role(user_id, organization_id)
    if role is None:
        raise ApiError(
            403, "FORBIDDEN", "You are not a member of this organization."
        )
    if role not in allowed:
        raise ApiError(
            403,
            "FORBIDDEN",
            f"This action requires organization roles: {', '.join(allowed)}.",
        )
    return role


def assert_workspace_access(
    user_id: str,
    workspace_id: str,
    allowed: list[str] | tuple[str, ...] = WORKSPACE_ROLES,
) -> str:
    role = workspace_role(user_id, workspace_id)
    if role is None:
        raise ApiError(403, "FORBIDDEN", "You are not a member of this workspace.")
    if role not in allowed:
        raise ApiError(
            403,
            "FORBIDDEN",
            f"This action requires workspace roles: {', '.join(allowed)}.",
        )
    return role


def _workspace_role_to_project_role(role: str) -> str:
    if role in {"owner", "admin"}:
        return "owner"
    if role == "manager":
        return "pm"
    if role == "member":
        return "member"
    return "viewer"


def project_role(user_id: str, project_id: str) -> str | None:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT role FROM project_members WHERE user_id = %s AND project_id = %s",
            [user_id, project_id],
        )
        row = cursor.fetchone()
    if row:
        return row[0]

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT p.workspace_id,
                   COALESCE(p.organization_id, w.organization_id) AS organization_id,
                   wm.role AS workspace_role,
                   om.role AS org_role
            FROM projects p
            LEFT JOIN workspaces w ON w.id = p.workspace_id
            LEFT JOIN workspace_members wm
              ON wm.workspace_id = p.workspace_id AND wm.user_id = %s
            LEFT JOIN organization_members om
              ON om.organization_id = COALESCE(p.organization_id, w.organization_id)
             AND om.user_id = %s
            WHERE p.id = %s
            """,
            [user_id, user_id, project_id],
        )
        row = cursor.fetchone()
    if row is None:
        return None
    candidates = [role for role in (row[2], row[3]) if role]
    if not candidates:
        return None
    best = max(candidates, key=lambda role: WORKSPACE_ROLE_RANK.get(role, -1))
    return _workspace_role_to_project_role(best)


def assert_project_access(
    user_id: str,
    project_id: str,
    allowed: list[str] | tuple[str, ...] = ("owner", "pm", "member", "viewer"),
) -> str:
    role = project_role(user_id, project_id)
    if role is None:
        raise ApiError(403, "FORBIDDEN", "You are not a member of this project.")
    if role not in allowed:
        raise ApiError(
            403,
            "FORBIDDEN",
            f"This action requires one of these project roles: {', '.join(allowed)}.",
        )
    return role
