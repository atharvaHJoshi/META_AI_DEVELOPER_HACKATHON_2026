"""Authentication service — ported from authService.ts."""

from __future__ import annotations

import json
from django.db import connection, transaction
from django.utils import timezone
from datetime import timedelta

from core import config
from core.common import iso_datetime, new_id
from core.errors import ApiError
from core.security import (
    create_opaque_token,
    hash_token,
    refresh_cookie_options,
    sign_access_token,
)
from platform_app.passwords import hash_password, password_problem, verify_password
from services import authz
from services.org_service import ensure_personal_workspace, list_organizations, list_workspaces


def user_dto(user: dict) -> dict:
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "title": user["title"],
        "avatarColor": user["avatar_color"],
        "avatarUrl": user.get("avatar_url"),
        "status": user.get("status") or "active",
        "isPlatformAdmin": bool(user.get("is_platform_admin")),
    }


def request_meta(request) -> dict:
    user_agent = request.headers.get("user-agent", "")[:400]
    forwarded = request.headers.get("x-forwarded-for")
    ip = (forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None))
    return {"userAgent": user_agent, "ip": ip}


def record_security_audit(
    user_id: str | None,
    action: str,
    outcome: str,
    meta: dict,
    metadata: dict | None = None,
) -> None:
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO security_audit (id, user_id, action, outcome, ip_address, user_agent, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    new_id("sec"),
                    user_id,
                    action,
                    outcome,
                    (meta or {}).get("ip"),
                    (meta or {}).get("userAgent", ""),
                    json.dumps(metadata or {}),
                ],
            )
    except Exception:  # noqa: BLE001 - audit must never break auth flows
        import logging

        logging.getLogger("miraiwerk.audit").exception("security audit write failed")


def _create_session(user_id: str, meta: dict) -> str:
    raw, token_hash = create_opaque_token()
    expires_at = timezone.now() + timedelta(days=config.REFRESH_TOKEN_DAYS)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO sessions
              (id, user_id, family_id, token_hash, user_agent, ip_address, expires_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            [
                new_id("ses"),
                user_id,
                new_id("fam"),
                token_hash,
                meta.get("userAgent", ""),
                meta.get("ip"),
                expires_at,
            ],
        )
    return raw


def _auth_response(user: dict, meta: dict) -> dict:
    token, expires_in = sign_access_token(user)
    refresh_token = _create_session(user["id"], meta)
    return {
        "user": user_dto(user),
        "accessToken": token,
        "refreshToken": refresh_token,
        "expiresIn": expires_in,
        "organizations": list_organizations(user["id"]),
        "workspaces": list_workspaces(user["id"]),
    }


def current_user(user_id: str) -> dict:
    user = authz.get_user_with_password(user_id)
    if user is None:
        raise ApiError(401, "UNAUTHENTICATED", "Unknown user.")
    return {
        "user": user_dto(user),
        "organizations": list_organizations(user_id),
        "workspaces": list_workspaces(user_id),
    }


def register(input_data: dict, meta: dict) -> dict:
    email = (input_data.get("email") or "").strip().lower()
    full_name = (input_data.get("fullName") or "").strip()
    password = input_data.get("password") or ""
    if "@" not in email:
        raise ApiError(422, "INVALID_EMAIL", "Enter a valid email address.")
    if len(full_name) < 2:
        raise ApiError(422, "INVALID_NAME", "Enter your full name.")
    problem = password_problem(password)
    if problem:
        raise ApiError(422, "WEAK_PASSWORD", problem)

    existing = authz.get_user_with_password_by_email(email)
    if existing and existing.get("password_hash"):
        raise ApiError(409, "EMAIL_IN_USE", "An account with this email already exists.")

    if existing:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE users
                SET name = %s, password_hash = %s, status = 'active', updated_at = now()
                WHERE id = %s
                """,
                [full_name, hash_password(password), existing["id"]],
            )
        ensure_personal_workspace(existing["id"], full_name)
        record_security_audit(
            existing["id"], "auth.register", "success", meta,
            {"completedInvitation": True},
        )
        user = authz.get_user_with_password_by_email(email)
        return _auth_response(user, meta)

    user_id = new_id("usr")
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO users (id, name, email, title, password_hash, status)
                VALUES (%s, %s, %s, '', %s, 'active')
                """,
                [user_id, full_name, email, hash_password(password)],
            )
    ensure_personal_workspace(user_id, full_name)
    record_security_audit(user_id, "auth.register", "success", meta)
    user = authz.get_user_with_password_by_email(email)
    return _auth_response(user, meta)


def login(input_data: dict, meta: dict) -> dict:
    email = (input_data.get("email") or "").strip()
    password = input_data.get("password") or ""
    user = authz.get_user_with_password_by_email(email)
    valid = bool(user) and verify_password(password, user.get("password_hash"))
    if not user or not valid:
        record_security_audit(
            (user or {}).get("id"), "auth.login", "failure", meta,
            {"email": email[:120]},
        )
        raise ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.")
    if user["status"] != "active":
        record_security_audit(user["id"], "auth.login", "failure", meta, {"reason": "inactive"})
        raise ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.")
    with connection.cursor() as cursor:
        cursor.execute("UPDATE users SET last_login_at = now() WHERE id = %s", [user["id"]])
    record_security_audit(user["id"], "auth.login", "success", meta)
    return _auth_response(user, meta)


def demo_login(email: str, meta: dict) -> dict:
    if not config.AUTH_ALLOW_DEMO:
        raise ApiError(404, "NOT_FOUND", "Demo sign-in is disabled.")
    user = authz.get_user_with_password_by_email(email)
    if not user:
        raise ApiError(404, "DEMO_USER_NOT_FOUND", "Demo identity not found.")
    if user["status"] != "active":
        raise ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.")
    record_security_audit(user["id"], "auth.demo_login", "success", meta)
    return _auth_response(user, meta)


def rotate_refresh_token(raw_token: str, meta: dict) -> dict:
    token_hash = hash_token(raw_token)
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, user_id, family_id, expires_at, revoked_at FROM sessions WHERE token_hash = %s",
            [token_hash],
        )
        row = cursor.fetchone()
    if row is None:
        raise ApiError(401, "INVALID_REFRESH", "Your session is no longer valid. Sign in again.")
    session = {
        "id": row[0],
        "user_id": row[1],
        "family_id": row[2],
        "expires_at": row[3],
        "revoked_at": row[4],
    }

    if session["revoked_at"] is not None:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE sessions SET revoked_at = now(), revoked_reason = 'reuse_detected'
                WHERE family_id = %s AND revoked_at IS NULL
                """,
                [session["family_id"]],
            )
        record_security_audit(
            session["user_id"], "auth.refresh_reuse", "failure", meta,
            {"familyId": session["family_id"]},
        )
        raise ApiError(401, "SESSION_REVOKED", "This session was revoked. Sign in again.")

    if session["expires_at"] <= timezone.now():
        raise ApiError(401, "SESSION_EXPIRED", "Your session expired. Sign in again.")

    user = authz.get_user_with_password(session["user_id"])
    if not user or user["status"] != "active":
        raise ApiError(401, "ACCOUNT_INACTIVE", "This account is not active.")

    raw, new_hash = create_opaque_token()
    new_id_value = new_id("ses")
    expires_at = timezone.now() + timedelta(days=config.REFRESH_TOKEN_DAYS)

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO sessions
                  (id, user_id, family_id, token_hash, user_agent, ip_address, expires_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    new_id_value,
                    user["id"],
                    session["family_id"],
                    new_hash,
                    meta.get("userAgent", ""),
                    meta.get("ip"),
                    expires_at,
                ],
            )
            cursor.execute(
                """
                UPDATE sessions
                SET rotated_to = %s, revoked_at = now(), revoked_reason = 'rotated', last_used_at = now()
                WHERE id = %s
                """,
                [new_id_value, session["id"]],
            )

    response = _auth_response(user, meta)
    # Remove the throw-away session created by _auth_response; return the rotated token instead.
    with connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM sessions WHERE user_id = %s AND token_hash = %s",
            [user["id"], hash_token(response["refreshToken"])],
        )
    return {**response, "refreshToken": raw}


def revoke_refresh_token(raw_token: str | None, user_id: str | None) -> None:
    if not raw_token:
        return
    token_hash = hash_token(raw_token)
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, user_id FROM sessions WHERE token_hash = %s", [token_hash]
        )
        row = cursor.fetchone()
    if row is None:
        return
    if user_id and row[1] != user_id:
        return
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout'
            WHERE id = %s AND revoked_at IS NULL
            """,
            [row[0]],
        )


def list_sessions(user_id: str, current_token: str | None = None) -> list[dict]:
    current_hash = hash_token(current_token) if current_token else None
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, token_hash, user_agent, ip_address, created_at, last_used_at, expires_at
            FROM sessions
            WHERE user_id = %s AND revoked_at IS NULL AND expires_at > now()
            ORDER BY last_used_at DESC
            """,
            [user_id],
        )
        rows = cursor.fetchall()
    return [
        {
            "id": row[0],
            "userAgent": row[2],
            "ipAddress": row[3],
            "createdAt": iso_datetime(row[4]),
            "lastUsedAt": iso_datetime(row[5]),
            "expiresAt": iso_datetime(row[6]),
            "current": current_hash is not None and row[1] == current_hash,
        }
        for row in rows
    ]


def revoke_session(user_id: str, session_id: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE sessions SET revoked_at = now(), revoked_reason = 'user_revoked'
            WHERE id = %s AND user_id = %s AND revoked_at IS NULL
            """,
            [session_id, user_id],
        )
        if cursor.rowcount == 0:
            raise ApiError(404, "SESSION_NOT_FOUND", "Session not found.")


def forgot_password(email: str, meta: dict) -> dict:
    user = authz.get_user_with_password_by_email((email or "").strip())
    if not user:
        return {"devToken": None}
    raw, token_hash = create_opaque_token()
    expires_at = timezone.now() + timedelta(minutes=30)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO one_time_tokens (id, user_id, purpose, token_hash, expires_at)
            VALUES (%s, %s, 'password_reset', %s, %s)
            """,
            [new_id("ott"), user["id"], token_hash, expires_at],
        )
    record_security_audit(user["id"], "auth.password_forgot", "success", meta)
    dev_token = raw if not config.IS_PRODUCTION else None
    if dev_token:
        import logging

        logging.getLogger("miraiwerk.dev").info(
            "password reset token for %s: %s", user["email"], dev_token
        )
    return {"devToken": dev_token}


def reset_password(token: str, password: str, meta: dict) -> None:
    problem = password_problem(password)
    if problem:
        raise ApiError(422, "WEAK_PASSWORD", problem)
    token_hash = hash_token(token)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, user_id FROM one_time_tokens
            WHERE token_hash = %s AND purpose = 'password_reset'
              AND consumed_at IS NULL AND expires_at > now()
            """,
            [token_hash],
        )
        row = cursor.fetchone()
    if row is None:
        raise ApiError(400, "INVALID_RESET_TOKEN", "This reset link is invalid or expired.")
    token_id, user_id = row
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET password_hash = %s, updated_at = now() WHERE id = %s",
                [hash_password(password), user_id],
            )
            cursor.execute(
                "UPDATE one_time_tokens SET consumed_at = now() WHERE id = %s",
                [token_id],
            )
            cursor.execute(
                """
                UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset'
                WHERE user_id = %s AND revoked_at IS NULL
                """,
                [user_id],
            )
    record_security_audit(user_id, "auth.password_reset", "success", meta)


def login_with_oauth(
    provider: str,
    profile: dict,
    meta: dict,
) -> dict:
    provider_user_id = profile["providerUserId"]
    email = profile.get("email")
    name = profile.get("name") or f"{provider} user"

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT user_id FROM oauth_accounts WHERE provider = %s AND provider_user_id = %s",
            [provider, provider_user_id],
        )
        row = cursor.fetchone()
    user_id = row[0] if row else None

    if user_id is None and email:
        by_email = authz.get_user_by_email(email)
        if by_email:
            user_id = by_email["id"]

    if user_id is None:
        user_id = new_id("usr")
        fallback_email = (email or f"{provider}_{provider_user_id}@users.miraiwerk.local").lower()
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO users (id, name, email, title, status)
                VALUES (%s, %s, %s, '', 'active')
                """,
                [user_id, name or f"{provider} user", fallback_email],
            )
        ensure_personal_workspace(user_id, name or "Member")

    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO oauth_accounts
              (id, user_id, provider, provider_user_id, email_at_provider, last_login_at)
            VALUES (%s, %s, %s, %s, %s, now())
            ON CONFLICT (provider, provider_user_id)
            DO UPDATE SET last_login_at = now(), email_at_provider = EXCLUDED.email_at_provider
            """,
            [new_id("oa"), user_id, provider, provider_user_id, email],
        )
    user = authz.get_user_with_password(user_id)
    if user is None:
        raise ApiError(500, "OAUTH_USER_FAILED", "Could not load the OAuth account.")
    if user["status"] != "active":
        raise ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.")
    with connection.cursor() as cursor:
        cursor.execute("UPDATE users SET last_login_at = now() WHERE id = %s", [user["id"]])
    record_security_audit(user["id"], f"auth.oauth.{provider}", "success", meta)
    return _auth_response(user, meta)


def update_profile(user_id: str, input_data: dict) -> None:
    sets: list[str] = []
    params: list[object] = []
    if input_data.get("name") is not None:
        value = str(input_data["name"]).strip()
        if value:
            sets.append("name = %s")
            params.append(value)
    if input_data.get("title") is not None:
        sets.append("title = %s")
        params.append((input_data.get("title") or "").strip())
    if input_data.get("avatarColor") is not None:
        sets.append("avatar_color = %s")
        params.append(input_data["avatarColor"])
    if input_data.get("timezone") is not None:
        sets.append("timezone = %s")
        params.append(input_data["timezone"])

    if not sets:
        return
    sets.append("updated_at = now()")
    sql = f"UPDATE users SET {', '.join(sets)} WHERE id = %s"
    params.append(user_id)
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
