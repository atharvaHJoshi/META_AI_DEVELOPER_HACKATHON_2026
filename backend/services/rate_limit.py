"""Shared fixed-window rate limiting backed by PostgreSQL.

The API runs as more than one process in production. An in-memory counter would
let each worker keep its own allowance, so limits are stored in the database and
updated with a single atomic upsert. No new infrastructure is needed before
Redis is introduced for background jobs.

Identities are hashed. A bucket key never contains an email address, token or IP
address in plaintext.

Limits are intentionally conservative defaults and are configurable through
``RATE_LIMIT_*`` environment variables. Tests disable them with
``RATE_LIMIT_ENABLED=false``; the service itself is exercised directly in the
security test module.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone as dt_timezone

from django.db import connection
from django.utils import timezone

from core import config
from core.errors import ApiError

logger = logging.getLogger("miraiwerk.rate_limit")


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    retry_after: int


def _identity_hash(identity: str) -> str:
    return hashlib.sha256(identity.strip().lower().encode("utf-8")).hexdigest()


def client_ip(request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def hit(scope: str, identity: str, limit: int, window_seconds: int) -> RateLimitResult:
    if limit <= 0:
        return RateLimitResult(True, limit, limit, 0)
    now = timezone.now()
    epoch = int(now.timestamp())
    window_epoch = epoch - (epoch % window_seconds)
    window_start = datetime.fromtimestamp(window_epoch, tz=dt_timezone.utc)
    window_end = window_start + timedelta(seconds=window_seconds)
    retry_after = max(1, int((window_end - now).total_seconds()) + 1)
    identity_hash = _identity_hash(identity)

    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO rate_limit_buckets
              (id, scope, identity_hash, window_start, count, updated_at)
            VALUES (%s, %s, %s, %s, 1, now())
            ON CONFLICT (scope, identity_hash, window_start)
            DO UPDATE SET count = rate_limit_buckets.count + 1, updated_at = now()
            RETURNING count
            """,
            [f"rl_{secrets.token_hex(12)}", scope[:60], identity_hash, window_start],
        )
        row = cursor.fetchone()
        count = int(row[0]) if row else 1

    # Opportunistic cleanup keeps the table small without a scheduled job.
    if secrets.randbelow(100) == 0:
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    "DELETE FROM rate_limit_buckets WHERE window_start < now() - interval '2 days'"
                )
        except Exception:  # noqa: BLE001 - cleanup must never fail a request
            logger.debug("rate-limit cleanup failed", exc_info=True)

    return RateLimitResult(
        allowed=count <= limit,
        limit=limit,
        remaining=max(0, limit - count),
        retry_after=0 if count <= limit else retry_after,
    )


def enforce(
    scope: str,
    identity: str,
    limit: int,
    window_seconds: int,
    message: str = "Too many requests. Try again later.",
) -> RateLimitResult:
    if not config.RATE_LIMIT_ENABLED:
        return RateLimitResult(True, limit, limit, 0)
    result = hit(scope, identity, limit, window_seconds)
    if not result.allowed:
        raise ApiError(
            429,
            "RATE_LIMITED",
            message,
            {
                "limit": result.limit,
                "retryAfter": result.retry_after,
                "scope": scope,
            },
        )
    return result


def enforce_login(request, email: str) -> None:
    ip = client_ip(request)
    enforce(
        "auth.login.ip",
        ip,
        config.RATE_LIMIT_LOGIN_IP,
        60,
        "Too many sign-in attempts from this network. Try again shortly.",
    )
    enforce(
        "auth.login.account",
        (email or "").strip().lower(),
        config.RATE_LIMIT_LOGIN_ACCOUNT,
        60,
        "Too many sign-in attempts for this account. Wait a minute and try again.",
    )


def enforce_register(request, email: str) -> None:
    enforce(
        "auth.register.ip",
        client_ip(request),
        config.RATE_LIMIT_REGISTER_IP,
        3600,
        "Too many accounts created from this network. Try again later.",
    )
    if email:
        enforce(
            "auth.register.account",
            email.strip().lower(),
            config.RATE_LIMIT_REGISTER_IP,
            3600,
        )


def enforce_password_forgot(request, email: str) -> None:
    ip = client_ip(request)
    enforce(
        "auth.password_reset.ip",
        ip,
        config.RATE_LIMIT_PASSWORD_RESET_IP,
        900,
        "Too many password reset requests from this network. Try again later.",
    )
    if email:
        enforce(
            "auth.password_reset.account",
            email.strip().lower(),
            config.RATE_LIMIT_PASSWORD_RESET_ACCOUNT,
            900,
            "Too many password reset requests for this account. Try again later.",
        )


def enforce_refresh(request) -> None:
    enforce(
        "auth.refresh.ip",
        client_ip(request),
        config.RATE_LIMIT_REFRESH_IP,
        60,
        "Too many session refresh attempts. Sign in again shortly.",
    )


def enforce_ai(user_id: str, workspace_id: str | None, workflow: str) -> None:
    enforce(
        f"ai.{workflow}.user",
        user_id,
        config.RATE_LIMIT_AI_USER_DAILY,
        86400,
        "You have reached today's AI request limit for this workspace.",
    )
    if workspace_id:
        enforce(
            f"ai.{workflow}.workspace",
            workspace_id,
            config.RATE_LIMIT_AI_WORKSPACE_DAILY,
            86400,
            "This workspace has reached its daily AI request limit. Try again tomorrow.",
        )


def workspace_for_project(project_id: str | None) -> str | None:
    if not project_id:
        return None
    with connection.cursor() as cursor:
        cursor.execute("SELECT workspace_id FROM projects WHERE id = %s", [project_id])
        row = cursor.fetchone()
    return row[0] if row else None
